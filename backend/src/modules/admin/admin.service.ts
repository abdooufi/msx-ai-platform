import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Conversation, ConversationDocument } from '../../schemas/conversation.schema';
import { AnalyticsEvent, AnalyticsEventDocument, EventType } from '../../schemas/analytics.schema';
import { Knowledge, KnowledgeDocument, KnowledgeType } from '../../schemas/knowledge.schema';
import { RagService } from '../rag/rag.service';
import { QdrantService } from '../rag/qdrant.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Conversation.name)
    private convModel: Model<ConversationDocument>,
    @InjectModel(AnalyticsEvent.name)
    private analyticsModel: Model<AnalyticsEventDocument>,
    @InjectModel(Knowledge.name)
    private knowledgeModel: Model<KnowledgeDocument>,
    private rag: RagService,
    private qdrant: QdrantService,
    private config: ConfigService,
  ) {}

  async getDashboardStats() {
    const since30d = new Date(Date.now() - 30 * 24 * 3600_000);

    const [
      totalConversations,
      totalMessages,
      failedMessages,
      positiveFeedback,
      negativeFeedback,
      ragStats,
      langBreakdown,
      dailyMessages,
    ] = await Promise.all([
      this.convModel.countDocuments(),
      this.analyticsModel.countDocuments({ type: EventType.MESSAGE_SENT }),
      this.analyticsModel.countDocuments({ type: EventType.MESSAGE_FAILED }),
      this.convModel.countDocuments({ 'messages.feedback': 'positive' }),
      this.convModel.countDocuments({ 'messages.feedback': 'negative' }),
      this.rag.getStats(),
      this.getLanguageBreakdown(),
      this.getDailyMessageVolume(30),
    ]);

    const avgLatency = await this.analyticsModel.aggregate([
      { $match: { type: EventType.MESSAGE_SENT, createdAt: { $gte: since30d } } },
      { $group: { _id: null, avg: { $avg: '$latencyMs' } } },
    ]);

    return {
      conversations: totalConversations,
      messages: totalMessages,
      failed: failedMessages,
      successRate: totalMessages > 0
        ? Math.round(((totalMessages - failedMessages) / totalMessages) * 100)
        : 100,
      feedback: { positive: positiveFeedback, negative: negativeFeedback },
      avgLatencyMs: Math.round(avgLatency[0]?.avg ?? 0),
      ragStats,
      langBreakdown,
      dailyMessages,
    };
  }

  async getConversations(page = 1, limit = 20, filter: Record<string, any> = {}): Promise<any> {
    const skip = (page - 1) * limit;
    const query = { ...filter };

    const [convs, total] = await Promise.all([
      this.convModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('sessionId language channel createdAt messages')
        .lean(),
      this.convModel.countDocuments(query),
    ]);

    return {
      conversations: convs.map(c => ({
        ...c,
        messageCount: c.messages?.length || 0,
        lastMessage: c.messages?.slice(-1)[0]?.content?.substring(0, 100),
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async getFailedQuestions(page = 1, limit = 20) {
    // Messages where no RAG context was found (confidence = 0)
    return this.convModel.aggregate([
      { $unwind: '$messages' },
      { $match: { 'messages.role': 'assistant', 'messages.confidenceScore': { $lt: 0.3 } } },
      { $sort: { 'messages.createdAt': -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $project: {
          sessionId: 1,
          question: '$messages.content',
          score: '$messages.confidenceScore',
          language: '$messages.language',
          date: '$messages.createdAt',
        },
      },
    ]);
  }

  getSettings() {
    return {
      llmModel:            this.config.get('LLM_MODEL',             'qwen2.5:7b'),
      embeddingModel:      this.config.get('EMBEDDING_MODEL',       'nomic-embed-text'),
      ollamaUrl:           this.config.get('OLLAMA_URL',            'http://ollama:11434'),
      ragTopK:             this.config.get<number>('RAG_TOP_K',     5),
      ragScoreThreshold:   this.config.get<number>('RAG_SCORE_THRESHOLD', 0.5),
      ragChunkSize:        this.config.get<number>('RAG_CHUNK_SIZE', 512),
      qdrantCollection:    this.config.get('QDRANT_COLLECTION',     'msx_knowledge'),
      qdrantCollectionSize:this.config.get<number>('QDRANT_COLLECTION_SIZE', 768),
      scraperTargetUrl:    this.config.get('SCRAPER_TARGET_URL',    'https://www.msx.om'),
      scraperRecrawlHours: this.config.get<number>('SCRAPER_RECRAWL_HOURS', 24),
      scraperMaxPages:     this.config.get<number>('SCRAPER_MAX_PAGES', 500),
      adminEmail:          this.config.get('ADMIN_EMAIL',           'admin@msx.om'),
      nodeEnv:             this.config.get('NODE_ENV',              'production'),
    };
  }

  private async getLanguageBreakdown() {
    const result = await this.analyticsModel.aggregate([
      { $match: { type: EventType.MESSAGE_SENT } },
      { $group: { _id: '$language', count: { $sum: 1 } } },
    ]);
    return Object.fromEntries(result.map(r => [r._id, r.count]));
  }

  private async getDailyMessageVolume(days: number) {
    const since = new Date(Date.now() - days * 24 * 3600_000);
    return this.analyticsModel.aggregate([
      { $match: { type: EventType.MESSAGE_SENT, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
  }
}
