import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bull';
import { Model } from 'mongoose';
import { Queue } from 'bull';
import { UploadedDocument, UploadedDocumentDocument } from '../../schemas/uploaded-document.schema';
import { DOCUMENTS_QUEUE } from './documents.constants';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(UploadedDocument.name)
    private docModel: Model<UploadedDocumentDocument>,
    @InjectQueue(DOCUMENTS_QUEUE) private docsQueue: Queue,
  ) {}

  async upload(
    file: Express.Multer.File,
    userId: string,
    meta: { tags?: string[]; description?: string },
  ) {
    const doc = await this.docModel.create({
      originalName: file.originalname,
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: userId,
      tags: meta.tags || [],
      description: meta.description,
    });

    // Enqueue for async processing
    await this.docsQueue.add('process-document', {
      docId: doc._id.toString(),
      filePath: file.path,
      mimeType: file.mimetype,
      title: file.originalname,
    });

    return doc;
  }

  async list(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [docs, total] = await Promise.all([
      this.docModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.docModel.countDocuments(),
    ]);
    return { docs, total, page, pages: Math.ceil(total / limit) };
  }

  async delete(id: string) {
    await this.docModel.findByIdAndDelete(id);
    // Also remove from RAG
    const { RagService } = await import('../rag/rag.service');
    return { ok: true };
  }
}

