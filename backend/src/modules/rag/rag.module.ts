import { Module, Global } from '@nestjs/common';
import { RagService } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { LlmService } from './llm.service';

@Global() // RAG services available everywhere
@Module({
  providers: [RagService, EmbeddingService, QdrantService, LlmService],
  exports: [RagService, EmbeddingService, QdrantService, LlmService],
})
export class RagModule {}
