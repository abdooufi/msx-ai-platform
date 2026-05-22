import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { QdrantService, SearchResult } from './qdrant.service';
import { AppPgService } from '../database/app-pg.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';
import { v4 as uuidv4 } from 'uuid';

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

  /**
   * Index a piece of text into Qdrant + PostgreSQL.
   * When `companySymbol` is provided the vectors go into a per-company
   * collection (msx_co_{symbol}). Otherwise they land in msx_knowledge.
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

    let indexed = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk    = chunks[i];
      const qdrantId = uuidv4();
      const textToEmbed = `${input.title}\n\n${chunk}`;

      try {
        const vector = await this.embedding.embed(textToEmbed);

        await this.qdrant.upsert([{
          id:      qdrantId,
          vector,
          payload: {
            title:         input.title,
            content:       chunk,
            sourceId:      input.sourceId,
            type:          input.type,
            url:           input.url || '',
            language:      input.language || 'en',
            chunkIndex:    i,
            tags:          input.tags || [],
            companySymbol: input.companySymbol || null,
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
          metadata:      input.metadata,
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
   */
  async retrieve(query: string, language?: string, companySymbol?: string): Promise<RagContext> {
    const topK      = parseInt(this.config.get('RAG_TOP_K', '5'), 10);
    const threshold = parseFloat(this.config.get('RAG_SCORE_THRESHOLD', '0.4'));

    try {
      const queryVector = await this.embedding.embed(query);

      const filter = language && language !== 'mixed'
        ? { must: [{ key: 'language', match: { any: [language, 'en', 'mixed'] } }] }
        : undefined;

      let results: SearchResult[];

      if (companySymbol) {
        const companyCol = QdrantService.companyCollection(companySymbol);
        // Search company collection + general, merge
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

      if (!results.length) return { context: '', sources: [], hadResults: false };

      // Deduplicate by sourceId (keep highest-scoring chunk)
      const seen = new Map<string, SearchResult>();
      for (const r of results) {
        const sid = r.payload.sourceId;
        if (!seen.has(sid) || seen.get(sid)!.score < r.score) seen.set(sid, r);
      }
      const deduped = [...seen.values()].sort((a, b) => b.score - a.score);

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

      return { context, sources, hadResults: true };
    } catch (err) {
      this.logger.error(`RAG retrieval failed: ${err.message}`);
      return { context: '', sources: [], hadResults: false };
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
