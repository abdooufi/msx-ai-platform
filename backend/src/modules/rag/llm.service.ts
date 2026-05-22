import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import axios from 'axios';
import { Response } from 'express';

/** All supported providers + 'auto' smart-routing mode */
export type AiProvider = 'ollama' | 'deepseek' | 'claude' | 'auto';

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
  provider?: string;
}

export interface ProviderInfo {
  provider: AiProvider;
  model: string;
  // Ollama
  ollamaUrl: string;
  ollamaModel: string;
  // DeepSeek
  deepseekModel: string;
  deepseekConfigured: boolean;
  // Claude
  claudeModel: string;
  claudeConfigured: boolean;
  // Auto
  autoLastPicked?: string;
}

export interface ProviderBalance {
  deepseek: { available: boolean; totalBalance: string; currency: string } | null;
  claude:   { available: boolean } | null;
  ollama:   { available: boolean } | null;
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

  // Claude
  private readonly claudeModel: string;
  private readonly claudeApiKey: string;
  private readonly claudeBaseUrl: string;
  readonly claudeConfigured: boolean;

  private readonly defaultTemp: number;
  private readonly defaultMaxTokens: number;

  private currentProvider: AiProvider;
  /** Tracks which real provider was last chosen by 'auto' mode */
  private autoLastPicked: string = '';

