import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { AppPgService } from '../database/app-pg.service';
import { DocumentsProcessor } from './documents.processor';
import { DOCUMENTS_QUEUE, PROCESS_DOC_JOB, CHECK_URL_JOB } from './documents.constants';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private pg: AppPgService,
    private processor: DocumentsProcessor,
    @InjectQueue(DOCUMENTS_QUEUE) private docsQueue: Queue,
  ) {}

  // ── File upload ───────────────────────────────────────────────────────────

  async upload(
    file: Express.Multer.File,
    userId: string,
    meta: { tags?: string[]; description?: string; companySymbol?: string },
  ) {
    // Auto-detect symbol from filename if not provided
    const symbol = meta.companySymbol?.trim().toUpperCase()
      || this.processor.detectSymbol(file.originalname)
      || undefined;

    const doc = await this.pg.createDocument({
      originalName:  file.originalname,
      filename:      file.filename,
      mimeType:      file.mimetype,
      sizeBytes:     file.size,
      uploadedBy:    userId,
      tags:          meta.tags || [],
      description:   meta.description,
      companySymbol: symbol,
    });

    await this.docsQueue.add(PROCESS_DOC_JOB, {
      docId:         doc._id,
      filePath:      file.path,
      mimeType:      file.mimetype,
      title:         file.originalname,
      companySymbol: symbol ?? null,
    });

    return doc;
  }

  // ── URL ingestion (immediate) ─────────────────────────────────────────────

  /**
   * Fetch a URL, find all document links, download new ones (skipping already-indexed by filename),
   * and queue each for processing.
   */
  async uploadFromUrl(
    url: string,
    companySymbol?: string,
  ): Promise<{ queued: number; skipped: number; files: string[] }> {
    const links = await this.processor.fetchDocumentLinks(url);
    this.logger.log(`URL scan: ${links.length} document links at ${url}`);

    // Queue a one-off check-url job (no scheduleId — instant run)
    const job = await this.docsQueue.add(CHECK_URL_JOB, {
      url,
      companySymbol: companySymbol?.toUpperCase() ?? null,
      scheduleId:    null,
    }, { priority: 3 });

    return {
      queued:  links.length, // approximate; actual dedup happens inside the job
      skipped: 0,
      files:   links.map(l => l.split('/').pop() ?? l),
    };
  }

  // ── URL watch schedule ────────────────────────────────────────────────────

  async setUrlSchedule(url: string, cron: string, companySymbol?: string) {
    // Cancel any existing schedule for this URL
    const existing = await this.pg.getUrlScheduleByUrl(url);
    if (existing) {
      await this.cancelRepeatableById(existing.id);
      await this.pg.deleteUrlSchedule(existing.id);
    }

    const id = uuidv4();
    await this.pg.createUrlSchedule({ id, url, companySymbol, cron });

    await this.docsQueue.add(
      CHECK_URL_JOB,
      { url, companySymbol: companySymbol?.toUpperCase() ?? null, scheduleId: id },
      { repeat: { cron }, jobId: `url-watch-${id}` },
    );

    this.logger.log(`⏰ URL schedule set: "${cron}" → ${url}`);
    return this.pg.getUrlScheduleById(id);
  }

  async getUrlSchedules() {
    return this.pg.listUrlSchedules();
  }

  async cancelUrlSchedule(id: string) {
    const schedule = await this.pg.getUrlScheduleById(id);
    if (!schedule) throw new Error(`Schedule not found: ${id}`);

    await this.cancelRepeatableById(id);
    await this.pg.deleteUrlSchedule(id);

    this.logger.log(`⏰ URL schedule cancelled: ${schedule.url}`);
    return { ok: true };
  }

  private async cancelRepeatableById(id: string) {
    const jobs = await this.docsQueue.getRepeatableJobs().catch(() => []);
    for (const j of jobs) {
      if (j.id === `url-watch-${id}`) {
        await this.docsQueue.removeRepeatableByKey(j.key).catch(() => {});
      }
    }
  }

  // ── Standard CRUD ─────────────────────────────────────────────────────────

  async list(page = 1, limit = 20) {
    return this.pg.listDocuments(page, limit);
  }

  async delete(id: string) {
    return this.pg.deleteDocument(id);
  }

  async retry(id: string) {
    const doc = await this.pg.getDocument(id);
    if (!doc) throw new Error(`Document not found: ${id}`);

    await this.pg.updateDocumentStatus(id, { status: 'pending', chunksIndexed: 0 });

    const uploadsDir = process.env.UPLOAD_DIR || './uploads';
    const filePath   = `${uploadsDir}/${doc.filename}`;

    await this.docsQueue.add(PROCESS_DOC_JOB, {
      docId:         id,
      filePath,
      mimeType:      doc.mimeType,
      title:         doc.originalName,
      companySymbol: doc.companySymbol ?? null,
    });

    return { ok: true, docId: id };
  }
}
