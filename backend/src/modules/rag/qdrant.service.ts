import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

export interface SearchResult {
  id: string;
  score: number;
  payload: Record<string, any>;
}

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly vectorSize: number;

  constructor(private config: ConfigService) {
    this.baseUrl = config.get<string>('QDRANT_URL', 'http://localhost:6333');
    this.collection = config.get<string>('QDRANT_COLLECTION', 'msx_knowledge');
    this.vectorSize = config.get<number>('QDRANT_COLLECTION_SIZE', 768);
  }

  async onModuleInit() {
    await this.ensureCollection();
  }

  /** Create the Qdrant collection if it doesn't exist */
  async ensureCollection(): Promise<void> {
    try {
      // Check if exists
      await axios.get(`${this.baseUrl}/collections/${this.collection}`);
      this.logger.log(`✅ Qdrant collection "${this.collection}" exists`);
    } catch {
      // Create it
      await axios.put(`${this.baseUrl}/collections/${this.collection}`, {
        vectors: {
          size: this.vectorSize,
          distance: 'Cosine',
        },
        optimizers_config: { indexing_threshold: 1000 },
      });
      this.logger.log(`✅ Created Qdrant collection "${this.collection}"`);
    }
  }

  /** Upsert vectors into Qdrant */
  async upsert(points: QdrantPoint[]): Promise<void> {
    const batch = points.map(p => ({
      id: p.id || uuidv4(),
      vector: p.vector,
      payload: p.payload,
    }));

    await axios.put(
      `${this.baseUrl}/collections/${this.collection}/points`,
      { points: batch },
    );
  }

  /** Semantic search — returns top-K results above score threshold */
  async search(
    vector: number[],
    topK = 5,
    scoreThreshold = 0.4,
    filter?: Record<string, any>,
  ): Promise<SearchResult[]> {
    const body: any = {
      vector,
      limit: topK,
      score_threshold: scoreThreshold,
      with_payload: true,
    };
    if (filter) body.filter = filter;

    const { data } = await axios.post(
      `${this.baseUrl}/collections/${this.collection}/points/search`,
      body,
    );

    return (data.result || []).map((r: any) => ({
      id: String(r.id),
      score: r.score,
      payload: r.payload,
    }));
  }

  /** Delete all points with a matching payload field value */
  async deleteByField(field: string, value: string): Promise<void> {
    await axios.post(
      `${this.baseUrl}/collections/${this.collection}/points/delete`,
      {
        filter: {
          must: [{ key: field, match: { value } }],
        },
      },
    );
  }

  /** Collection stats */
  async getStats(): Promise<any> {
    const { data } = await axios.get(
      `${this.baseUrl}/collections/${this.collection}`,
    );
    return data.result;
  }

  /** Count total vectors */
  async count(): Promise<number> {
    const stats = await this.getStats();
    return stats?.points_count ?? 0;
  }
}
