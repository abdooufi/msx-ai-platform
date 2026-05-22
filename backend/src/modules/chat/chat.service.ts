import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RagService } from '../rag/rag.service';
import { LlmService, LlmMessage } from '../rag/llm.service';
import { DynamicApiService } from '../admin/dynamic-api.service';
import { AppPgService } from '../database/app-pg.service';
import { ChatRequestDto } from './chat.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private pg: AppPgService,
    private rag: RagService,
    private llm: LlmService,
    private dynamicApi: DynamicApiService,
  ) {}

  // ── Off-topic guard ───────────────────────────────────────────────

  /**
   * Returns a refusal message if the question is clearly unrelated to MSX,
   * or null if it should be forwarded to the LLM.
   *
   * Strategy:
   *   1. If the message contains ANY MSX/finance keyword → allow (return null)
   *   2. If the message contains an obvious off-topic keyword → block (return message)
   *   3. Otherwise → allow (let the LLM + system-prompt handle ambiguous cases)
   */
  private checkOffTopic(message: string, language: string): string | null {
    const m = message.toLowerCase();

    // ── Finance / MSX allow-list (any match → pass through) ──────────
    const financeTerms = [
      // English
      'stock', 'share', 'price', 'market', 'msx', 'msm', 'trade', 'trading',
      'invest', 'dividend', 'portfolio', 'index', 'indices', 'company', 'compan',
      'exchange', 'equity', 'sector', 'listed', 'ipo', 'financial', 'earnings',
      'revenue', 'profit', 'loss', 'balance', 'quarter', 'annual', 'report',
      'oman', 'omani', 'muscat', 'bourse', 'gain', 'gainer', 'loser', 'volume',
      'turnover', 'bid', 'ask', 'ltp', 'ohlc', 'chart', 'candlestick',
      'shareholder', 'board', 'ceo', 'chairman', 'subsidiary', 'ownership',
      // Arabic
      'سهم', 'سعر', 'سوق', 'تداول', 'استثمار', 'شركة', 'مؤشر', 'أرباح',
      'توزيع', 'بورصة', 'مسقط', 'عُمان', 'عمان', 'مالي', 'ربح', 'خسارة',
    ];
    if (financeTerms.some(t => m.includes(t))) return null;

    // ── Clearly off-topic block-list ──────────────────────────────────
    const offTopicTerms = [
      // Travel & tourism
      'travel', 'trip', 'vacation', 'holiday', 'tourism', 'hotel', 'resort',
      'flight', 'airline', 'destination', 'passport', 'visa', 'tour', 'cruise',
      'beach', 'mountain', 'سفر', 'سياح', 'فندق', 'رحلة', 'عطلة', 'طيران',
      // Food & cooking
      'recipe', 'cook', 'restaurant', 'food', 'meal', 'dish', 'cuisine',
      'ingredient', 'طبخ', 'وصفة', 'مطعم', 'أكل', 'طعام',
      // Health & medicine
      'doctor', 'hospital', 'medicine', 'symptom', 'disease', 'treatment',
      'pharmacy', 'drug', 'طبيب', 'مستشفى', 'دواء', 'علاج', 'مرض',
      // Sports & entertainment
      'football', 'soccer', 'basketball', 'cricket', 'tennis', 'sport',
      'movie', 'film', 'series', 'music', 'song', 'concert', 'celebrity',
      'كرة', 'رياضة', 'فيلم', 'موسيقى', 'مسلسل',
      // General knowledge / off-topic
      'weather', 'forecast', 'poem', 'story', 'joke', 'game', 'quiz',
      'طقس', 'نكتة', 'قصيدة', 'لعبة',
    ];
    if (offTopicTerms.some(t => m.includes(t))) {
      return language === 'ar'
        ? 'أنا مساعد بورصة مسقط المتخصص ولا أستطيع الإجابة على أسئلة خارج نطاق السوق المالي العُماني. يمكنني مساعدتك في أسعار الأسهم والشركات المدرجة والمؤشرات وبيانات التداول في بورصة مسقط.'
        : "I'm the MSX Stock Exchange Assistant. I can only help with questions about the Muscat Stock Exchange — stocks, companies, market data, and trading. For other topics, please use a dedicated service.";
    }

    return null; // let the LLM decide
  }

  /**
   * Main streaming chat endpoint.
   * 1. Detect language
   * 2. Off-topic guard (fast path — no LLM tokens used)
   * 3. Retrieve RAG context from Qdrant
   * 4. Build LLM messages
   * 5. Stream response via SSE
   * 6. Persist conversation
   */
  async streamChat(dto: ChatRequestDto, res: Response): Promise<void> {
    const sessionId = dto.sessionId || uuidv4();
    const start = Date.now();

    // 1. Detect language
    const language = await this.llm.detectLanguage(dto.message);

    // 2. Off-topic guard — fast path, zero LLM tokens
    const refusal = this.checkOffTopic(dto.message, language);
    if (refusal) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
      }
      res.write(`data: ${JSON.stringify({ type: 'meta', sessionId, language, sources: [], hadContext: false })}\n\n`);
      res.write(`data: ${JSON.stringify({ delta: refusal })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, tokensUsed: 0, latencyMs: Date.now() - start })}\n\n`);
      res.end();
      await this.persistMessage(sessionId, dto, {
        response: refusal, language, sources: [], tokensUsed: 0, latencyMs: Date.now() - start,
      });
      return;
    }

    // 3. Detect symbol first (fast DB lookup), then retrieve RAG with company context
    const symbol = await this.dynamicApi.resolveSymbolWithDb(dto.message);
    const ragResult = await this.rag.retrieve(dto.message, language, symbol ?? undefined);
    const { context, sources, hadResults } = ragResult;

    // 4. Fetch live market data (sequential — needs symbol first)
    const liveData = symbol
      ? await this.dynamicApi.fetchDynamicData(dto.message, symbol).catch(() => null)
      : null;

    if (liveData) {
      this.logger.log(`Live data injected for symbol: ${symbol}`);
    }

    // 4b. Chart fast-path — bypass LLM, send structured chart data for the frontend to render.
    if (symbol && this.isChartRequest(dto.message)) {
      const rawChart = await this.dynamicApi.getChartData(symbol).catch(() => null);
      const chartPayload = rawChart ? this.buildChartPayload(symbol, rawChart) : null;
      if (chartPayload && chartPayload.points.length > 0) {
        if (!res.headersSent) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.flushHeaders();
        }
        const s = chartPayload.summary;
        const textSummary =
          `**${symbol.toUpperCase()} — Intraday Chart** (${s.tradesCount} trades)\n\n` +
          `| | |\n|---|---|\n` +
          `| 🕐 Latest | **${s.latestTime}** · **${s.last.toFixed(3)} OMR** |\n` +
          `| Open | ${s.open.toFixed(3)} |\n` +
          `| High | ${s.high.toFixed(3)} |\n` +
          `| Low  | ${s.low.toFixed(3)} |\n` +
          `| Volume | ${s.totalShares.toLocaleString()} shares |\n` +
          `| Turnover | ${s.totalTurnover.toFixed(3)} OMR |`;

        res.write(`data: ${JSON.stringify({ type: 'meta', sessionId, language, sources: [], hadContext: false })}\n\n`);
        // Send the chart data payload for the frontend chart renderer
        res.write(`data: ${JSON.stringify({ type: 'chart', chartData: chartPayload })}\n\n`);
        // Send text summary as normal delta so it shows in the message
        res.write(`data: ${JSON.stringify({ delta: textSummary })}\n\n`);
        const latencyMs = Date.now() - start;
        res.write(`data: ${JSON.stringify({ done: true, tokensUsed: 0, latencyMs, provider: 'direct' })}\n\n`);
        res.end();
        await this.persistMessage(sessionId, dto, {
          response: textSummary, language, sources: [], tokensUsed: 0, latencyMs,
        });
        return;
      }
    }

    // 5. Build conversation history (last 10 turns for context window)
    const historyMessages: LlmMessage[] = (dto.history || [])
      .slice(-10)
      .filter(h => h.role && h.content)
      .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

    // 6. Build system prompt with retrieved context and live data
    const systemPrompt = this.llm.buildSystemPrompt(language, context, liveData);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: dto.message },
    ];

    // 7. Set SSE headers BEFORE any write
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
    }

    // Add source info to SSE before streaming text
    res.write(
      `data: ${JSON.stringify({
        type: 'meta',
        sessionId,
        language,
        sources: sources.slice(0, 3),
        hadContext: hadResults,
      })}\n\n`,
    );

    // 8. Stream LLM response
    let fullResponse = '';
    let tokensUsed = 0;
    let latencyMs = 0;

    // For 'auto' mode: pre-resolve provider so both stream + complete use the same one
    let resolvedProvider: 'ollama' | 'deepseek' | 'claude' | undefined;
    const info = this.llm.getProviderInfo();
    if (info.provider === 'auto') {
      resolvedProvider = this.llm.pickAutoProvider(dto.message, !!liveData);
    }

    try {
      // Intercept the stream to capture the full response for saving
      const { tokensUsed: t, latencyMs: l } = await this.llm.streamToResponse(
        messages,
        res,
        { stream: true },
        resolvedProvider,
      );
      tokensUsed = t;
      latencyMs = l;

      // We need the full text — re-run without stream for saving
      // (In production you'd buffer the stream instead for efficiency)
      const result = await this.llm.complete(messages, {}, resolvedProvider);
      fullResponse  = result.content;
    } catch (err) {
      this.logger.error(`Chat stream error: ${err.message}`);
      fullResponse = language === 'ar'
        ? 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.'
        : 'Sorry, an error occurred. Please try again.';
      // Send error event and close the SSE stream gracefully
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: fullResponse })}\n\n`);
        res.end();
      }
    }

    latencyMs = latencyMs || (Date.now() - start);

    // 7. Persist conversation
    await this.persistMessage(sessionId, dto, {
      response: fullResponse,
      language,
      sources,
      tokensUsed,
      latencyMs,
    });

    // 8. Analytics
    await this.trackEvent({
      type: 'message_sent',
      sessionId,
      language,
      channel: dto.channel || 'web',
      latencyMs,
      tokensUsed,
      confidenceScore: sources[0]?.score ?? 0,
      hadContext: hadResults,
    });
  }

  private async persistMessage(
    sessionId: string,
    dto: ChatRequestDto,
    result: {
      response: string;
      language: string;
      sources: any[];
      tokensUsed: number;
      latencyMs: number;
    },
  ) {
    try {
      const userMsg = {
        _id: uuidv4(),
        role: 'user',
        content: dto.message,
        language: result.language,
        status: 'success',
        sources: [],
        createdAt: new Date(),
        feedback: null,
      };

      const assistantMsg = {
        _id: uuidv4(),
        role: 'assistant',
        content: result.response,
        language: result.language,
        status: 'success',
        sources: result.sources.slice(0, 5),
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        confidenceScore: result.sources[0]?.score ?? 0,
        createdAt: new Date(),
        feedback: null,
      };

      await this.pg.upsertConversation(
        sessionId,
        [userMsg, assistantMsg],
        { language: result.language, channel: dto.channel || 'web' },
      );
    } catch (err) {
      this.logger.error(`Failed to persist conversation: ${err.message}`);
    }
  }

  private async trackEvent(data: {
    type: string; sessionId?: string; language?: string; channel?: string;
    latencyMs?: number; tokensUsed?: number; confidenceScore?: number;
    hadContext?: boolean; errorType?: string; metadata?: any;
  }) {
    try {
      await this.pg.trackEvent(data);
    } catch { /* analytics should never crash the chat */ }
  }

  async submitFeedback(
    sessionId: string,
    messageId: string,
    feedback: 'positive' | 'negative',
    note?: string,
  ) {
    return this.pg.updateMessageFeedback(sessionId, messageId, feedback, note);
  }

  async getConversation(sessionId: string) {
    return this.pg.getConversationBySession(sessionId);
  }

  /** True when the user's message is a chart/graph request */
  private isChartRequest(message: string): boolean {
    return /\b(chart|graph|intraday|candlestick|draw|plot|رسم\s*بياني|مخطط|بياني|ارسم)\b/i.test(message);
  }

  /** Parse raw MSX chart-data.aspx response into typed payload for frontend rendering */
  private buildChartPayload(symbol: string, raw: any): {
    symbol: string;
    summary: { open: number; high: number; low: number; last: number; latestTime: string; totalShares: number; totalTurnover: number; tradesCount: number };
    points: Array<{ time: string; ltp: number; shares: number; turnover: number }>;
  } | null {
    const arr: any[] = Array.isArray(raw) ? raw
      : Array.isArray(raw?.d) ? raw.d
      : [];
    if (!arr.length) return null;

    const points = arr
      .map(r => {
        const year   = Number(r.Year   ?? 2000);
        const month  = Number(r.Month  ?? 1);
        const day    = Number(r.Day    ?? 1);
        const h      = Number(r.Hour   ?? 0);
        const min    = Number(r.Minute ?? 0);
        const ltp    = parseFloat(r.LTP ?? 0);
        const shares = parseInt(r.Volume ?? r.Value ?? 0, 10);
        const turnover = parseFloat(r.Turnover) > 0
          ? parseFloat(r.Turnover)
          : parseFloat((ltp * shares).toFixed(3));
        const sortKey = year * 100_000_000 + month * 1_000_000 + day * 10_000 + h * 100 + min;
        const time = `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
        return { time, ltp, shares, turnover, sortKey };
      })
      .filter(p => p.ltp > 0)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(({ time, ltp, shares, turnover }) => ({ time, ltp, shares, turnover }));

    if (!points.length) return null;

    const first = points[0];
    const last  = points[points.length - 1];
    const high  = points.reduce((m, p) => Math.max(m, p.ltp), 0);
    const low   = points.reduce((m, p) => Math.min(m, p.ltp), Infinity);
    const totalShares   = points.reduce((s, p) => s + p.shares, 0);
    const totalTurnover = points.reduce((s, p) => s + p.turnover, 0);

    return {
      symbol: symbol.toUpperCase(),
      summary: {
        open: first.ltp, high, low, last: last.ltp,
        latestTime: last.time,
        totalShares, totalTurnover: parseFloat(totalTurnover.toFixed(3)),
        tradesCount: points.length,
      },
      points,
    };
  }

  async getSuggestions(language: 'ar' | 'en' | 'mixed') {
    if (language === 'ar') {
      return [
        'ما هو سعر سهم بنك مسقط؟',
        'اعرض لي مؤشر سوق مسقط اليوم',
        'أخبرني عن أعلى الأسهم ارتفاعاً',
        'ما هي توزيعات أرباح OQEP؟',
      ];
    }
    return [
      'What is the current MSM30 index value?',
      'Show me top gainers today',
      'What is BKMB dividend history?',
      'How do I start trading on MSX?',
    ];
  }
}
