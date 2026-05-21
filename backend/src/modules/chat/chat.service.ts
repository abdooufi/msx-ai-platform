import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RagService } from '../rag/rag.service';
import { LlmService, LlmMessage } from '../rag/llm.service';
import { DynamicApiService } from '../admin/dynamic-api.service';
import {
  Conversation,
  ConversationDocument,
  MessageRole,
  MessageStatus,
} from '../../schemas/conversation.schema';
import {
  AnalyticsEvent,
  AnalyticsEventDocument,
  EventType,
} from '../../schemas/analytics.schema';
import { ChatRequestDto } from './chat.dto';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(AnalyticsEvent.name)
    private analyticsModel: Model<AnalyticsEventDocument>,
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

    // 3. Resolve symbol + RAG in parallel
    const [ragResult, symbol] = await Promise.all([
      this.rag.retrieve(dto.message, language),
      this.dynamicApi.resolveSymbolWithDb(dto.message),
    ]);
    const { context, sources, hadResults } = ragResult;

    // 4. Fetch live market data (sequential — needs symbol first)
    const liveData = symbol
      ? await this.dynamicApi.fetchDynamicData(dto.message, symbol).catch(() => null)
      : null;

    if (liveData) {
      this.logger.log(`Live data injected for symbol: ${symbol}`);
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
      type: EventType.MESSAGE_SENT,
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
        _id: new Types.ObjectId(),
        role: MessageRole.USER,
        content: dto.message,
        language: result.language,
        status: MessageStatus.SUCCESS,
        sources: [],
        createdAt: new Date(),
        feedback: null,
      };

      const assistantMsg = {
        _id: new Types.ObjectId(),
        role: MessageRole.ASSISTANT,
        content: result.response,
        language: result.language,
        status: MessageStatus.SUCCESS,
        sources: result.sources.slice(0, 5),
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
        confidenceScore: result.sources[0]?.score ?? 0,
        createdAt: new Date(),
        feedback: null,
      };

      await this.conversationModel.findOneAndUpdate(
        { sessionId },
        {
          $push: { messages: { $each: [userMsg, assistantMsg] } },
          $setOnInsert: {
            sessionId,
            language: result.language,
            channel: dto.channel || 'web',
          },
        },
        { upsert: true, new: true },
      );
    } catch (err) {
      this.logger.error(`Failed to persist conversation: ${err.message}`);
    }
  }

  private async trackEvent(data: Partial<AnalyticsEvent>) {
    try {
      await this.analyticsModel.create(data);
    } catch { /* analytics should never crash the chat */ }
  }

  async submitFeedback(
    sessionId: string,
    messageId: string,
    feedback: 'positive' | 'negative',
    note?: string,
  ) {
    await this.conversationModel.updateOne(
      { sessionId, 'messages._id': new Types.ObjectId(messageId) },
      {
        $set: {
          'messages.$.feedback': feedback,
          'messages.$.feedbackNote': note,
        },
      },
    );
    return { ok: true };
  }

  async getConversation(sessionId: string) {
    return this.conversationModel
      .findOne({ sessionId })
      .select('-messages.sources') // lighter response for client
      .lean();
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
