import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document;

export enum UserRole {
  ADMIN = 'admin',
  AGENT = 'agent',
  USER = 'user',
}

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false }) // never returned in queries
  password: string;

  @Prop({ required: true })
  name: string;

  @Prop({ enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: null })
  lastLoginAt: Date;

  @Prop({ default: null })
  refreshToken: string;

  @Prop({ type: Object, default: {} })
  preferences: Record<string, any>;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Index for fast lookups
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1, isActive: 1 });
