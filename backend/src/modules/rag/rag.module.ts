import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RagService } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { QdrantService } from './qdrant.service';
import { LlmService } from './llm.service';
import { Knowledge, KnowledgeSchema } from '../../schemas/knowledge.schema';

@Global() // RAG services available everywhere
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Knowledge.name, schema: KnowledgeSchema }]),
  ],
  providers: [RagService, EmbeddingService, QdrantService, LlmService],
  exports: [RagService, EmbeddingService, QdrantService, LlmService],
})
export class RagModule {}
