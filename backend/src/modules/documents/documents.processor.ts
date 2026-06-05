import { Processor, Process, OnQueueFailed, InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { Logger } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join, basename } from 'path';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as AdmZip from 'adm-zip';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import { RagService } from '../rag/rag.service';
import { AppPgService } from '../database/app-pg.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';
import { DOCUMENTS_QUEUE, PROCESS_DOC_JOB, CHECK_URL_JOB } from './documents.constants';

// File extensions the system can index
const INDEXABLE_EXT = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt']);

// Regex to detect a company symbol segment in a filename, e.g. "2_OQEP_..." or "BKMB_report.pdf"
const SYMBOL_RE = /(?:^|_)([A-Z]{2,8})(?:_|\.)/;

@Processor(DOCUMENTS_QUEUE)
export class DocumentsProcessor {
  private readonly logger = new Logger(DocumentsProcessor.name);

  constructor(
    private pg:       AppPgService,
    private rag:      RagService,
    @InjectQueue(DOCUMENTS_QUEUE) private docsQueue: Queue,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // process-document
  // ════════════════════════════════════════════════════════════════

  @Process(PROCESS_DOC_JOB)
  async processDocument(
    job: Job<{ docId: string; filePath: string; mimeType: string; title: string; companySymbol?: string | null }>,
  ) {
    const { docId, filePath, mimeType, title, companySymbol } = job.data;

    await this.pg.updateDocumentStatus(docId, { status: 'processing' });

    try {
      const ext = extname(filePath).toLowerCase();

      // ── ZIP: extract each file and queue separately ────────────────────
      if (ext === '.zip') {
        this.logger.log(`📦 Extracting ZIP: ${title}`);
        const queued = await this.extractAndQueueZip(filePath, companySymbol ?? undefined);
        await this.pg.updateDocumentStatus(docId, {
          status:        'indexed',
          chunksIndexed: queued,
          processedAt:   new Date(),
        });
        this.logger.log(`✅ ZIP ${title} → ${queued} files queued`);
        return;
      }

      // ── Regular file ───────────────────────────────────────────────────
      const text = await this.extractText(filePath, mimeType);

      if (!text || text.length < 50) {
        throw new Error('Could not extract text from document');
      }

      // Auto-detect symbol from filename if not already set
      const symbol = companySymbol ?? this.detectSymbol(title);

      const chunksIndexed = await this.rag.indexContent({
        title,
        content:       text,
        sourceId:      `doc:${docId}`,
        type:          KnowledgeType.DOCUMENT,
        metadata:      { docId, mimeType },
        companySymbol: symbol || undefined,
      });

      await this.pg.updateDocumentStatus(docId, {
        status:        'indexed',
        chunksIndexed,
        processedAt:   new Date(),
      });

      this.logger.log(`✅ Indexed document ${title} → ${chunksIndexed} chunks${symbol ? ` [${symbol}]` : ''}`);
    } catch (err) {
      this.logger.error(`Failed to process document ${docId}: ${err.message}`);
      await this.pg.updateDocumentStatus(docId, {
        status:       'failed',
        errorMessage: err.message,
      });
      throw err;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // check-url  (URL-watch scheduled job)
  // ════════════════════════════════════════════════════════════════

  @Process(CHECK_URL_JOB)
  async checkUrl(
    job: Job<{ url: string; companySymbol?: string | null; scheduleId: string }>,
  ) {
    const { url, companySymbol, scheduleId } = job.data;
    this.logger.log(`🔗 Checking URL for new documents: ${url}`);

    let filesQueued = 0;

    try {
      const links = await this.fetchDocumentLinks(url);
      this.logger.log(`  Found ${links.length} document links at ${url}`);

      const uploadsDir = process.env.UPLOAD_DIR || './uploads';
      if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

      for (const link of links) {
        try {
          const originalName = this.filenameFromUrl(link);
          const ext          = extname(originalName).toLowerCase();

          if (!INDEXABLE_EXT.has(ext) && ext !== '.zip') continue;

          // Skip duplicates
          const exists = await this.pg.documentExistsByName(originalName);
          if (exists) {
            this.logger.debug(`  Skip (already indexed): ${originalName}`);
            continue;
          }

          // Download the file
          this.logger.log(`  ↓ Downloading: ${originalName}`);
          const response = await axios.get<Buffer>(link, {
            responseType: 'arraybuffer',
            timeout:      60_000,
            maxContentLength: 100 * 1024 * 1024, // 100 MB max
          });

          const buffer   = Buffer.from(response.data);
          const mimeType = String(response.headers['content-type'] ?? '').split(';')[0] || 'application/octet-stream';
          const filename = `${uuidv4()}${ext}`;
          const filePath = join(uploadsDir, filename);

          writeFileSync(filePath, buffer);

          // Auto-detect symbol from filename
          const symbol = companySymbol ?? this.detectSymbol(originalName) ?? undefined;

          // Create DB record
          const doc = await this.pg.createDocument({
            originalName,
            filename,
            mimeType,
            sizeBytes:     buffer.length,
            tags:          [],
            companySymbol: symbol,
          });

          // Queue for processing
          await this.docsQueue.add(PROCESS_DOC_JOB, {
            docId:         doc._id,
            filePath,
            mimeType,
            title:         originalName,
            companySymbol: symbol ?? null,
          });

          filesQueued++;
          this.logger.log(`  ✅ Queued: ${originalName}${symbol ? ` [${symbol}]` : ''}`);
        } catch (fileErr) {
          this.logger.warn(`  ⚠️  Failed to process link ${link}: ${fileErr.message}`);
        }
      }

      // Update schedule stats
      if (scheduleId) {
        await this.pg.updateUrlScheduleRun(scheduleId, filesQueued).catch(() => {});
      }

      this.logger.log(`🔗 URL check complete: ${filesQueued} new files queued from ${url}`);
    } catch (err) {
      this.logger.error(`URL check failed for ${url}: ${err.message}`);
      throw err;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════════

  /** Extract files from a ZIP, save each to uploads, queue process-document */
  private async extractAndQueueZip(zipPath: string, companySymbol?: string): Promise<number> {
    const zip         = new AdmZip(zipPath);
    const entries     = zip.getEntries().filter(e => !e.isDirectory);
    const uploadsDir  = process.env.UPLOAD_DIR || './uploads';
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

    let queued = 0;

    for (const entry of entries) {
      const originalName = basename(entry.entryName);
      const ext          = extname(originalName).toLowerCase();

      if (!INDEXABLE_EXT.has(ext)) continue;

      // Dedup by name
      const exists = await this.pg.documentExistsByName(originalName);
      if (exists) {
        this.logger.debug(`ZIP skip (exists): ${originalName}`);
        continue;
      }

      try {
        const buffer   = entry.getData();
        const mimeType = this.mimeFromExt(ext);
        const filename = `${uuidv4()}${ext}`;
        const filePath = join(uploadsDir, filename);

        writeFileSync(filePath, buffer);

        const symbol = companySymbol ?? this.detectSymbol(originalName) ?? undefined;

        const doc = await this.pg.createDocument({
          originalName,
          filename,
          mimeType,
          sizeBytes:     buffer.length,
          tags:          [],
          companySymbol: symbol,
        });

        await this.docsQueue.add(PROCESS_DOC_JOB, {
          docId:         doc._id,
          filePath,
          mimeType,
          title:         originalName,
          companySymbol: symbol ?? null,
        });

        queued++;
      } catch (e) {
        this.logger.warn(`ZIP entry failed: ${originalName}: ${e.message}`);
      }
    }

    return queued;
  }

  /** Fetch a URL and return all document download links found on the page */
  async fetchDocumentLinks(url: string): Promise<string[]> {
    const response = await axios.get<string>(url, {
      timeout: 30_000,
      headers: { 'User-Agent': 'Mozilla/5.0 MSX-DocBot/1.0' },
    });

    const $ = cheerio.load(response.data);
    const docExtRe = /\.(pdf|docx?|xlsx?|csv|txt|zip)(\?.*)?$/i;
    const found = new Set<string>();
    const base  = new URL(url);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!docExtRe.test(href)) return;
      try {
        found.add(new URL(href, base).toString());
      } catch {}
    });

    return [...found];
  }

  /** Derive a clean filename from a URL */
  private filenameFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const p = decodeURIComponent(u.pathname);
      return basename(p) || `download_${Date.now()}`;
    } catch {
      return `download_${Date.now()}`;
    }
  }

