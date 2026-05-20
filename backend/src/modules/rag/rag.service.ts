import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { QdrantService, SearchResult } from './qdrant.service';
import { Knowledge, KnowledgeDocument, KnowledgeType } from '../../schemas/knowledge.schema';
import { v4 as uuidv4 } from 'uuid';

export interface IndexInput {
  title: string;
  content: string;
  sourceId: string;
  type: KnowledgeType;
  url?: string;
  language?: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface RagContext {
  context: string;
  sources: Array<{ title: string; url: string; content: string; score: number; type: string }>;
  hadResults: boolean;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    @InjectModel(Knowledge.name) private knowledgeModel: Model<KnowledgeDocument>,
    private embedding: EmbeddingService,
    private qdrant: QdrantService,
    private config: ConfigService,
  ) {}

  /**
   * Index a piece of text into Qdrant + MongoDB.
   * Text is split into chunks; each chunk gets its own vector.
   */
  async indexContent(input: IndexInput): Promise<number> {
    const chunkSize = parseInt(this.config.get('RAG_CHUNK_SIZE', '512'), 10);
    const overlap = parseInt(this.config.get('RAG_CHUNK_OVERLAP', '64'), 10);
    const chunks = this.embedding.chunkText(input.content, chunkSize, overlap);

    let indexed = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const qdrantId = uuidv4();

      // Build the text that gets embedded (title + chunk for better recall)
      const textToEmbed = `${input.title}\n\n${chunk}`;

      try {
        const vector = await this.embedding.embed(textToEmbed);

        // Upsert into Qdrant
        await this.qdrant.upsert([{
          id: qdrantId,
          vector,
          payload: {
            title: input.title,
            content: chunk,
            sourceId: input.sourceId,
            type: input.type,
            url: input.url || '',
            language: input.language || 'en',
            chunkIndex: i,
            tags: input.tags || [],
            ...input.metadata,
          },
        }]);

        // Save to MongoDB (upsert by sourceId + chunkIndex)
        await this.knowledgeModel.findOneAndUpdate(
          { sourceId: input.sourceId, chunkIndex: i },
          {
            title: input.title,
            content: chunk,
            sourceId: input.sourceId,
            type: input.type,
            url: input.url,
            language: input.language,
            tags: input.tags,
            qdrantId,
            isActive: true,
            lastIndexedAt: new Date(),
            metadata: input.metadata,
          },
          { upsert: true },
        );

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
   * Returns formatted context string + source list.
   */
  async retrieve(query: string, language?: string): Promise<RagContext> {
    const topK = parseInt(this.config.get('RAG_TOP_K', '5'), 10);
    const threshold = parseFloat(this.config.get('RAG_SCORE_THRESHOLD', '0.4'));

    try {
      const queryVector = await this.embedding.embed(query);

      // Optional filter by language (if detected with confidence)
      const filter = language && language !== 'mixed'
        ? { must: [{ key: 'language', match: { any: [language, 'en', 'mixed'] } }] }
        : undefined;

      const results: SearchResult[] = await this.qdrant.search(
        queryVector, topK, threshold, filter,
      );

      if (!results.length) {
        return { context: '', sources: [], hadResults: false };
      }

      // Deduplicate by sourceId (keep highest-scoring chunk)
      const seen = new Map<string, SearchResult>();
      for (const r of results) {
        const sid = r.payload.sourceId;
        if (!seen.has(sid) || seen.get(sid)!.score < r.score) {
          seen.set(sid, r);
        }
      }
      const deduped = [...seen.values()].sort((a, b) => b.score - a.score);

      const sources = deduped.map(r => ({
        title: r.payload.title || '',
        url: r.payload.url || '',
        content: r.payload.content || '',
        score: Math.round(r.score * 100) / 100,
        type: r.payload.type || 'website',
      }));

      // Build context block for the LLM
      const context = sources
        .map((s, i) => `[${i + 1}] ${s.title}\nSource: ${s.url || 'internal'}\n${s.content}`)
        .join('\n\n---\n\n');

      return { context, sources, hadResults: true };
    } catch (err) {
      this.logger.error(`RAG retrieval failed: ${err.message}`);
      return { context: '', sources: [], hadResults: false };
    }
  }

  /** Delete all knowledge from a specific source (e.g. re-crawl) */
  async deleteSource(sourceId: string): Promise<void> {
    await this.qdrant.deleteByField('sourceId', sourceId);
    await this.knowledgeModel.deleteMany({ sourceId });
    this.logger.log(`Deleted all knowledge for source: ${sourceId}`);
  }

  async getStats() {
    const [qdrantCount, mongoCount] = await Promise.all([
      this.qdrant.count(),
      this.knowledgeModel.countDocuments({ isActive: true }),
    ]);
    return { qdrantVectors: qdrantCount, mongoDocuments: mongoCount };
  }
}
