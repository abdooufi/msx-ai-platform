import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AnalyticsEventDocument = AnalyticsEvent & Document;

export enum EventType {
  MESSAGE_SENT = 'message_sent',
  MESSAGE_FAILED = 'message_failed',
  SESSION_START = 'session_start',
  SESSION_END = 'session_end',
  FEEDBACK_GIVEN = 'feedback_given',
  HANDOFF = 'handoff',
  DOCUMENT_UPLOADED = 'document_uploaded',
  TRAINING_STARTED = 'training_started',
  TRAINING_COMPLETED = 'training_completed',
}

@Schema({ timestamps: true, collection: 'analytics' })
export class AnalyticsEvent {
  @Prop({ enum: EventType, required: true, index: true })
  type: EventType;

  @Prop({ index: true })
  sessionId: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ default: 'web' })
  channel: string;

  @Prop({ type: Number })
  latencyMs: number;

  @Prop({ type: Number })
  confidenceScore: number;

  @Prop({ type: Number })
  tokensUsed: number;

  @Prop({ type: Boolean })
  hadContext: boolean; // did RAG return results?

  @Prop()
  errorType: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const AnalyticsEventSchema = SchemaFactory.createForClass(AnalyticsEvent);
AnalyticsEventSchema.index({ createdAt: -1 });
AnalyticsEventSchema.index({ type: 1, createdAt: -1 });
AnalyticsEventSchema.index({ language: 1, createdAt: -1 });
