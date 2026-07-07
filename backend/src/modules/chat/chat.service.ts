import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { RagService } from '../rag/rag.service';
import { LlmService, LlmMessage } from '../rag/llm.service';
import { DynamicApiService } from '../admin/dynamic-api.service';
import { ChatbootPgService } from '../admin/chatboot-pg.service';
import { AppPgService } from '../database/app-pg.service';
import { AnswerCacheService } from './answer-cache.service';
import { ChatRequestDto } from './chat.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private pg:         AppPgService,
    private chatPg:     ChatbootPgService,
    private rag:        RagService,
    private llm:        LlmService,
    private dynamicApi: DynamicApiService,
    private cache:      AnswerCacheService,
    private config:     ConfigService,
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
      return language !== 'en'
        ? 'أنا مساعد بورصة مسقط المتخصص ولا أستطيع الإجابة على أسئلة خارج نطاق السوق المالي العُماني. يمكنني مساعدتك في أسعار الأسهم والشركات المدرجة والمؤشرات وبيانات التداول في بورصة مسقط.'
        : "I'm the MSX Stock Exchange Assistant. I can only help with questions about the Muscat Stock Exchange — stocks, companies, market data, and trading. For other topics, please use a dedicated service.";
    }

    return null; // let the LLM decide
  }

  // ── Human handoff ─────────────────────────────────────────────────

  /** True when the user explicitly asks to talk to a human / agent / support */
  private isHandoffRequest(message: string): boolean {
    return /(?:talk|speak|chat|connect)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:human|agent|person|someone|representative|support)|human\s+agent|real\s+person|customer\s+(?:service|support|care)|أريد\s+(?:موظف|التحدث|التكلم)|(?:التحدث|التكلم|الكلام)\s+مع\s+(?:موظف|شخص|إنسان|مسؤول)|خدمة\s+العملاء/i
      .test(message);
  }

  private handoffReply(language: string): string {
    return language !== 'en'
      ? 'أتفهم رغبتك في التحدث مع موظف. يمكنك التواصل مع فريق بورصة مسقط مباشرة عبر صفحة "اتصل بنا" في الموقع الرسمي www.msx.om، وسيسعد الفريق بمساعدتك. تم تسجيل طلبك أيضاً لدى فريق الدعم.'
      : 'I understand you\'d like to speak with a person. You can reach the Muscat Stock Exchange team directly through the "Contact Us" page on the official website www.msx.om — they will be happy to help. Your request has also been logged for the support team.';
  }

  // ── Session tokens ────────────────────────────────────────────────
  // Conversations are readable via GET /chat/session/:id. The id alone is a
  // random UUID, but we additionally require an HMAC token that only the
  // client who ran the session received (sent in every SSE meta event).

  sessionToken(sessionId: string): string {
    const secret = this.config.get<string>('JWT_SECRET', 'dev-secret');
    return createHmac('sha256', secret).update(`session:${sessionId}`).digest('hex').slice(0, 32);
  }

  verifySessionToken(sessionId: string, token: string): boolean {
    if (!token) return false;
    const expected = Buffer.from(this.sessionToken(sessionId));
    const given    = Buffer.from(String(token));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  // ── Admin-editable bot instructions (system_settings) ────────────

  private extraInstructionsCache: { value: string; fetchedAt: number } | null = null;

  /** Extra system-prompt instructions set from Admin → Settings; cached 60 s */
  private async getExtraInstructions(): Promise<string> {
    const now = Date.now();
    if (this.extraInstructionsCache && now - this.extraInstructionsCache.fetchedAt < 60_000) {
      return this.extraInstructionsCache.value;
    }
    let value = '';
    try {
      value = (await this.chatPg.getSetting('bot_instructions')) ?? '';
    } catch { /* table unreachable — no extra instructions */ }
    this.extraInstructionsCache = { value, fetchedAt: now };
    return value;
  }

  // ── Follow-up suggestions ─────────────────────────────────────────

  /**
   * Rule-based follow-up questions shown as clickable chips after an answer.
   * Symbol-aware: suggests the data types the user has NOT just asked about.
   */
  private buildFollowups(message: string, symbol: string | null, language: string): string[] {
    const m  = message.toLowerCase();
    const ar = language !== 'en';
    const out: string[] = [];

    if (symbol) {
      const sym = symbol.toUpperCase();
      const topics: Array<{ re: RegExp; en: string; ar: string }> = [
        { re: /price|سعر/,                       en: `What is the ${sym} share price?`,   ar: `ما هو سعر سهم ${sym}؟` },
        { re: /dividend|توزيع|أرباح/,            en: `Show ${sym} dividend history`,      ar: `اعرض توزيعات أرباح ${sym}` },
        { re: /chart|graph|بياني|مخطط|ارسم/,     en: `Draw the ${sym} intraday chart`,    ar: `ارسم المخطط البياني لسهم ${sym}` },
        { re: /board|مجلس|إدارة/,                en: `Who is on the ${sym} board?`,        ar: `من هم أعضاء مجلس إدارة ${sym}؟` },
        { re: /financial|قوائم|مالية/,           en: `Show ${sym} financial results`,     ar: `اعرض النتائج المالية لـ ${sym}` },
      ];
      for (const t of topics) {
        if (!t.re.test(m)) out.push(ar ? t.ar : t.en);
        if (out.length >= 3) break;
      }
    } else {
      out.push(
        ...(ar
          ? ['ما هو مؤشر سوق مسقط اليوم؟', 'أخبرني عن أعلى الأسهم ارتفاعاً', 'كيف أبدأ التداول في بورصة مسقط؟']
          : ['What is the MSM30 index today?', 'Show me top gainers', 'How do I start trading on MSX?']),
      );
    }
    return out.slice(0, 3);
  }

  // ── SSE helpers ───────────────────────────────────────────────────

  private startSse(res: Response): void {
    if (res.headersSent) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  /**
   * Stream a pre-built answer (refusal, FAQ hit, cache hit…) without an LLM call,
   * then persist the exchange.
   */
  private async sendDirectReply(
    res: Response,
    sessionId: string,
    dto: ChatRequestDto,
    text: string,
    language: string,
    start: number,
    opts: { sources?: any[]; hadContext?: boolean; provider?: string; followups?: string[] } = {},
  ): Promise<void> {
    const sources = opts.sources ?? [];
    this.startSse(res);
    res.write(`data: ${JSON.stringify({
      type: 'meta', sessionId, language,
      sessionToken: this.sessionToken(sessionId),
      sources: sources.slice(0, 3),
      hadContext: opts.hadContext ?? false,
    })}\n\n`);
    if (opts.followups?.length) {
      res.write(`data: ${JSON.stringify({ type: 'followups', suggestions: opts.followups })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
    res.write(`data: ${JSON.stringify({
      done: true, tokensUsed: 0, latencyMs: Date.now() - start,
      ...(opts.provider ? { provider: opts.provider } : {}),
    })}\n\n`);
    res.end();
    await this.persistMessage(sessionId, dto, {
      response: text, language, sources, tokensUsed: 0, latencyMs: Date.now() - start,
    });
  }

  /** Record an unanswered / refused question — never crashes the chat */
  private async logUnanswered(
    question: string, language: string, sessionId: string, reason: string,
  ): Promise<void> {
    try {
      await this.chatPg.logUnansweredQuestion({ question, language, sessionId, reason });
    } catch (err) {
      this.logger.warn(`Failed to log unanswered question: ${err.message}`);
    }
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

    // 2a. Human handoff — user explicitly asked for a person
    if (this.isHandoffRequest(dto.message)) {
      await this.logUnanswered(dto.message, language, sessionId, 'handoff');
      await this.sendDirectReply(res, sessionId, dto, this.handoffReply(language), language, start);
      return;
    }

    // 2b. Off-topic guard — fast path, zero LLM tokens
    const refusal = this.checkOffTopic(dto.message, language);
    if (refusal) {
      await this.logUnanswered(dto.message, language, sessionId, 'off_topic');
      await this.sendDirectReply(res, sessionId, dto, refusal, language, start);
      return;
    }

    // 2c. FAQ match — exact first (free), then semantic (one embedding call).
    //     Both answer straight from the faqs table, no LLM.
    try {
      let faqAnswer: string | null = null;
      const exact = await this.chatPg.findFaqMatch(dto.message);
      if (exact?.answer) {
        faqAnswer = exact.answer;
      } else {
        const sem = await this.rag.faqSemanticMatch(dto.message, language);
        if (sem) {
          const faq = await this.chatPg.getFaqById(sem.pgId);
          if (faq?.answer) {
            faqAnswer = faq.answer;
            this.logger.log(`Semantic FAQ hit (score ${sem.score.toFixed(2)}): "${dto.message}" → "${faq.question}"`);
          }
        }
      }
      if (faqAnswer) {
        await this.sendDirectReply(res, sessionId, dto, faqAnswer, language, start, {
          hadContext: true, provider: 'faq',
          followups: this.buildFollowups(dto.message, null, language),
        });
        await this.trackEvent({
          type: 'message_sent', sessionId, language,
          channel: dto.channel || 'web', latencyMs: Date.now() - start,
          tokensUsed: 0, confidenceScore: 1, hadContext: true,
        });
        return;
      }
    } catch (err) {
      this.logger.warn(`FAQ lookup failed: ${err.message}`); // continue with normal flow
    }

    // 2d. Answer cache — replay identical recent questions (static answers only)
    const cacheable = !(dto.history?.length);
    if (cacheable) {
      const cached = await this.cache.get(dto.message, language);
      if (cached) {
        await this.sendDirectReply(res, sessionId, dto, cached.text, language, start, {
          sources: cached.sources, hadContext: true, provider: 'cache',
        });
        await this.trackEvent({
          type: 'message_sent', sessionId, language,
          channel: dto.channel || 'web', latencyMs: Date.now() - start,
          tokensUsed: 0, confidenceScore: cached.sources[0]?.score ?? 0, hadContext: true,
        });
        return;
      }
    }

    // 3a. Follow-up query rewriting — resolve pronouns/references so retrieval
    //     works on multi-turn conversations ("what about its dividends?").
    //     Retrieval uses the rewritten form; the LLM still sees the original.
    let retrievalQuery = dto.message;
    if (dto.history?.length && this.config.get('RAG_QUERY_REWRITE', 'true') !== 'false') {
      retrievalQuery = await this.llm.rewriteQuery(dto.message, dto.history.slice(-6));
      if (retrievalQuery !== dto.message) {
        this.logger.debug(`Query rewritten for retrieval: "${dto.message}" → "${retrievalQuery}"`);
      }
    }

    // 3b. Detect symbol first (fast DB lookup), then fetch RAG + live data in parallel
    const symbol = await this.dynamicApi.resolveSymbolWithDb(retrievalQuery);
    const ragStart = Date.now();
    const [ragResult, liveData] = await Promise.all([
      this.rag.retrieve(retrievalQuery, language, symbol ?? undefined),
      symbol
        ? this.dynamicApi.fetchDynamicData(retrievalQuery, symbol).catch(() => null)
        : Promise.resolve(null),
    ]);
    const ragLatencyMs = Date.now() - ragStart;
    const { context, sources, hadResults, topScore } = ragResult;

    // Feature #1: Hard confidence threshold — if results exist but top score is too low,
    // refuse rather than risk hallucination on weak context
    const hardThreshold = parseFloat(this.config.get('RAG_HARD_THRESHOLD', '0.55'));
    const belowHardThreshold = hadResults && !liveData && topScore < hardThreshold;

    // Feature #4: Log retrieval audit trail
    await this.pg.logRetrieval({
      sessionId:     sessionId,
      query:         dto.message,
      language,
      topScore,
      sourceCount:   sources.length,
      answered:      !belowHardThreshold && (hadResults || !!liveData),
      refusedReason: belowHardThreshold ? 'low_confidence' : (!hadResults && !liveData ? 'no_data' : undefined),
      latencyMs:     ragLatencyMs,
      sources,
    });

    // 4a. Hard short-circuit — no RAG context AND no live data
    //     → reply directly without calling the LLM so it cannot use training knowledge
    const hasContext = hadResults || !!liveData;
    if (!hasContext) {
      const noDataReply = language !== 'en'
        ? 'لا تتوفر لديّ معلومات كافية حول هذا الموضوع في قاعدة بياناتي. يرجى زيارة www.msx.om للحصول على أحدث المعلومات.'
        : "I don't have enough information about this topic in my knowledge base. Please visit www.msx.om for the latest information.";
      await this.logUnanswered(dto.message, language, sessionId, 'no_data');
      await this.sendDirectReply(res, sessionId, dto, noDataReply, language, start);
      return;
    }

    // 4b-pre. Feature #1: Hard confidence threshold — context found but quality too low
    if (belowHardThreshold) {
      const lowConfidenceReply = language !== 'en'
        ? `وجدت بعض المعلومات ذات الصلة لكنني لست متأكداً بما يكفي (درجة الثقة: ${Math.round(topScore * 100)}%) لتقديم إجابة موثوقة. يرجى زيارة www.msx.om للحصول على بيانات دقيقة أو حاول إعادة صياغة سؤالك.`
        : `I found some related information but my confidence is too low (score: ${Math.round(topScore * 100)}%) to give a reliable answer. Please visit www.msx.om for accurate data, or try rephrasing your question.`;
      await this.logUnanswered(dto.message, language, sessionId, 'low_confidence');
      await this.sendDirectReply(res, sessionId, dto, lowConfidenceReply, language, start);
      return;
    }

    if (liveData) {
      this.logger.log(`Live data injected for symbol: ${symbol}`);
    }

    // 4b. Chart fast-path — bypass LLM, send structured chart data for the frontend to render.
    if (symbol && this.isChartRequest(dto.message)) {
      const rawChart = await this.dynamicApi.getChartData(symbol).catch(() => null);
      const chartPayload = rawChart ? this.buildChartPayload(symbol, rawChart) : null;
      if (chartPayload && chartPayload.points.length > 0) {
        this.startSse(res);
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

        res.write(`data: ${JSON.stringify({ type: 'meta', sessionId, language, sessionToken: this.sessionToken(sessionId), sources: [], hadContext: false })}\n\n`);
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

    // 5. Build conversation history — Feature #12: token-count guard
    //    Approximate tokens: ~4 chars/token for English, ~2 for Arabic.
    //    Reserve MAX_HISTORY_TOKENS for history to keep system + context + response in budget.
    const MAX_HISTORY_TOKENS = parseInt(this.config.get('RAG_MAX_HISTORY_TOKENS', '1500'), 10);
    const approxTokens = (text: string) => Math.ceil(text.length / (language === 'ar' ? 2 : 4));

    const rawHistory = (dto.history || [])
      .slice(-12)                           // cap at 12 before token count
      .filter(h => h.role && h.content);

    let historyTokenCount = 0;
    const historyMessages: LlmMessage[] = [];
    for (const h of [...rawHistory].reverse()) {
      const t = approxTokens(h.content);
      if (historyTokenCount + t > MAX_HISTORY_TOKENS) break;
      historyMessages.unshift({ role: h.role as 'user' | 'assistant', content: h.content });
      historyTokenCount += t;
    }

    // 6. Build system prompt with retrieved context, live data and admin instructions
    const extraInstructions = await this.getExtraInstructions();
    const systemPrompt = this.llm.buildSystemPrompt(language, context, liveData, hasContext, extraInstructions);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: dto.message },
    ];

    // 7. Set SSE headers BEFORE any write
    this.startSse(res);

    // Add source info to SSE before streaming text
    res.write(
      `data: ${JSON.stringify({
        type: 'meta',
        sessionId,
        language,
        sessionToken: this.sessionToken(sessionId),
        sources: sources.slice(0, 3),
        hadContext: hadResults,
      })}\n\n`,
    );

    // Follow-up suggestion chips (rule-based, symbol-aware)
    const followups = this.buildFollowups(dto.message, symbol, language);
    if (followups.length) {
      res.write(`data: ${JSON.stringify({ type: 'followups', suggestions: followups })}\n\n`);
    }

    // 8. Stream LLM response — fullText is buffered during streaming (no second call needed)
    let fullResponse = '';
    let tokensUsed = 0;
    let latencyMs = 0;
    let streamOk = true;

    // For 'auto' mode: pre-resolve provider once so stream uses the same one
    let resolvedProvider: 'ollama' | 'deepseek' | 'claude' | undefined;
    const info = this.llm.getProviderInfo();
    if (info.provider === 'auto') {
      resolvedProvider = this.llm.pickAutoProvider(dto.message, !!liveData);
    }

    try {
      const { tokensUsed: t, latencyMs: l, fullText } = await this.llm.streamToResponse(
        messages,
        res,
        {},
        resolvedProvider,
      );
      tokensUsed   = t;
      latencyMs    = l;
      fullResponse = fullText;
    } catch (err) {
      this.logger.error(`Chat stream error: ${err.message}`);
      streamOk = false;
      fullResponse = language !== 'en'
        ? 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.'
        : 'Sorry, an error occurred. Please try again.';
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ error: fullResponse })}\n\n`);
        res.end();
      }
    }

    latencyMs = latencyMs || (Date.now() - start);

    // Cache static answers only: no live market data, no conversation history
    if (streamOk && cacheable && !liveData && fullResponse) {
      await this.cache.set(dto.message, language, {
        text: fullResponse, language, sources: sources.slice(0, 5),
      });
    }

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

  /**
   * Non-streaming chat — same pipeline as streamChat but returns the full
   * answer as a string. Used by non-SSE channels (Telegram, future WhatsApp…).
   */
  async chatOnce(dto: ChatRequestDto): Promise<{ text: string; language: string; sessionId: string }> {
    const sessionId = dto.sessionId || uuidv4();
    const start = Date.now();
    const language = await this.llm.detectLanguage(dto.message);

    const reply = async (text: string, sources: any[] = [], tokensUsed = 0) => {
      await this.persistMessage(sessionId, dto, {
        response: text, language, sources, tokensUsed, latencyMs: Date.now() - start,
      });
      return { text, language, sessionId };
    };

    // Handoff / off-topic / FAQ / cache fast paths
    if (this.isHandoffRequest(dto.message)) {
      await this.logUnanswered(dto.message, language, sessionId, 'handoff');
      return reply(this.handoffReply(language));
    }
    const refusal = this.checkOffTopic(dto.message, language);
    if (refusal) {
      await this.logUnanswered(dto.message, language, sessionId, 'off_topic');
      return reply(refusal);
    }
    try {
      const faq = await this.chatPg.findFaqMatch(dto.message);
      if (faq?.answer) return reply(faq.answer);
      const sem = await this.rag.faqSemanticMatch(dto.message, language);
      if (sem) {
        const semFaq = await this.chatPg.getFaqById(sem.pgId);
        if (semFaq?.answer) return reply(semFaq.answer);
      }
    } catch { /* continue */ }

    const cacheable = !(dto.history?.length);
    if (cacheable) {
      const cached = await this.cache.get(dto.message, language);
      if (cached) return reply(cached.text, cached.sources);
    }

    // Follow-up rewriting, then RAG + live data
    let retrievalQuery = dto.message;
    if (dto.history?.length && this.config.get('RAG_QUERY_REWRITE', 'true') !== 'false') {
      retrievalQuery = await this.llm.rewriteQuery(dto.message, dto.history.slice(-6));
    }
    const symbol = await this.dynamicApi.resolveSymbolWithDb(retrievalQuery);
    const [ragResult, liveData] = await Promise.all([
      this.rag.retrieve(retrievalQuery, language, symbol ?? undefined),
      symbol
        ? this.dynamicApi.fetchDynamicData(retrievalQuery, symbol).catch(() => null)
        : Promise.resolve(null),
    ]);
    const { context, sources, hadResults, topScore } = ragResult;

    const hardThreshold = parseFloat(this.config.get('RAG_HARD_THRESHOLD', '0.55'));
    const hasContext = hadResults || !!liveData;

    if (!hasContext) {
      await this.logUnanswered(dto.message, language, sessionId, 'no_data');
      return reply(language !== 'en'
        ? 'لا تتوفر لديّ معلومات كافية حول هذا الموضوع في قاعدة بياناتي. يرجى زيارة www.msx.om للحصول على أحدث المعلومات.'
        : "I don't have enough information about this topic in my knowledge base. Please visit www.msx.om for the latest information.");
    }
    if (hadResults && !liveData && topScore < hardThreshold) {
      await this.logUnanswered(dto.message, language, sessionId, 'low_confidence');
      return reply(language !== 'en'
        ? 'وجدت بعض المعلومات ذات الصلة لكنني لست متأكداً بما يكفي لتقديم إجابة موثوقة. يرجى زيارة www.msx.om أو حاول إعادة صياغة سؤالك.'
        : 'I found some related information but my confidence is too low to give a reliable answer. Please visit www.msx.om, or try rephrasing your question.');
    }

    const systemPrompt = this.llm.buildSystemPrompt(
      language, context, liveData, hasContext, await this.getExtraInstructions(),
    );
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...((dto.history || []).slice(-6)
        .filter(h => h.role && h.content)
        .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }))),
      { role: 'user', content: dto.message },
    ];

    try {
      const result = await this.llm.complete(messages);
      if (cacheable && !liveData && result.content) {
        await this.cache.set(dto.message, language, {
          text: result.content, language, sources: sources.slice(0, 5),
        });
      }
      await this.trackEvent({
        type: 'message_sent', sessionId, language,
        channel: dto.channel || 'web', latencyMs: Date.now() - start,
        tokensUsed: result.tokensUsed, confidenceScore: sources[0]?.score ?? 0,
        hadContext: hadResults,
      });
      return reply(result.content, sources, result.tokensUsed);
    } catch (err) {
      this.logger.error(`chatOnce LLM error: ${err.message}`);
      return reply(language !== 'en'
        ? 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.'
        : 'Sorry, an error occurred. Please try again.');
    }
  }

  /** True when the user's message is a chart/graph request */
  private isChartRequest(message: string): boolean {
    // \b does not match around Arabic letters — test Arabic terms separately
    return /\b(chart|graph|intraday|candlestick|draw|plot)\b/i.test(message)
        || /(رسم\s*بياني|مخطط|بياني|ارسم)/.test(message);
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
    if (language === 'ar' || language === 'mixed') {
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