  constructor(private config: ConfigService) {
    this.ollamaUrl   = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.ollamaModel = config.get<string>('LLM_MODEL', 'qwen2.5:7b');

    this.deepseekModel = config.get<string>('DEEPSEEK_MODEL', 'deepseek-chat');
    const deepseekKey  = config.get<string>('DEEPSEEK_API_KEY', '');
    const deepseekBase = config.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');

    // Claude
    this.claudeModel   = config.get<string>('CLAUDE_MODEL', 'claude-3-5-haiku-20241022');
    this.claudeApiKey  = config.get<string>('CLAUDE_API_KEY', '');
    this.claudeBaseUrl = config.get<string>('CLAUDE_BASE_URL', 'https://api.anthropic.com');
    this.claudeConfigured = !!this.claudeApiKey;

    this.defaultTemp      = parseFloat(config.get('LLM_TEMPERATURE', '0.3'));
    this.defaultMaxTokens = parseInt(config.get('LLM_MAX_TOKENS', '2048'), 10);

    // Current provider: read from env, default to ollama
    const envProvider = config.get<string>('AI_PROVIDER', 'ollama') as AiProvider;
    if (envProvider === 'deepseek' && deepseekKey) {
      this.currentProvider = 'deepseek';
    } else if (envProvider === 'claude' && this.claudeConfigured) {
      this.currentProvider = 'claude';
    } else if (envProvider === 'auto') {
      this.currentProvider = 'auto';
    } else {
      this.currentProvider = 'ollama';
    }

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
      (deepseekKey ? ' | DeepSeek: ✓' : ' | DeepSeek: ✗') +
      (this.claudeConfigured ? ' | Claude: ✓' : ' | Claude: ✗'),
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
      claudeModel:        this.claudeModel,
      claudeConfigured:   this.claudeConfigured,
      autoLastPicked:     this.autoLastPicked || undefined,
    };
  }

  setProvider(provider: AiProvider): ProviderInfo {
    if (provider === 'deepseek' && !this.config.get<string>('DEEPSEEK_API_KEY', '')) {
      throw new Error('DEEPSEEK_API_KEY is not configured in the environment');
    }
    if (provider === 'claude' && !this.claudeConfigured) {
      throw new Error('CLAUDE_API_KEY is not configured in the environment');
    }
    this.currentProvider = provider;
    this.logger.log(`🔄 Switched AI provider → ${provider.toUpperCase()} (model: ${this.activeModel})`);
    return this.getProviderInfo();
  }

  private get activeClient(): OpenAI {
    return this.currentProvider === 'deepseek' ? this.deepseekClient : this.ollamaClient;
  }

  private get activeModel(): string {
    if (this.currentProvider === 'deepseek') return this.deepseekModel;
    if (this.currentProvider === 'claude')   return this.claudeModel;
    if (this.currentProvider === 'auto')     return `auto → ${this.autoLastPicked || 'pending'}`;
    return this.ollamaModel;
  }

  // ─── Auto-routing ─────────────────────────────────────────────────────────

  /**
   * Smart provider selection between Ollama and DeepSeek only.
   * Claude is a manual choice — Auto never routes to it automatically.
   *
   * Rules (in priority order):
   *  1. Live data present + short price query → Ollama (fast, data already injected)
   *  2. Short / simple query (≤5 words)       → Ollama (fast local)
   *  3. DeepSeek configured                   → DeepSeek (stronger for longer questions)
   *  4. Fallback                              → Ollama
   */
  pickAutoProvider(message: string, hasLiveData = false): Exclude<AiProvider, 'auto'> {
    const m = message.toLowerCase().trim();

    // 1. Live data + short price query → keep it local and fast
    if (hasLiveData && m.split(/\s+/).length <= 8) {
      return 'ollama';
    }

    // 2. Short / simple query → Ollama (fast local)
    if (m.split(/\s+/).length <= 5) {
      return 'ollama';
    }

    // 3. DeepSeek available → use it for longer / more complex questions
    if (this.config.get<string>('DEEPSEEK_API_KEY', '')) {
      return 'deepseek';
    }

    // 4. Fallback
    return 'ollama';
  }

  // ─── Claude API calls ─────────────────────────────────────────────────────

  private async completeWithClaude(
    messages: LlmMessage[],
    opts: LlmOptions = {},
  ): Promise<LlmResult> {
    const start = Date.now();

    // Split system message from conversation messages
    const systemMsg = messages.find(m => m.role === 'system');
    const convMsgs  = messages.filter(m => m.role !== 'system');

    const body: Record<string, any> = {
      model:      this.claudeModel,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      messages:   convMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;

    try {
      const resp = await axios.post(
        `${this.claudeBaseUrl}/v1/messages`,
        body,
        {
          headers: {
            'x-api-key':         this.claudeApiKey,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          timeout: 60_000,
        },
      );

      const content    = resp.data?.content?.[0]?.text || '';
      const tokensUsed = (resp.data?.usage?.input_tokens ?? 0) +
                         (resp.data?.usage?.output_tokens ?? 0);
      return { content, tokensUsed, latencyMs: Date.now() - start, provider: 'claude' };
    } catch (err) {
      const msg = err?.response?.data?.error?.message || err.message;
      this.logger.error(`Claude completion failed: ${msg}`);
      throw new Error(msg);
    }
  }

  private async streamWithClaude(
    messages: LlmMessage[],
    res: Response,
    opts: LlmOptions = {},
  ): Promise<{ tokensUsed: number; latencyMs: number; fullText: string }> {
    const start = Date.now();
    let tokensUsed = 0;
    let fullText   = '';

    const systemMsg = messages.find(m => m.role === 'system');
    const convMsgs  = messages.filter(m => m.role !== 'system');

    const body: Record<string, any> = {
      model:      this.claudeModel,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      stream:     true,
      messages:   convMsgs.map(m => ({ role: m.role, content: m.content })),
    };
    if (systemMsg) body.system = systemMsg.content;

    try {
      const httpResp = await axios.post(
        `${this.claudeBaseUrl}/v1/messages`,
        body,
        {
          headers: {
            'x-api-key':         this.claudeApiKey,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          responseType: 'stream',
          timeout: 120_000,
        },
      );

      await new Promise<void>((resolve, reject) => {
        let buffer = '';

        httpResp.data.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;

            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim();
              if (jsonStr === '[DONE]') continue;
              try {
                const event = JSON.parse(jsonStr);

                if (event.type === 'content_block_delta' && event.delta?.text) {
                  fullText += event.delta.text;
                  res.write(`data: ${JSON.stringify({ delta: event.delta.text })}\n\n`);
                }
                if (event.type === 'message_delta' && event.usage) {
                  tokensUsed = (event.usage.input_tokens ?? 0) +
                               (event.usage.output_tokens ?? 0);
                }
                if (event.type === 'message_stop') {
                  resolve();
                }
              } catch { /* skip malformed JSON */ }
            }
          }
        });

        httpResp.data.on('end',   () => resolve());
        httpResp.data.on('error', (e: Error) => reject(e));
      });

      const latencyMs = Date.now() - start;
      res.write(`data: ${JSON.stringify({ done: true, tokensUsed, latencyMs, provider: 'claude' })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs, fullText };
    } catch (err) {
      const msg = err?.response?.data?.error?.message || err.message;
      this.logger.error(`Claude stream failed: ${msg}`);
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs: Date.now() - start, fullText };
    }
  }

  // ─── Completions ──────────────────────────────────────────────────────────

  /** Non-streaming completion */
  async complete(
    messages: LlmMessage[],
    opts: LlmOptions = {},
    /** Optional: pre-resolved provider — avoids double auto-routing */
    forceProvider?: Exclude<AiProvider, 'auto'>,
  ): Promise<LlmResult> {
    // Resolve 'auto' to a concrete provider
    let provider: Exclude<AiProvider, 'auto'> = forceProvider ?? (
      this.currentProvider === 'auto'
        ? (() => {
            const userMsg = [...messages].reverse().find(m => m.role === 'user');
            const picked  = this.pickAutoProvider(userMsg?.content ?? '');
            this.autoLastPicked = picked;
            return picked;
          })()
        : this.currentProvider as Exclude<AiProvider, 'auto'>
    );

    if (provider === 'claude') {
      return this.completeWithClaude(messages, opts);
    }

    const start = Date.now();
    const client = provider === 'deepseek' ? this.deepseekClient : this.ollamaClient;
    const model  = provider === 'deepseek' ? this.deepseekModel  : this.ollamaModel;

    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: opts.temperature ?? this.defaultTemp,
        max_tokens:  opts.maxTokens  ?? this.defaultMaxTokens,
        stream:      false,
      });

      const content    = response.choices[0]?.message?.content || '';
      const tokensUsed = response.usage?.total_tokens ?? 0;
      return { content, tokensUsed, latencyMs: Date.now() - start, provider };
    } catch (err) {
      this.logger.error(`LLM completion failed [${provider}]: ${err.message}`);
      throw err;
    }
  }

  /**
   * Server-Sent Events streaming to an Express Response.
   * Buffers the full text while streaming so callers don't need a second completion call.
   */
  async streamToResponse(
    messages: LlmMessage[],
    res: Response,
    opts: LlmOptions = {},
    /** Optional: pre-resolved provider (e.g. from auto-routing in chat.service) */
    forceProvider?: Exclude<AiProvider, 'auto'>,
  ): Promise<{ tokensUsed: number; latencyMs: number; fullText: string }> {
    const start = Date.now();
    let tokensUsed = 0;
    let fullText   = '';

    // Resolve provider
    let provider: Exclude<AiProvider, 'auto'> = forceProvider ?? (
      this.currentProvider === 'auto'
        ? (() => {
            const userMsg = [...messages].reverse().find(m => m.role === 'user');
            const picked  = this.pickAutoProvider(userMsg?.content ?? '');
            this.autoLastPicked = picked;
            return picked;
          })()
        : this.currentProvider as Exclude<AiProvider, 'auto'>
    );

    // Only set headers if not already committed (chat.service sets them first)
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }

    if (provider === 'claude') {
      return this.streamWithClaude(messages, res, opts);
    }

    const client = provider === 'deepseek' ? this.deepseekClient : this.ollamaClient;
    const model  = provider === 'deepseek' ? this.deepseekModel  : this.ollamaModel;

    try {
      const stream = await client.chat.completions.create({
        model,
        messages,
        temperature: opts.temperature ?? this.defaultTemp,
        max_tokens:  opts.maxTokens  ?? this.defaultMaxTokens,
        stream:      true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          fullText += delta;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        if (chunk.usage) tokensUsed = chunk.usage.total_tokens;
      }

      const latencyMs = Date.now() - start;
      res.write(`data: ${JSON.stringify({ done: true, tokensUsed, latencyMs, provider })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs, fullText };
    } catch (err) {
      this.logger.error(`LLM stream failed [${provider}]: ${err.message}`);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs: Date.now() - start, fullText };
    }
  }

  // ─── Balance / quota ─────────────────────────────────────────────────────

  /**
   * Fetch live balance from each configured cloud provider.
   * DeepSeek exposes a public /user/balance endpoint.
   * Claude (Anthropic) has no public balance API — we just confirm the key is set.
   * Ollama is local/free — always "available".
   */
  async getProviderBalance(): Promise<ProviderBalance> {
    const [deepseek, claude, ollama] = await Promise.all([
      this.fetchDeepSeekBalance(),
      this.checkClaudeKey(),
      this.checkOllama(),
    ]);
    return { deepseek, claude, ollama };
  }

  private async fetchDeepSeekBalance(): Promise<ProviderBalance['deepseek']> {
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY', '');
    if (!apiKey) return null;

    try {
      const res = await axios.get('https://api.deepseek.com/user/balance', {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 8_000,
      });
      const info = res.data?.balance_infos?.[0];
      return {
        available:    res.data?.is_available ?? true,
        totalBalance: info?.total_balance ?? '—',
        currency:     info?.currency      ?? 'USD',
      };
    } catch (err) {
      this.logger.warn(`DeepSeek balance check failed: ${err.message}`);
      return { available: false, totalBalance: '—', currency: 'USD' };
    }
  }

  private async checkClaudeKey(): Promise<ProviderBalance['claude']> {
    if (!this.claudeApiKey) return null;
    // Anthropic has no public balance endpoint — validate key with a tiny models list call
    try {
      await axios.get(`${this.claudeBaseUrl}/v1/models`, {
        headers: {
          'x-api-key': this.claudeApiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 6_000,
      });
      return { available: true };
    } catch (err) {
      const status = err?.response?.status;
      // 200 = good, 401 = bad key, 403 = no access, anything else may be network
      return { available: status !== 401 && status !== 403 };
    }
  }

  private async checkOllama(): Promise<ProviderBalance['ollama']> {
    try {
      await axios.get(`${this.ollamaUrl}/api/tags`, { timeout: 4_000 });
      return { available: true };
    } catch {
      return { available: false };
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

  /**
   * Build the MSX system prompt in the detected language.
   *
   * @param hasContext  true  → RAG context or live data is present; LLM should use it.
   *                   false → no data found; LLM must say so and not invent anything.
   */
  buildSystemPrompt(
    language: 'ar' | 'en' | 'mixed',
    context: string,
    liveData?: string | null,
    hasContext = false,
  ): string {
    if (language === 'ar') {
      const liveSection = liveData
        ? `\n📡 بيانات السوق المباشرة (بيانات حقيقية من MSX.om — استخدمها أولاً):\n${liveData}\n`
        : '';
      const ragSection = context
        ? `\n📚 معلومات من قاعدة المعرفة (المصدر الوحيد المسموح باستخدامه):\n${context}\n`
        : '';
      const noDataWarning = !hasContext
        ? `\n⚠️ لا توجد بيانات متاحة في قاعدة المعرفة لهذا السؤال.\n`
        : '';

      return `أنت مساعد بورصة مسقط الذكي — مساعد متخصص حصرياً في بورصة مسقط (MSX).
${liveSection}${ragSection}${noDataWarning}
━━━ قاعدة البيانات الخاصة ━━━
⛔ يُحظر تماماً استخدام أي معلومات من ذاكرتك أو تدريبك الداخلي للإجابة على الأسئلة.
✅ يجب أن تعتمد فقط على:
  ١. بيانات السوق المباشرة المقدمة أعلاه
  ٢. معلومات قاعدة المعرفة المقدمة أعلاه

${!hasContext ? `بما أنه لا توجد بيانات متاحة لهذا السؤال، يجب أن تردّ بالضبط:
"لا تتوفر لديّ معلومات كافية حول هذا الموضوع في قاعدة بياناتي. يرجى زيارة www.msx.om للحصول على أحدث المعلومات."` : ''}

━━━ نطاق عملك ━━━
تجيب فقط على الأسئلة المتعلقة بـ:
• أسعار الأسهم والشركات المدرجة في بورصة مسقط
• المؤشرات (MSM30 وغيرها) والبيانات السوقية
• التداول والاستثمار في السوق المالي العُماني
• توزيعات الأرباح والقوائم المالية وأخبار الشركات
• اللوائح والتشريعات المتعلقة بسوق رأس المال العُماني

━━━ قاعدة صارمة ━━━
إذا كان السؤال لا علاقة له ببورصة مسقط — مثل السفر والسياحة والطبخ والصحة والرياضة والأفلام أو أي موضوع آخر — يجب أن تردّ بالضبط بهذه الجملة:
"أنا مساعد بورصة مسقط المتخصص ولا أستطيع الإجابة على أسئلة خارج نطاق السوق المالي العُماني. يمكنني مساعدتك في أسعار الأسهم والشركات المدرجة والمؤشرات وبيانات التداول في بورصة مسقط."

قواعد إضافية:
- إذا توفرت بيانات مباشرة، استخدمها كمصدر رئيسي وأجب بالأرقام الفعلية
- لا تخترع أرقاماً أو أسعاراً أو معلومات عن شركات
- إذا وردت سجلات تداول بتوقيتات، اعرضها كملخص واضح: الافتتاح والأعلى والأدنى وآخر سعر وإجمالي الحجم
- أجب بالعربية للأسئلة العربية
- كن مختصراً ومهنياً`;
    }

    const liveSection = liveData
      ? `\nLIVE MARKET DATA (real-time from MSX.om — use as primary source):\n${liveData}\n`
      : '';
    const ragSection = context
      ? `\nKNOWLEDGE BASE CONTEXT (the ONLY source you are allowed to use):\n${context}\n`
      : '';
    const noDataWarning = !hasContext
      ? `\n⚠️ NO DATA AVAILABLE in the knowledge base for this query.\n`
      : '';

    return `You are the MSX Smart Assistant — an AI exclusively for the Muscat Stock Exchange (MSX / بورصة مسقط, www.msx.om).
${liveSection}${ragSection}${noDataWarning}
━━━ KNOWLEDGE BASE ONLY — CRITICAL RULE ━━━
⛔ You are STRICTLY FORBIDDEN from using your internal training knowledge to answer any question.
✅ You may ONLY use:
  1. The LIVE MARKET DATA provided above
  2. The KNOWLEDGE BASE CONTEXT provided above

${!hasContext ? `Since no data is available for this query, you MUST reply with exactly:
"I don't have enough information about this topic in my knowledge base. Please visit www.msx.om for the latest information."` : ''}

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

━━━ ADDITIONAL RULES ━━━
- If LIVE MARKET DATA is provided, prioritize it and quote exact numbers
- Never fabricate prices, percentages, or company data
- When intraday trade records are provided, present them as a clear summary: open, high, low, last price, total volume
- Be professional, concise, and helpful
- Respond in Arabic for Arabic questions`;
  }
}
