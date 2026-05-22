import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppPgService } from '../database/app-pg.service';
import { RagService } from '../rag/rag.service';
import { QdrantService } from '../rag/qdrant.service';

@Injectable()
export class AdminService {
  constructor(
    private pg: AppPgService,
    private rag: RagService,
    private qdrant: QdrantService,
    private config: ConfigService,
  ) {}

  async getDashboardStats() {
    const SAFE_PG: any = {
      conversations: 0, messages: 0, failed: 0,
      successRate: 100, avgLatencyMs: 0,
      langBreakdown: {}, dailyMessages: [],
      feedback: { positive: 0, negative: 0 },
    };
    const SAFE_RAG = { qdrantVectors: 0, pgDocuments: 0, companyStats: [] };

    const [pgStats, ragStats] = await Promise.all([
      this.pg.getDashboardStats().catch(() => SAFE_PG),
      this.rag.getStats().catch(() => SAFE_RAG),
    ]);

    return { ...pgStats, ragStats };
  }

  async getConversations(page = 1, limit = 20, filter: Record<string, any> = {}): Promise<any> {
    return this.pg.listConversations(page, limit, { language: filter.language });
  }

  async getFailedQuestions(page = 1, limit = 20) {
    return this.pg.getFailedQuestions(page, limit);
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
}
