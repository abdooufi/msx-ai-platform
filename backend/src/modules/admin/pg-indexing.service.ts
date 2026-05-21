import { Injectable, Logger } from '@nestjs/common';
import { RagService } from '../rag/rag.service';
import { QdrantService } from '../rag/qdrant.service';
import { KnowledgeType } from '../../schemas/knowledge.schema';
import { ChatbootPgService } from './chatboot-pg.service';

export type IndexableTable = 'knowledge_base' | 'faqs' | 'api_endpoints' | 'companies';

export interface TableIndexStatus {
  table: IndexableTable;
  pgRows: number;
  indexedChunks: number;
  status: 'idle' | 'indexing' | 'done' | 'error';
  progress: number;      // 0-100
  lastRun?: Date;
  error?: string;
}

@Injectable()
export class PgIndexingService {
  private readonly logger = new Logger(PgIndexingService.name);

  private status: Record<IndexableTable, TableIndexStatus> = {
    knowledge_base: { table: 'knowledge_base', pgRows: 0, indexedChunks: 0, status: 'idle', progress: 0 },
    faqs:           { table: 'faqs',           pgRows: 0, indexedChunks: 0, status: 'idle', progress: 0 },
    api_endpoints:  { table: 'api_endpoints',  pgRows: 0, indexedChunks: 0, status: 'idle', progress: 0 },
    companies:      { table: 'companies',      pgRows: 0, indexedChunks: 0, status: 'idle', progress: 0 },
  };

  constructor(
    private pg: ChatbootPgService,
    private rag: RagService,
    private qdrant: QdrantService,
  ) {}

  getStatus(): TableIndexStatus[] {
    return Object.values(this.status);
  }

  getTableStatus(table: IndexableTable): TableIndexStatus {
    return this.status[table];
  }

  // ─── Index all tables ─────────────────────────────────────────────────────

  async indexAll(): Promise<void> {
    const tables: IndexableTable[] = ['knowledge_base', 'faqs', 'api_endpoints', 'companies'];
    for (const t of tables) {
      await this.indexTable(t);
    }
  }

  // ─── Index a single table ─────────────────────────────────────────────────

  async indexTable(table: IndexableTable): Promise<void> {
    if (this.status[table].status === 'indexing') {
      this.logger.warn(`${table} is already indexing — skipped`);
      return;
    }

    this.status[table] = {
      ...this.status[table],
      status: 'indexing',
      progress: 0,
      error: undefined,
    };

    try {
      switch (table) {
        case 'knowledge_base': await this.indexKnowledgeBase(); break;
        case 'faqs':           await this.indexFaqs();          break;
        case 'api_endpoints':  await this.indexApiEndpoints();  break;
        case 'companies':      await this.indexCompanies();     break;
      }
      this.status[table].status   = 'done';
      this.status[table].progress = 100;
      this.status[table].lastRun  = new Date();
    } catch (err) {
      this.status[table].status = 'error';
      this.status[table].error  = err.message;
      this.logger.error(`Failed to index ${table}: ${err.message}`);
    }
  }

  // ─── Clear a table's indexed vectors ─────────────────────────────────────

  async clearTableIndex(table: IndexableTable): Promise<{ message: string }> {
    try {
      // Each vector has payload.table set to the table name — delete all matching
      await this.qdrant.deleteByField('table', table);
      this.logger.log(`Cleared Qdrant vectors for table: ${table}`);
    } catch (err) {
      this.logger.warn(`Could not clear Qdrant for ${table}: ${err.message}`);
    }

    this.status[table] = {
      ...this.status[table],
      indexedChunks: 0,
      status: 'idle',
      progress: 0,
    };

    return { message: `Cleared index for table: ${table}` };
  }

  // ─── knowledge_base ───────────────────────────────────────────────────────

  private async indexKnowledgeBase(): Promise<void> {
    const PAGE = 50;
    let page   = 1;
    let total  = 0;
    let done   = 0;
    let chunks = 0;

    // Get total count first
    const first = await this.pg.getKnowledgeBase(1, 1);
    total = first.total;
    this.status.knowledge_base.pgRows = total;

    while (true) {
      const { data } = await this.pg.getKnowledgeBase(page, PAGE);
      if (!data.length) break;

      for (const row of data) {
        // Get full content
        const full = await this.pg.getKnowledgeEntry(row.id);
        if (!full?.content) continue;

        const indexed = await this.rag.indexContent({
          title:    full.title,
          content:  full.content,
          sourceId: `pg:knowledge_base:${full.id}`,
          type:     KnowledgeType.DOCUMENT,
          url:      full.source || '',
          language: this.detectLang(full.content),
          metadata: { table: 'knowledge_base', pgId: full.id, category: full.category || '' },
          tags:     Array.isArray(full.tags) ? full.tags : [],
        });
        chunks += indexed;
        done++;
        this.status.knowledge_base.progress = Math.round((done / total) * 100);
        this.status.knowledge_base.indexedChunks = chunks;
      }
      page++;
      if (data.length < PAGE) break;
    }
    this.logger.log(`knowledge_base: indexed ${done} rows → ${chunks} chunks`);
  }

