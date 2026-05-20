import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Response } from 'express';

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

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultTemp: number;
  private readonly defaultMaxTokens: number;

  constructor(private config: ConfigService) {
    const ollamaUrl = config.get<string>('OLLAMA_URL', 'http://localhost:11434');

    // Ollama exposes an OpenAI-compatible API at /v1
    this.client = new OpenAI({
      baseURL: `${ollamaUrl}/v1`,
      apiKey: 'ollama', // required by the SDK but not used
    });

    this.model = config.get<string>('LLM_MODEL', 'qwen2.5:7b');
    this.defaultTemp = config.get<number>('LLM_TEMPERATURE', 0.3);
    this.defaultMaxTokens = config.get<number>('LLM_MAX_TOKENS', 2048);
  }

  /** Non-streaming completion */
  async complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<LlmResult> {
    const start = Date.now();
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: opts.temperature ?? this.defaultTemp,
        max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
        stream: false,
      });

      const content = response.choices[0]?.message?.content || '';
      const tokensUsed = response.usage?.total_tokens ?? 0;

      return { content, tokensUsed, latencyMs: Date.now() - start };
    } catch (err) {
      this.logger.error(`LLM completion failed: ${err.message}`);
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: opts.temperature ?? this.defaultTemp,
        max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        if (chunk.usage) tokensUsed = chunk.usage.total_tokens;
      }

      const latencyMs = Date.now() - start;
      res.write(`data: ${JSON.stringify({ done: true, tokensUsed, latencyMs })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs };
    } catch (err) {
      this.logger.error(`LLM stream failed: ${err.message}`);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return { tokensUsed, latencyMs: Date.now() - start };
    }
  }

  /** Detect language using a fast LLM call (or use franc library) */
  async detectLanguage(text: string): Promise<'ar' | 'en' | 'mixed'> {
    // Fast heuristic: count Arabic chars
    const arabicChars = (text.match(/[؀-ۿ]/g) || []).length;
    const total = text.replace(/\s/g, '').length;
    if (total === 0) return 'en';
    const ratio = arabicChars / total;
    if (ratio > 0.6) return 'ar';
    if (ratio > 0.2) return 'mixed';
    return 'en';
  }

  /** Build the MSX system prompt in the detected language */
  buildSystemPrompt(language: 'ar' | 'en' | 'mixed', context: string): string {
    const isArabic = language === 'ar';

    if (isArabic) {
      return `أنت مساعد ذكي لبورصة مسقط (MSX). مهمتك مساعدة المستثمرين والمتداولين.

${context ? `المعلومات المتاحة:\n${context}\n` : ''}

قواعد مهمة:
- أجب دائماً بالعربية إذا كان السؤال بالعربية
- استخدم المعلومات المقدمة فقط، لا تخترع معلومات
- إذا لم تجد المعلومة قل: "لم أجد معلومات كافية حول هذا الموضوع"
- كن مختصراً ومهنياً
- اذكر المصادر عند الإمكان`;
    }

    return `You are the MSX Smart Assistant for Muscat Stock Exchange (www.msx.om).
You help investors, traders, and visitors with stock market information.

${context ? `RETRIEVED CONTEXT:\n${context}\n` : ''}

RULES:
- Answer ONLY using the retrieved context above when available
- If the context doesn't cover the question, say: "I could not find specific information about this. Please visit www.msx.om or contact our support."
- Never hallucinate facts, prices, or company data
- Be professional, concise, and helpful
- Cite sources when available
- For Arabic questions, respond in Arabic`;
  }
}
