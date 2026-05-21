import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { extname } from 'path';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import { RagService } from '../rag/rag.service';
import { AppPgService } from '../database/app-pg.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';
import { DOCUMENTS_QUEUE } from './documents.constants';

@Processor(DOCUMENTS_QUEUE)
export class DocumentsProcessor {
  private readonly logger = new Logger(DocumentsProcessor.name);

  constructor(
    private pg: AppPgService,
    private rag: RagService,
  ) {}

  @Process('process-document')
  async processDocument(
    job: Job<{ docId: string; filePath: string; mimeType: string; title: string }>,
  ) {
    const { docId, filePath, mimeType, title } = job.data;

    await this.pg.updateDocumentStatus(docId, { status: 'processing' });

    try {
      const text = await this.extractText(filePath, mimeType);

      if (!text || text.length < 50) {
        throw new Error('Could not extract text from document');
      }

      const chunksIndexed = await this.rag.indexContent({
        title,
        content: text,
        sourceId: `doc:${docId}`,
        type: KnowledgeType.DOCUMENT,
        metadata: { docId, mimeType },
      });

      await this.pg.updateDocumentStatus(docId, {
        status:        'indexed',
        chunksIndexed,
        processedAt:   new Date(),
      });

      this.logger.log(`✅ Indexed document ${title} → ${chunksIndexed} chunks`);
    } catch (err) {
      this.logger.error(`Failed to process document ${docId}: ${err.message}`);
      await this.pg.updateDocumentStatus(docId, {
        status:       'failed',
        errorMessage: err.message,
      });
      throw err;
    }
  }

  private async extractText(filePath: string, mimeType: string): Promise<string> {
    const ext = extname(filePath).toLowerCase();
    const buffer = readFileSync(filePath);

    if (ext === '.pdf') {
      const data = await pdfParse(buffer);
      return data.text;
    }

    if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }

    if (ext === '.csv' || ext === '.txt') {
      return buffer.toString('utf-8');
    }

    if (ext === '.xlsx' || ext === '.xls') {
      // Dynamic import to keep bundle small
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buffer);
      const texts: string[] = [];
      wb.SheetNames.forEach(name => {
        const ws = wb.Sheets[name];
        texts.push(XLSX.utils.sheet_to_csv(ws));
      });
      return texts.join('\n\n');
    }

    throw new Error(`Unsupported file type: ${ext}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`Document job ${job.id} failed: ${err.message}`);
  }
}
