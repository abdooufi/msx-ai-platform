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
  readonly baseUrl: string;
  readonly defaultCollection: string;
  readonly vectorSize: number;

  constructor(private config: ConfigService) {
    this.baseUrl           = config.get<string>('QDRANT_URL', 'http://localhost:6333');
    this.defaultCollection = config.get<string>('QDRANT_COLLECTION', 'msx_knowledge');
    this.vectorSize        = parseInt(config.get('QDRANT_COLLECTION_SIZE', '768'), 10);
  }

  async onModuleInit() {
    await this.ensureCollection();
  }

  // ─── Collection management ────────────────────────────────────────

  /** Returns the canonical collection name for a company symbol */
  static companyCollection(symbol: string): string {
    return `msx_co_${symbol.toLowerCase()}`;
  }

  /** Create a Qdrant collection if it doesn't already exist */
  async ensureCollection(collectionName?: string): Promise<void> {
    const name = collectionName ?? this.defaultCollection;
    try {
      const res = await axios.get(`${this.baseUrl}/collections/${name}`);
      if (res.data?.result) {
        this.logger.log(`✅ Qdrant collection "${name}" exists`);
        return;
      }
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        this.logger.warn(`Qdrant check failed: ${err?.message} — will try to create`);
      }
    }
    try {
      await axios.put(`${this.baseUrl}/collections/${name}`, {
        vectors: { size: this.vectorSize, distance: 'Cosine' },
      });
      this.logger.log(`✅ Created Qdrant collection "${name}"`);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        this.logger.log(`✅ Qdrant collection "${name}" already exists`);
      } else {
        this.logger.error(
          `Failed to create Qdrant collection "${name}": ${err?.response?.data?.status?.error || err?.message}`,
        );
      }
    }
  }

  /** Ensure a per-company collection exists */
  async ensureCompanyCollection(symbol: string): Promise<string> {
    const name = QdrantService.companyCollection(symbol);
    await this.ensureCollection(name);
    return name;
  }

  /** List all existing collection names */
  async listCollections(): Promise<string[]> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/collections`);
      return (data.result?.collections ?? []).map((c: any) => c.name as string);
    } catch {
      return [];
    }
  }

  /** Delete a collection entirely */
  async deleteCollection(collectionName: string): Promise<void> {
    try {
      await axios.delete(`${this.baseUrl}/collections/${collectionName}`);
      this.logger.log(`Deleted Qdrant collection "${collectionName}"`);
    } catch (err: any) {
      this.logger.warn(`Could not delete collection "${collectionName}": ${err?.message}`);
    }
  }

  // ─── Data operations ──────────────────────────────────────────────

  /** Upsert vectors into a collection */
  async upsert(points: QdrantPoint[], collectionName?: string): Promise<void> {
    const name  = collectionName ?? this.defaultCollection;
    const batch = points.map(p => ({
      id:      p.id || uuidv4(),
      vector:  p.vector,
      payload: p.payload,
    }));
    await axios.put(`${this.baseUrl}/collections/${name}/points`, { points: batch });
  }

  /** Semantic search — returns top-K results above score threshold */
  async search(
    vector: number[],
    topK            = 5,
    scoreThreshold  = 0.4,
    filter?:         Record<string, any>,
    collectionName?: string,
  ): Promise<SearchResult[]> {
    const name  = collectionName ?? this.defaultCollection;
    const body: any = {
      vector,
      limit:           topK,
      score_threshold: scoreThreshold,
      with_payload:    true,
    };
    if (filter) body.filter = filter;
    try {
      const { data } = await axios.post(
        `${this.baseUrl}/collections/${name}/points/search`,
        body,
      );
      return (data.result || []).map((r: any) => ({
        id:      String(r.id),
        score:   r.score,
        payload: r.payload,
      }));
    } catch (err: any) {
      // Collection may not exist yet — return empty rather than crashing
      if (err?.response?.status === 404) return [];
      throw err;
    }
  }

  /** Search multiple collections and return merged results */
  async searchMultiple(
    vector: number[],
    collections:    string[],
    topK            = 5,
    scoreThreshold  = 0.4,
    filter?:         Record<string, any>,
  ): Promise<SearchResult[]> {
    const all = await Promise.all(
      collections.map(c => this.search(vector, topK, scoreThreshold, filter, c)),
    );
    // Merge, sort by score desc, take topK
    return all
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Delete all points with a matching payload field value */
  async deleteByField(field: string, value: string, collectionName?: string): Promise<void> {
    const name = collectionName ?? this.defaultCollection;
    try {
      await axios.post(`${this.baseUrl}/collections/${name}/points/delete`, {
        filter: { must: [{ key: field, match: { value } }] },
      });
    } catch (err: any) {
      if (err?.response?.status !== 404) throw err;
    }
  }

  /** Collection stats */
  async getStats(collectionName?: string): Promise<any> {
    const name = collectionName ?? this.defaultCollection;
    try {
      const { data } = await axios.get(`${this.baseUrl}/collections/${name}`);
      return data.result;
    } catch { return null; }
  }

  /** Count total vectors in a collection */
  async count(collectionName?: string): Promise<number> {
    const stats = await this.getStats(collectionName);
    return stats?.points_count ?? 0;
  }

  /** Stats for all company collections */
  async companyCollectionStats(): Promise<Array<{ symbol: string; collection: string; vectors: number }>> {
    const all = await this.listCollections();
    const companyCols = all.filter(c => c.startsWith('msx_co_'));
    const stats = await Promise.all(
      companyCols.map(async (col) => ({
        symbol:     col.replace('msx_co_', '').toUpperCase(),
        collection: col,
        vectors:    await this.count(col),
      })),
    );
    return stats.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
}
