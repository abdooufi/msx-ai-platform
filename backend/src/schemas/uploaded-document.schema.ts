import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UploadedDocumentDocument = UploadedDocument & Document;

export enum DocStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  INDEXED = 'indexed',
  FAILED = 'failed',
}

@Schema({ timestamps: true, collection: 'uploaded_documents' })
export class UploadedDocument {
  @Prop({ required: true })
  originalName: string;

  @Prop({ required: true })
  filename: string;             // stored filename on disk

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  sizeBytes: number;

  @Prop({ enum: DocStatus, default: DocStatus.PENDING })
  status: DocStatus;

  @Prop({ default: 0 })
  chunksIndexed: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  uploadedBy: Types.ObjectId;

  @Prop()
  errorMessage: string;

  @Prop()
  language: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop()
  description: string;

  @Prop({ default: null })
  processedAt: Date;
}

export const UploadedDocumentSchema = SchemaFactory.createForClass(UploadedDocument);
UploadedDocumentSchema.index({ status: 1 });
UploadedDocumentSchema.index({ createdAt: -1 });
