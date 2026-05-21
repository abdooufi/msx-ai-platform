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

  /**
   * Main streaming chat endpoint.
   * 1. Detect language
   * 2. Retrieve RAG context from Qdrant
   * 3. Build LLM messages
   * 4. Stream response via SSE
   * 5. Persist conversation
   */
  async streamChat(dto: ChatRequestDto, res: Response): Promise<void> {
    const sessionId = dto.sessionId || uuidv4();
    const start = Date.now();

    // 1. Detect language
    const language = await this.llm.detectLanguage(dto.message);

    // 2. Resolve company symbol (static patterns + DB alias fallback) in parallel with RAG
    const [ragResult, symbol] = await Promise.all([
      this.rag.retrieve(dto.message, language),
      this.dynamicApi.resolveSymbolWithDb(dto.message),
    ]);
    const { context, sources, hadResults } = ragResult;

    // 3. Fetch live market data for the resolved symbol (sequential — needs symbol first)
    const liveData = symbol
      ? await this.dynamicApi.fetchDynamicData(dto.message, symbol).catch(() => null)
      : null;

    if (liveData) {
      this.logger.log(`Live data injected for symbol: ${symbol}`);
    }

    // 4. Build conversation history (last 10 turns for context window)
    const historyMessages: LlmMessage[] = (dto.history || [])
      .slice(-10)
      .filter(h => h.role && h.content)
      .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

    // 5. Build system prompt with retrieved context and live data
    const systemPrompt = this.llm.buildSystemPrompt(language, context, liveData);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: dto.message },
    ];

    // Set SSE headers BEFORE any write (headers must be sent before body)
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

    // 6. Stream LLM response
    let fullResponse = '';
    let tokensUsed = 0;
    let latencyMs = 0;

    try {
      // Intercept the stream to capture the full response for saving
      const { tokensUsed: t, latencyMs: l } = await this.llm.streamToResponse(
        messages,
        res,
        { stream: true },
      );
      tokensUsed = t;
      latencyMs = l;

      // We need the full text — re-run without stream for saving
      // (In production you'd buffer the stream instead for efficiency)
      const result = await this.llm.complete(messages);
      fullResponse = result.content;
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
