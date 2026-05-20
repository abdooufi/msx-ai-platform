import { IsString, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChatRequestDto {
  @ApiProperty({ example: 'What is the current price of OQBI?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @ApiProperty({ example: 'sess_abc123', required: false })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  history?: Array<{ role: string; content: string }>;

  @ApiProperty({ example: 'web', required: false })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userId?: string;
}

export class FeedbackDto {
  @IsString()
  messageId: string;

  @IsString()
  sessionId: string;

  @IsString()
  feedback: 'positive' | 'negative';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
