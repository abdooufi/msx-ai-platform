import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly ollamaUrl: string;
  readonly model: string;

  private readonly embedTimeout: number;

  constructor(private config: ConfigService) {
    this.ollamaUrl    = config.get<string>('OLLAMA_URL', 'http://localhost:11434');
    this.model        = config.get<string>('EMBEDDING_MODEL', 'nomic-embed-text');
    this.embedTimeout = parseInt(config.get('EMBEDDING_TIMEOUT', '120000'), 10);
  }

  /**
   * Generate a vector embedding for a single text string.
   * Tries the new Ollama /api/embed endpoint first (v0.1.26+),
   * then falls back to the legacy /api/embeddings endpoint.
   * Retries up to 3 times with exponential back-off before throwing.
   */
  async embed(text: string, retries = 3): Promise<number[]> {
    const cleanText = this.cleanText(text);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this.callOllamaEmbed(cleanText);
      } catch (err) {
        const status = err?.response?.status;
        const isLast = attempt === retries;

        // Model not found — no point retrying, surface a clear message
        if (status === 404) {
          const msg = `Embedding model '${this.model}' not found in Ollama. Run: ollama pull ${this.model}`;
          this.logger.error(msg);
          throw new Error(msg);
        }

        if (isLast) {
          this.logger.error(`Embedding failed after ${retries} attempts: ${err.message}`);
          throw new Error(`Failed to generate embedding: ${err.message}`);
        }
        const wait = attempt * 2_000; // 2s, 4s
        this.logger.warn(`Embedding attempt ${attempt} failed (${err.message}) — retrying in ${wait / 1000}s…`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    // unreachable — keeps TS happy
    throw new Error('Embedding failed');
  }

  /**
   * Calls Ollama embed — tries new /api/embed first, falls back to /api/embeddings.
   * New API (Ollama ≥0.1.26): POST /api/embed  { model, input }  → { embeddings: [[...]] }
   * Old API (Ollama <0.1.26):  POST /api/embeddings { model, prompt } → { embedding: [...] }
   */
  private async callOllamaEmbed(text: string): Promise<number[]> {
    // ── New API ──────────────────────────────────────────────────────────────
    try {
      const { data } = await axios.post(
        `${this.ollamaUrl}/api/embed`,
        { model: this.model, input: text },
        { timeout: this.embedTimeout },
      );
      // New API returns { embeddings: number[][] }
      const vec = data.embeddings?.[0] ?? data.embedding;
      if (Array.isArray(vec) && vec.length > 0) return vec as number[];
      throw new Error('Empty embedding in /api/embed response');
    } catch (newErr) {
      this.logger.debug(`/api/embed failed (${newErr.message}), trying /api/embeddings…`);
    }

    // ── Legacy API ────────────────────────────────────────────────────────────
    const { data } = await axios.post(
      `${this.ollamaUrl}/api/embeddings`,
      { model: this.model, prompt: text },
      { timeout: this.embedTimeout },
    );
    const vec = data.embedding;
    if (Array.isArray(vec) && vec.length > 0) return vec as number[];
    throw new Error('Empty embedding in /api/embeddings response');
  }

  /**
   * Batch embed multiple texts sequentially (safe for slow/CPU Ollama).
   */
  async embedBatch(texts: string[], batchSize = 4): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      // Sequential within each batch — avoids overloading a CPU-bound Ollama
      for (const t of batch) {
        results.push(await this.embed(t));
      }
      this.logger.debug(`Embedded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)}`);
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
