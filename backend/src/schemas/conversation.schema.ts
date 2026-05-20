import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConversationDocument = Conversation & Document;
export type MessageDocument = Message & Document;

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
}

export enum MessageStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
}

@Schema({ _id: false })
export class Source {
  @Prop() title: string;
  @Prop() url: string;
  @Prop() content: string;
  @Prop() score: number;
  @Prop() type: string; // 'website' | 'document' | 'database'
}

@Schema({ _id: false })
export class Message {
  @Prop({ type: Types.ObjectId, auto: true }) _id: Types.ObjectId;
  @Prop({ enum: MessageRole, required: true }) role: MessageRole;
  @Prop({ required: true }) content: string;
  @Prop({ default: 'en' }) language: string;
  @Prop({ enum: MessageStatus, default: MessageStatus.SUCCESS }) status: MessageStatus;
  @Prop() errorMessage: string;
  @Prop({ type: [Source], default: [] }) sources: Source[];
  @Prop() confidenceScore: number;        // 0–1 how confident the AI is
  @Prop({ type: Number }) tokensUsed: number;
  @Prop({ type: Number }) latencyMs: number;
  @Prop({ default: Date.now }) createdAt: Date;

  // Admin feedback
  @Prop({ type: String, enum: ['positive', 'negative', null], default: null })
  feedback: string | null;
  @Prop() feedbackNote: string;
}

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ required: true, index: true })
  sessionId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId: Types.ObjectId | null;

  @Prop({ default: 'anonymous' })
  userName: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ default: 'web' })
  channel: string; // 'web' | 'widget' | 'whatsapp' | 'telegram'

  @Prop({ type: [Message], default: [] })
  messages: Message[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: null })
  handoffAt: Date; // when transferred to live agent

  @Prop()
  userAgent: string;

  @Prop()
  ipAddress: string;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ sessionId: 1 });
ConversationSchema.index({ createdAt: -1 });
ConversationSchema.index({ 'messages.status': 1 });
ConversationSchema.index({ language: 1, createdAt: -1 });
