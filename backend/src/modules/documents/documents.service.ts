import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AppPgService } from '../database/app-pg.service';
import { DOCUMENTS_QUEUE } from './documents.constants';

@Injectable()
export class DocumentsService {
  constructor(
    private pg: AppPgService,
    @InjectQueue(DOCUMENTS_QUEUE) private docsQueue: Queue,
  ) {}

  async upload(
    file: Express.Multer.File,
    userId: string,
    meta: { tags?: string[]; description?: string },
  ) {
    const doc = await this.pg.createDocument({
      originalName: file.originalname,
      filename:     file.filename,
      mimeType:     file.mimetype,
      sizeBytes:    file.size,
      uploadedBy:   userId,
      tags:         meta.tags || [],
      description:  meta.description,
    });

    // Enqueue for async processing
    await this.docsQueue.add('process-document', {
      docId:    doc._id,
      filePath: file.path,
      mimeType: file.mimetype,
      title:    file.originalname,
    });

    return doc;
  }

  async list(page = 1, limit = 20) {
    return this.pg.listDocuments(page, limit);
  }

  async delete(id: string) {
    return this.pg.deleteDocument(id);
  }

  /** Re-queue a failed or stuck document for re-processing */
  async retry(id: string) {
    const doc = await this.pg.getDocument(id);
    if (!doc) throw new Error(`Document not found: ${id}`);

    // Reset status to pending
    await this.pg.updateDocumentStatus(id, {
      status:        'pending',
      chunksIndexed: 0,
    });

    const uploadsDir = process.env.UPLOADS_DIR || './uploads';
    const filePath   = `${uploadsDir}/${doc.filename}`;

    await this.docsQueue.add('process-document', {
      docId:    id,
      filePath,
      mimeType: doc.mimeType,
      title:    doc.originalName,
    });

    return { ok: true, docId: id };
  }
}
