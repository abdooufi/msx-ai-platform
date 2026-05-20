import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type KnowledgeDocument = Knowledge & Document;

export enum KnowledgeType {
  WEBSITE = 'website',
  DOCUMENT = 'document',
  DATABASE = 'database',
  MANUAL = 'manual',
}

@Schema({ timestamps: true, collection: 'knowledge' })
export class Knowledge {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  content: string;                 // raw text chunk

  @Prop({ required: true })
  chunkIndex: number;              // chunk position within source

  @Prop({ required: true })
  sourceId: string;                // e.g. URL or document ID

  @Prop({ enum: KnowledgeType, default: KnowledgeType.WEBSITE })
  type: KnowledgeType;

  @Prop()
  url: string;

  @Prop()
  language: string;                // 'ar' | 'en' | 'mixed'

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  qdrantId: string;                // corresponding vector ID in Qdrant

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: null })
  lastIndexedAt: Date;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const KnowledgeSchema = SchemaFactory.createForClass(Knowledge);
KnowledgeSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });
KnowledgeSchema.index({ type: 1, isActive: 1 });
KnowledgeSchema.index({ qdrantId: 1 });
KnowledgeSchema.index({ '$**': 'text' }); // full-text search fallback
