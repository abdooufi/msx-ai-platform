import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { EmbeddingService } from './embedding.service';
import { QdrantService, SearchResult } from './qdrant.service';
import { AppPgService } from '../database/app-pg.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';

export interface IndexInput {
  title:          string;
  content:        string;
  sourceId:       string;
  type:           KnowledgeType;
  url?:           string;
  language?:      string;
  metadata?:      Record<string, any>;
  tags?:          string[];
  /** If set, vectors are stored in the company-specific collection msx_co_{symbol} */
  companySymbol?: string;
}

export interface RagContext {
  context:    string;
  sources:    Array<{ title: string; url: string; content: string; score: number; type: string }>;
  hadResults: boolean;
  /** Highest relevance score among returned chunks (0 if no results) */
  topScore:   number;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private pg:        AppPgService,
    private embedding: EmbeddingService,
    private qdrant:    QdrantService,
    private config:    ConfigService,
  ) {}

  // ─── Deterministic chunk ID ───────────────────────────────────────────────
  /**
   * Generate a deterministic UUID-shaped ID for a chunk so that
   * re-indexing the same content is a true upsert (no duplicates).
   * Format: first 32 hex chars of SHA-256("sourceId:chunkIndex") split as 8-4-4-4-12.
   */
  private chunkId(sourceId: string, chunkIndex: number): string {
    const h = createHash('sha256').update(`${sourceId}:${chunkIndex}`).digest('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
  }

  /**
   * Index a piece of text into Qdrant + PostgreSQL.
   * Chunk IDs are deterministic so repeated indexing of the same source
   * produces true upserts instead of duplicates.
   * When `companySymbol` is provided vectors go into msx_co_{symbol}.
   */
  async indexContent(input: IndexInput): Promise<number> {
    const chunkSize = parseInt(this.config.get('RAG_CHUNK_SIZE', '512'), 10);
    const overlap   = parseInt(this.config.get('RAG_CHUNK_OVERLAP', '64'), 10);
    const chunks    = this.embedding.chunkText(input.content, chunkSize, overlap);

    // Resolve target collection — create company collection on-the-fly if needed
    let targetCollection: string | undefined;
    if (input.companySymbol) {
      targetCollection = await this.qdrant.ensureCompanyCollection(input.companySymbol);
      this.logger.log(`Indexing "${input.title}" → collection ${targetCollection}`);
    }

    const embeddingModel = this.embedding.model;
    const indexedAt      = new Date().toISOString();

    let indexed = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk    = chunks[i];
      // Deterministic ID — same source+chunk always gets same ID (true upsert)
      const qdrantId = this.chunkId(input.sourceId, i);
      const textToEmbed = `${input.title}\n\n${chunk}`;

      try {
        const vector = await this.embedding.embed(textToEmbed);

        await this.qdrant.upsert([{
          id:      qdrantId,
          vector,
          payload: {
            title:          input.title,
            content:        chunk,
            sourceId:       input.sourceId,
            type:           input.type,
            url:            input.url || '',
            language:       input.language || 'en',
            chunkIndex:     i,
            tags:           input.tags || [],
            companySymbol:  input.companySymbol || null,
            embeddingModel, // Feature #3: model version tracking
            indexedAt,      // Feature #13: freshness tracking
            ...input.metadata,
          },
        }], targetCollection);

        await this.pg.upsertKnowledgeChunk({
          title:         input.title,
          content:       chunk,
          chunkIndex:    i,
          sourceId:      input.sourceId,
          type:          input.type,
          url:           input.url,
          language:      input.language,
          tags:          input.tags,
          qdrantId,
          metadata:      { ...input.metadata, embeddingModel, indexedAt },
          companySymbol: input.companySymbol,
        });

        indexed++;
      } catch (err) {
        this.logger.error(`Failed to index chunk ${i} of "${input.title}": ${err.message}`);
      }
    }

    this.logger.log(`Indexed ${indexed}/${chunks.length} chunks for "${input.title}"`);
    return indexed;
  }

  /**
   * Retrieve the best matching context for a user query.
   *
   * Strategy:
   *   – If a companySymbol is provided → search the company collection first,
   *     then also search msx_knowledge for complementary context.
   *     Results are merged and re-ranked by score.
   *   – Without a symbol → search only msx_knowledge (existing behaviour).
   *
   * Feature #11: Language-weighted scoring — chunks matching the query language
   *   receive a small boost so same-language results rank higher.
   *
   * Feature #1: topScore is returned so the caller can enforce a hard threshold.
   */
  async retrieve(query: string, language?: string, companySymbol?: string): Promise<RagContext> {
    const topK          = parseInt(this.config.get('RAG_TOP_K', '5'), 10);
    const threshold     = parseFloat(this.config.get('RAG_SCORE_THRESHOLD', '0.4'));
    const langBoost     = parseFloat(this.config.get('RAG_LANG_BOOST', '0.05')); // Feature #11

    try {
      const queryVector = await this.embedding.embed(query);

      const filter = language && language !== 'mixed'
        ? { must: [{ key: 'language', match: { any: [language, 'en', 'mixed'] } }] }
        : undefined;

      let results: SearchResult[];

      if (companySymbol) {
        const companyCol = QdrantService.companyCollection(companySymbol);
        results = await this.qdrant.searchMultiple(
          queryVector,
          [companyCol, this.qdrant.defaultCollection],
          topK,
          threshold,
          filter,
        );
        this.logger.debug(`RAG: searched [${companyCol}, ${this.qdrant.defaultCollection}] for "${query}"`);
      } else {
        results = await this.qdrant.search(queryVector, topK, threshold, filter);
      }

      if (!results.length) return { context: '', sources: [], hadResults: false, topScore: 0 };

      // Feature #11: Apply language score boost for matching-language chunks
      if (language && language !== 'mixed') {
        results = results.map(r => ({
          ...r,
          score: r.payload.language === language ? r.score + langBoost : r.score,
        }));
        // Re-sort after boosting
        results.sort((a, b) => b.score - a.score);
      }

      // Feature #3: Log embedding model mismatch warnings
      const currentModel = this.embedding.model;
      for (const r of results) {
        if (r.payload.embeddingModel && r.payload.embeddingModel !== currentModel) {
          this.logger.warn(
            `⚠️ Embedding model mismatch: stored="${r.payload.embeddingModel}" current="${currentModel}" — consider re-indexing`,
          );
          break; // warn once per query
        }
      }

      // Deduplicate by sourceId (keep highest-scoring chunk)
      const seen = new Map<string, SearchResult>();
      for (const r of results) {
        const sid = r.payload.sourceId;
        if (!seen.has(sid) || seen.get(sid)!.score < r.score) seen.set(sid, r);
      }
      const deduped = [...seen.values()].sort((a, b) => b.score - a.score);

      const topScore = deduped[0]?.score ?? 0; // Feature #1

      const sources = deduped.map(r => ({
        title:   r.payload.title || '',
        url:     r.payload.url || '',
        content: r.payload.content || '',
        score:   Math.round(r.score * 100) / 100,
        type:    r.payload.type || 'website',
      }));

      const context = sources
        .map((s, i) => `[${i + 1}] ${s.title}\nSource: ${s.url || 'internal'}\n${s.content}`)
        .join('\n\n---\n\n');

      return { context, sources, hadResults: true, topScore };
    } catch (err) {
      this.logger.error(`RAG retrieval failed: ${err.message}`);
      return { context: '', sources: [], hadResults: false, topScore: 0 };
    }
  }

  /**
   * Semantic FAQ match — vector search restricted to indexed FAQ chunks
   * (metadata.table === 'faqs', written by PgIndexingService).
   * Returns the matching FAQ's PG id only when similarity is very high,
   * so rephrasings hit but loosely-related questions don't.
   */
  async faqSemanticMatch(
    query: string,
    language?: string,
  ): Promise<{ pgId: string; score: number } | null> {
    const threshold = parseFloat(this.config.get('RAG_FAQ_SEMANTIC_THRESHOLD', '0.88'));
    try {
      const vector = await this.embedding.embed(query);
      const filter = { must: [{ key: 'table', match: { value: 'faqs' } }] };
      const results = await this.qdrant.search(vector, 1, threshold, filter);
      const top = results[0];
      if (!top?.payload?.pgId) return null;
      // Same-language FAQs only (mixed queries accept either)
      if (language && language !== 'mixed'
          && top.payload.language && top.payload.language !== language) {
        return null;
      }
      return { pgId: String(top.payload.pgId), score: top.score };
    } catch (err) {
      this.logger.warn(`FAQ semantic match failed: ${err.message}`);
      return null;
    }
  }

  /** Delete all knowledge from a specific source across all collections */
  async deleteSource(sourceId: string, companySymbol?: string): Promise<void> {
    const collections = companySymbol
      ? [QdrantService.companyCollection(companySymbol), this.qdrant.defaultCollection]
      : [this.qdrant.defaultCollection];

    await Promise.all(
      collections.map(c => this.qdrant.deleteByField('sourceId', sourceId, c).catch(() => {})),
    );
    await this.pg.deleteKnowledgeBySource(sourceId);
    this.logger.log(`Deleted knowledge for source: ${sourceId}`);
  }

  /** Delete ALL knowledge for a company (drops the collection + PG rows) */
  async deleteCompanyKnowledge(symbol: string): Promise<void> {
    const col = QdrantService.companyCollection(symbol);
    await this.qdrant.deleteCollection(col);
    await this.pg.deleteKnowledgeByCompany(symbol);
    this.logger.log(`Deleted all knowledge for company: ${symbol}`);
  }

  async getStats() {
    const [qdrantCount, pgDocuments, companyStats] = await Promise.all([
      this.qdrant.count(),
      this.pg.countActiveKnowledge(),
      this.qdrant.companyCollectionStats(),
    ]);
    return { qdrantVectors: qdrantCount, pgDocuments, companyStats };
  }
}
