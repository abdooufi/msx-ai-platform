import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Response } from 'express';

export type AiProvider = 'ollama' | 'deepseek';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LlmResult {
  content: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface ProviderInfo {
  provider: AiProvider;
  model: string;
  ollamaUrl: string;
  ollamaModel: string;
  deepseekModel: string;
  deepseekConfigured: boolean;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  // Two pre-built clients — swap at runtime with zero overhead
  private readonly ollamaClient: OpenAI;
  private readonly deepseekClient: OpenAI;

  private readonly ollamaModel: string;
  private readonly deepseekModel: string;
  private readonly ollamaUrl: string;

  private readonly defaultTemp: number;
  private readonly defaultMaxTokens: number;

  private currentProvider: AiProvider;

  constructor(private config: ConfigService) {
    this.ollamaUrl   = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.ollamaModel = config.get<string>('LLM_MODEL', 'qwen2.5:7b');

    this.deepseekModel = config.get<string>('DEEPSEEK_MODEL', 'deepseek-chat');
    const deepseekKey  = config.get<string>('DEEPSEEK_API_KEY', '');
    const deepseekBase = config.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');

    this.defaultTemp      = parseFloat(config.get('LLM_TEMPERATURE', '0.3'));
    this.defaultMaxTokens = parseInt(config.get('LLM_MAX_TOKENS', '2048'), 10);

    // Current provider: read from env, default to ollama
    const envProvider = config.get<string>('AI_PROVIDER', 'ollama') as AiProvider;
    this.currentProvider = envProvider === 'deepseek' && deepseekKey ? 'deepseek' : 'ollama';

    // Ollama — OpenAI-compatible API at /v1
    this.ollamaClient = new OpenAI({
      baseURL: `${this.ollamaUrl}/v1`,
      apiKey: 'ollama',
    });

    // DeepSeek — also OpenAI-compatible
    this.deepseekClient = new OpenAI({
      baseURL: deepseekBase,
      apiKey: deepseekKey || 'not-configured',
    });

    this.logger.log(
      `🤖 AI provider: ${this.currentProvider.toUpperCase()} ` +
      `(model: ${this.activeModel})` +
      (deepseekKey ? ' | DeepSeek key: configured' : ' | DeepSeek key: not set'),
    );
  }

  // ─── Provider switching ───────────────────────────────────────────────────

  getProviderInfo(): ProviderInfo {
    return {
      provider:           this.currentProvider,
      model:              this.activeModel,
      ollamaUrl:          this.ollamaUrl,
      ollamaModel:        this.ollamaModel,
      deepseekModel:      this.deepseekModel,
      deepseekConfigured: this.config.get<string>('DEEPSEEK_API_KEY', '') !== '',
    };
  }

  setProvider(provider: AiProvider): ProviderInfo {
    if (provider === 'deepseek' && !this.config.get<string>('DEEPSEEK_API_KEY', '')) {
      throw new Error('DEEPSEEK_API_KEY is not configured in the environment');
    }
    this.currentProvider = provider;
    this.logger.log(`🔄 Switched AI provider → ${provider.toUpperCase()} (model: ${this.activeModel})`);
    return this.getProviderInfo();
  }

  private get activeClient(): OpenAI {
    return this.currentProvider === 'deepseek' ? this.deepseekClient : this.ollamaClient;
  }

  private get activeModel(): string {
    return this.currentProvider === 'deepseek' ? this.deepseekModel : this.ollamaModel;
  }

  // ─── Completions ──────────────────────────────────────────────────────────

  /** Non-streaming completion */
  async complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<LlmResult> {
    const start = Date.now();
    try {
      const response = await this.activeClient.chat.completions.create({
        model:       this.activeModel,
        messages,
        temperature: opts.temperature ?? this.defaultTemp,
        max_tokens:  opts.maxTokens  ?? this.defaultMaxTokens,
        stream:      false,
      });

      const content    = response.choices[0]?.message?.content || '';
      const tokensUsed = response.usage?.total_tokens ?? 0;
      return { content, tokensUsed, latencyMs: Date.now() - start };
    } catch (err) {
      this.logger.error(`LLM completion failed [${this.currentProvider}]: ${err.message}`);
      throw err;
    }
  }

  /** Server-Sent Events streaming to an Express Response */
  async streamToResponse(
    messages: LlmMessage[],
    res: Response,
    opts: LlmOptions = {},
  ): Promise<{ tokensUsed: number; latencyMs: number }> {
    const start = Date.now();
    let tokensUsed = 0;

    // Only set headers if not already committed (chat.service sets them first)
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }

    try {
      const stream = await this.activeClient.chat.completions.create({
        model:       this.activeModel,
        messages,
        temperature: opts.temperature ?? this.defaultTemp,
        max_tokens:  opts.maxTokens  ?? this.defaultMaxTokens,
        stream:      true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        if (chunk.usage) tokensUsed = chunk.usage.total_tokens;
      }

      const latencyMs = Date.now() - start;
      res.write(`data: ${JSON.stringify({ done: true, tokensUsed, latencyMs, provider: this.currentProvider })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs };
    } catch (err) {
      this.logger.error(`LLM stream failed [${this.currentProvider}]: ${err.message}`);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs: Date.now() - start };
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Fast heuristic language detection (no LLM call) */
  async detectLanguage(text: string): Promise<'ar' | 'en' | 'mixed'> {
    const arabicChars = (text.match(/[؀-ۿ]/g) || []).length;
    const total = text.replace(/\s/g, '').length;
    if (total === 0) return 'en';
    const ratio = arabicChars / total;
    if (ratio > 0.6) return 'ar';
    if (ratio > 0.2) return 'mixed';
    return 'en';
  }

  /** Build the MSX system prompt in the detected language */
  buildSystemPrompt(
    language: 'ar' | 'en' | 'mixed',
    context: string,
    liveData?: string | null,
  ): string {
    if (language === 'ar') {
      const liveSection = liveData
        ? `\n📡 بيانات السوق المباشرة (بيانات حقيقية من MSX.om — استخدمها أولاً):\n${liveData}\n`
        : '';
      const ragSection = context
        ? `\nمعلومات من قاعدة المعرفة:\n${context}\n`
        : '';
      return `أنت مساعد بورصة مسقط الذكي — مساعد متخصص حصرياً في بورصة مسقط (MSX).
${liveSection}${ragSection}
━━━ نطاق عملك ━━━
تجيب فقط على الأسئلة المتعلقة بـ:
• أسعار الأسهم والشركات المدرجة في بورصة مسقط
• المؤشرات (MSM30 وغيرها) والبيانات السوقية
• التداول والاستثمار في السوق المالي العُماني
• توزيعات الأرباح والقوائم المالية وأخبار الشركات
• اللوائح والتشريعات المتعلقة بسوق رأس المال العُماني

━━━ قاعدة صارمة ━━━
إذا كان السؤال لا علاقة له ببورصة مسقط أو الأسواق المالية العُمانية — مثل السفر والسياحة والطبخ والصحة والرياضة والأفلام أو أي موضوع آخر — يجب أن تردّ بالضبط بهذه الجملة:
"أنا مساعد بورصة مسقط المتخصص ولا أستطيع الإجابة على أسئلة خارج نطاق السوق المالي العُماني. يمكنني مساعدتك في أسعار الأسهم والشركات المدرجة والمؤشرات وبيانات التداول في بورصة مسقط."

قواعد إضافية:
- إذا توفرت بيانات مباشرة، استخدمها كمصدر رئيسي وأجب بالأرقام الفعلية
- لا تخترع أرقاماً أو أسعاراً
- أجب بالعربية للأسئلة العربية
- كن مختصراً ومهنياً`;
    }

    const liveSection = liveData
      ? `\nLIVE MARKET DATA (real-time from MSX.om — use as primary source):\n${liveData}\n`
      : '';
    const ragSection = context
      ? `\nKNOWLEDGE BASE CONTEXT:\n${context}\n`
      : '';

    return `You are the MSX Smart Assistant — an AI exclusively for the Muscat Stock Exchange (MSX / بورصة مسقط, www.msx.om).
${liveSection}${ragSection}
━━━ YOUR SCOPE ━━━
You ONLY answer questions about:
• MSX-listed company stocks, prices, and market data
• Market indices (MSM30, MSM Sharia, sector indices)
• Trading and investing on the Muscat Stock Exchange
• Dividends, financial statements, company news and announcements
• Omani capital market regulations and how to trade on MSX

━━━ STRICT OFF-TOPIC RULE ━━━
If the question is NOT about the Muscat Stock Exchange, Omani stock market, or MSX-listed companies — you MUST reply with EXACTLY this message (do NOT attempt to answer the question):
"I'm the MSX Stock Exchange Assistant. I can only help with questions about the Muscat Stock Exchange — stocks, companies, market data, and trading. For other topics, please use a dedicated service."

This rule applies to ANY off-topic question including: travel, tourism, food, health, sports, weather, general knowledge, technology, politics, entertainment, or anything unrelated to MSX.

━━━ ADDITIONAL RULES ━━━
- If LIVE MARKET DATA is provided, prioritize it and quote exact numbers
- Never fabricate prices, percentages, or company data
- If MSX data is not available for a valid MSX question, say: "I don't have that data right now. Please visit www.msx.om for the latest information."
- Be professional, concise, and helpful
- Respond in Arabic for Arabic questions`;
  }
}
