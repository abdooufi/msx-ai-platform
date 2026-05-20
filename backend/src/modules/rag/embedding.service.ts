import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly ollamaUrl: string;
  private readonly model: string;

  constructor(private config: ConfigService) {
    this.ollamaUrl = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.model = config.get<string>('EMBEDDING_MODEL', 'nomic-embed-text');
  }

  /**
   * Generate a vector embedding for a single text string.
   */
  async embed(text: string): Promise<number[]> {
    const cleanText = this.cleanText(text);
    try {
      const { data } = await axios.post(`${this.ollamaUrl}/api/embeddings`, {
        model: this.model,
        prompt: cleanText,
      }, { timeout: 30_000 });

      return data.embedding as number[];
    } catch (err) {
      this.logger.error(`Embedding failed: ${err.message}`);
      throw new Error(`Failed to generate embedding: ${err.message}`);
    }
  }

  /**
   * Batch embed multiple texts in parallel (chunked to avoid OOM).
   */
  async embedBatch(texts: string[], batchSize = 8): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map(t => this.embed(t)));
      results.push(...embeddings);
      this.logger.debug(`Embedded batch ${i / batchSize + 1}/${Math.ceil(texts.length / batchSize)}`);
    }
    return results;
  }

  /**
   * Split text into overlapping chunks for better RAG recall.
   */
  chunkText(
    text: string,
    chunkSize = 512,
    overlap = 64,
  ): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length);
      chunks.push(words.slice(start, end).join(' '));
      if (end === words.length) break;
      start += chunkSize - overlap;
    }
    return chunks;
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s؀-ۿ.,!?;:()\-]/g, '') // keep Arabic chars
      .trim()
      .slice(0, 4096); // cap at model limit
  }
}