  /**
   * Try to detect a company symbol from a filename like:
   *   "2_OQEP_report.pdf"  →  "OQEP"
   *   "BKMB_annual.pdf"    →  "BKMB"
   */
  detectSymbol(name: string): string | null {
    // Try the underscore-delimited pattern first
    const m = SYMBOL_RE.exec(name.toUpperCase());
    if (m) return m[1];
    return null;
  }

  /** Extract readable text from a file based on its extension */
  private async extractText(filePath: string, mimeType: string): Promise<string> {
    const ext    = extname(filePath).toLowerCase();
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
      const XLSX = await import('xlsx');
      const wb   = XLSX.read(buffer);
      const texts: string[] = [];
      wb.SheetNames.forEach(n => texts.push(XLSX.utils.sheet_to_csv(wb.Sheets[n])));
      return texts.join('\n\n');
    }

    throw new Error(`Unsupported file type: ${ext}`);
  }

  private mimeFromExt(ext: string): string {
    const map: Record<string, string> = {
      '.pdf':  'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc':  'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls':  'application/vnd.ms-excel',
      '.csv':  'text/csv',
      '.txt':  'text/plain',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  @OnQueueFailed()
  async onFailed(job: Job, err: Error) {
    this.logger.error(`Document job ${job.id} (${job.name}) failed: ${err.message}`);
    // Feature #7: Log permanently failed jobs to DB dead-letter table
    const maxAttempts = job.opts?.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      await this.pg.logFailedJob({
        queue:         DOCUMENTS_QUEUE,
        jobId:         job.id,
        jobName:       job.name,
        attemptsMade:  job.attemptsMade,
        errorMessage:  err.message,
        jobData:       { docId: job.data?.docId, title: job.data?.title },
      }).catch(() => {});
      this.logger.error(`🚨 Document job ${job.id} permanently failed after ${job.attemptsMade} attempts — docId: ${job.data?.docId}`);
    }
  }
}