  // ─── faqs ─────────────────────────────────────────────────────────────────

  private async indexFaqs(): Promise<void> {
    const { data, total } = await this.pg.getFaqs(1, 200);
    this.status.faqs.pgRows = total;
    let chunks = 0;

    for (let i = 0; i < data.length; i++) {
      const faq = data[i];
      // Embed question + answer together for best retrieval
      const content = `Q: ${faq.question}\nA: ${faq.answer}`;
      const indexed = await this.rag.indexContent({
        title:    faq.question,
        content,
        sourceId: `pg:faqs:${faq.id}`,
        type:     KnowledgeType.MANUAL,
        language: this.detectLang(faq.question),
        metadata: { table: 'faqs', pgId: faq.id, category: faq.category || '' },
      });
      chunks += indexed;
      this.status.faqs.progress      = Math.round(((i + 1) / data.length) * 100);
      this.status.faqs.indexedChunks = chunks;
    }
    this.logger.log(`faqs: indexed ${data.length} rows → ${chunks} chunks`);
  }

  // ─── api_endpoints ────────────────────────────────────────────────────────

  private async indexApiEndpoints(): Promise<void> {
    const { data, total } = await this.pg.getApiEndpoints(1, 200);
    this.status.api_endpoints.pgRows = total;
    let chunks = 0;

    for (let i = 0; i < data.length; i++) {
      const ep = data[i];
      const kwEn = Array.isArray(ep.keywords_en) ? ep.keywords_en.join(', ') : '';
      const kwAr = Array.isArray(ep.keywords_ar) ? ep.keywords_ar.join(', ') : '';
      const content = [
        ep.description || '',
        kwEn ? `Keywords: ${kwEn}` : '',
        kwAr ? `الكلمات المفتاحية: ${kwAr}` : '',
        `Method: ${ep.method || 'GET'}  URL: ${ep.url}`,
      ].filter(Boolean).join('\n');

      const indexed = await this.rag.indexContent({
        title:    ep.name,
        content,
        sourceId: `pg:api_endpoints:${ep.id}`,
        type:     KnowledgeType.DOCUMENT,
        url:      ep.url,
        metadata: { table: 'api_endpoints', pgId: ep.id, category: ep.category || '' },
        tags:     [ep.category].filter(Boolean),
      });
      chunks += indexed;
      this.status.api_endpoints.progress      = Math.round(((i + 1) / data.length) * 100);
      this.status.api_endpoints.indexedChunks = chunks;
    }
    this.logger.log(`api_endpoints: indexed ${data.length} rows → ${chunks} chunks`);
  }

  // ─── companies ────────────────────────────────────────────────────────────

  private async indexCompanies(): Promise<void> {
    // Fetch all companies in pages of 500 to handle large tables
    let page = 1;
    const PAGE = 500;
    let total = 0;
    let done = 0;
    let chunks = 0;

    // Get total first
    const first = await this.pg.getCompanies(1, 1);
    total = first.total;
    this.status.companies.pgRows = total;
    if (!total) return;

    while (true) {
      const { data } = await this.pg.getCompanies(page, PAGE);
      if (!data.length) break;

      for (const co of data) {
        // Use actual column names: long_name_en, short_name_en, long_name_ar, short_name_ar, url, clone_name, market_id
        const nameEn = co.long_name_en  || co.short_name_en || co.symbol;
        const nameAr = co.long_name_ar  || co.short_name_ar || '';
        const content = [
          nameEn                                          ? `Company: ${nameEn}`                 : '',
          nameAr                                          ? `Arabic Name: ${nameAr}`              : '',
          co.clone_name  && co.clone_name !== co.symbol  ? `Also known as: ${co.clone_name}`     : '',
          co.market_id                                   ? `Market: ${co.market_id}`             : '',
          co.url                                         ? `Website: ${co.url}`                  : '',
        ].filter(Boolean).join('\n');

        if (!content.trim()) continue;

        const indexed = await this.rag.indexContent({
          title:    `${nameEn} (${co.symbol})`,
          content,
          sourceId: `pg:companies:${co.id}`,
          type:     KnowledgeType.DOCUMENT,
          url:      co.url || '',
          language: nameAr ? 'ar' : 'en',
          metadata: { table: 'companies', pgId: co.id, symbol: co.symbol, market: co.market_id || '' },
        });
        chunks += indexed;
        done++;
        this.status.companies.progress      = Math.round((done / total) * 100);
        this.status.companies.indexedChunks = chunks;
      }

      page++;
      if (data.length < PAGE) break;
    }
    this.logger.log(`companies: indexed ${done} rows → ${chunks} chunks`);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private detectLang(text: string): string {
    const arabicChars = (text.match(/[؀-ۿ]/g) || []).length;
    const ratio = arabicChars / Math.max(1, text.replace(/\s/g, '').length);
    if (ratio > 0.4) return 'ar';
    return 'en';
  }
}
