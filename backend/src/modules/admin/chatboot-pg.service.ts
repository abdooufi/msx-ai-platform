import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class ChatbootPgService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatbootPgService.name);
  private pool: Pool;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      host:     this.config.get('CHATBOOT_PG_HOST', 'host.docker.internal'),
      port:     parseInt(this.config.get('CHATBOOT_PG_PORT', '5432'), 10),
      user:     this.config.get('CHATBOOT_PG_USER', 'postgres'),
      password: this.config.get('CHATBOOT_PG_PASS', 'root'),
      database: this.config.get('CHATBOOT_PG_DB',   'Chatboot'),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    try {
      const client = await this.pool.connect();
      client.release();
      this.logger.log('✅ Connected to Chatboot PostgreSQL');
    } catch (err) {
      this.logger.error(`Failed to connect to Chatboot PG: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  private async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      const { rows } = await client.query(sql, params);
      return rows as T[];
    } finally {
      client.release();
    }
  }

  // ─── Schema introspection ──────────────────────────────────────────────────

  async getTableNames(): Promise<string[]> {
    const rows = await this.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    return rows.map(r => r.table_name);
  }

  async getTableSchema(table: string): Promise<any[]> {
    return this.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
  }

  // ─── Companies ────────────────────────────────────────────────────────────

  /**
   * List companies with optional search + optional equity-only filter.
   *
   * @param onlyEquities  When true, restricts to type='C' AND is_visible=1
   *                      (used by the public chat search endpoint).
   *                      Default false (admin panel sees everything).
   */
  async getCompanies(page = 1, limit = 20, search?: string, onlyEquities = false) {
    const offset = (page - 1) * limit;

    // Build the base filter clause (equity guard, always first so param indices stay stable)
    const baseFilter = onlyEquities ? `type = 'C' AND is_visible = 1` : null;

    if (search) {
      const like        = `%${search}%`;
      const params: any[] = [like];

      // $1 = search pattern
      const searchCond  = `(symbol       ILIKE $1
                         OR long_name_en  ILIKE $1
                         OR short_name_en ILIKE $1
                         OR short_name_ar ILIKE $1)`;
      const where       = `WHERE ${baseFilter ? `${baseFilter} AND ` : ''}${searchCond}`;

      const [rows, countRow] = await Promise.all([
        this.query(
          `SELECT * FROM companies ${where} ORDER BY symbol LIMIT $2 OFFSET $3`,
          [like, limit, offset],
        ),
        this.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM companies ${where}`,
          params,
        ),
      ]);
      return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
    }

    // No search term
    const where = baseFilter ? `WHERE ${baseFilter}` : '';
    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM companies ${where} ORDER BY symbol LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM companies ${where}`,
        [],
      ),
    ]);
    return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
  }

  async upsertCompany(data: any) {
    const {
      id,
      symbol,
      long_name_ar,
      long_name_en,
      short_name_ar,
      short_name_en,
      type,
      sector_id,
      market_id,
      status_id,
      clone_name,
      url,
    } = data;

    if (id) {
      return this.query(
        `UPDATE companies
         SET symbol=$1, long_name_ar=$2, long_name_en=$3,
             short_name_ar=$4, short_name_en=$5,
             type=$6, sector_id=$7, market_id=$8, status_id=$9,
             clone_name=$10, url=$11,
             updated_at=NOW()
         WHERE id=$12 RETURNING *`,
        [symbol, long_name_ar, long_name_en,
         short_name_ar, short_name_en,
         type, sector_id, market_id, status_id,
         clone_name ?? null, url ?? null,
         id],
      );
    }

    return this.query(
      `INSERT INTO companies
         (id, symbol, long_name_ar, long_name_en, short_name_ar, short_name_en,
          type, sector_id, market_id, status_id, clone_name, url,
          created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          NOW(), NOW())
       RETURNING *`,
      [symbol, long_name_ar, long_name_en,
       short_name_ar, short_name_en,
       type, sector_id, market_id, status_id,
       clone_name ?? null, url ?? null],
    );
  }

  /** All companies that have a non-empty URL — used by the website crawler */
  async getCompanyUrlsForCrawl(): Promise<{ symbol: string; url: string }[]> {
    return this.query<{ symbol: string; url: string }>(
      `SELECT symbol, url FROM companies
       WHERE url IS NOT NULL AND url <> ''
       ORDER BY symbol`,
    );
  }

  /**
   * Fuzzy company lookup by any name / alias — used as DB fallback
   * when static symbol detection fails.
   * Splits the query into non-trivial words and searches against
   * clone_name, all name columns and symbol.
   */
  async findCompanyByAlias(message: string): Promise<string | null> {
    const STOP = new Set([
      'what','tell','show','give','me','the','is','of','for','about',
      'does','has','have','price','stock','share','current','today',
      'please','company','listed','data','info','information',
      'مالية','سعر','شركة','معلومات','اليوم',
    ]);

    const words = message
      .toLowerCase()
      .replace(/[^\w\s؀-ۿ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOP.has(w));

    if (!words.length) return null;

    for (const word of words) {
      const rows = await this.query<{ symbol: string }>(
        `SELECT symbol FROM companies
         WHERE type = 'C' AND is_visible = 1
           AND (long_name_en  ILIKE $1
             OR short_name_en ILIKE $1
             OR long_name_ar  ILIKE $1
             OR short_name_ar ILIKE $1
             OR symbol        ILIKE $1)
         ORDER BY symbol
         LIMIT 1`,
        [`%${word}%`],
      );
      if (rows[0]?.symbol) return rows[0].symbol;
    }
    return null;
  }

  async deleteCompany(id: string) {
    return this.query(`DELETE FROM companies WHERE id=$1 RETURNING id`, [id]);
  }

  // ─── FAQs ─────────────────────────────────────────────────────────────────

  async getFaqs(page = 1, limit = 20, category?: string, activeOnly = false) {
    const offset       = (page - 1) * limit;
    const filterParams: any[] = [];
    const filters: string[]   = [];

    // Filter params come FIRST so both main query and COUNT share $1, $2, ...
    if (category)   { filterParams.push(category); filters.push(`category = $${filterParams.length}`); }
    if (activeOnly) { filters.push('is_active = true'); }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const n     = filterParams.length;

    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM faqs ${where} ORDER BY created_at DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...filterParams, limit, offset],
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM faqs ${where}`,
        filterParams,
      ),
    ]);
    return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
  }

  async upsertFaq(data: any) {
    const { id, question, answer, category, is_active } = data;
    if (id) {
      return this.query(
        `UPDATE faqs SET question=$1,answer=$2,category=$3,is_active=$4,updated_at=NOW()
         WHERE id=$5 RETURNING *`,
        [question, answer, category, is_active ?? true, id],
      );
    }
    return this.query(
      `INSERT INTO faqs (id,question,answer,category,is_active,created_at,updated_at)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,NOW(),NOW()) RETURNING *`,
      [question, answer, category, is_active ?? true],
    );
  }

  async deleteFaq(id: string) {
    return this.query(`DELETE FROM faqs WHERE id=$1 RETURNING id`, [id]);
  }

  // ─── Knowledge Base ───────────────────────────────────────────────────────

  async getKnowledgeBase(page = 1, limit = 20, category?: string, search?: string) {
    const offset       = (page - 1) * limit;
    const filterParams: any[] = [];
    const filters: string[]   = [];

    if (category) {
      filterParams.push(category);
      filters.push(`category = $${filterParams.length}`);
    }
    if (search) {
      filterParams.push(`%${search}%`);
      const i = filterParams.length;
      filters.push(`(title ILIKE $${i} OR content ILIKE $${i})`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const n     = filterParams.length;

    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT id,title,category,source,tags,created_at,updated_at,
                LEFT(content,200) AS content_preview
         FROM knowledge_base ${where}
         ORDER BY created_at DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...filterParams, limit, offset],
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM knowledge_base ${where}`,
        filterParams,
      ),
    ]);
    return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
  }

  async getKnowledgeEntry(id: string) {
    const rows = await this.query(`SELECT * FROM knowledge_base WHERE id=$1`, [id]);
    return rows[0] ?? null;
  }

  async upsertKnowledge(data: any) {
    const { id, title, content, category, tags, source } = data;
    if (id) {
      return this.query(
        `UPDATE knowledge_base SET title=$1,content=$2,category=$3,tags=$4,source=$5,updated_at=NOW()
         WHERE id=$6 RETURNING id,title,category`,
        [title, content, category, JSON.stringify(tags ?? []), source, id],
      );
    }
    return this.query(
      `INSERT INTO knowledge_base (id,title,content,category,tags,source,created_at,updated_at)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,NOW(),NOW()) RETURNING id,title,category`,
      [title, content, category, JSON.stringify(tags ?? []), source],
    );
  }

  async deleteKnowledge(id: string) {
    return this.query(`DELETE FROM knowledge_base WHERE id=$1 RETURNING id`, [id]);
  }

  // ─── Conversations ────────────────────────────────────────────────────────

  async getPgConversations(page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT id, session_id, created_at, updated_at,
                jsonb_array_length(messages::jsonb) AS message_count
         FROM conversations ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM conversations`),
    ]);
    return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
  }

  async getPgConversation(id: string) {
    const rows = await this.query(`SELECT * FROM conversations WHERE id=$1`, [id]);
    return rows[0] ?? null;
  }

  async deletePgConversation(id: string) {
    return this.query(`DELETE FROM conversations WHERE id=$1 RETURNING id`, [id]);
  }

  // ─── Unanswered Questions ─────────────────────────────────────────────────

  async getUnansweredQuestions(page = 1, limit = 20, status?: string) {
    const offset       = (page - 1) * limit;
    const filterParams = status ? [status] : [];
    const where        = status ? 'WHERE status = $1' : '';
    const n            = filterParams.length;

    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM unanswered_questions ${where}
         ORDER BY created_at DESC LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...filterParams, limit, offset],
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM unanswered_questions ${where}`,
        filterParams,
      ),
    ]);
    return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
  }

  async updateUnansweredQuestion(id: string, patch: { status?: string; admin_note?: string }) {
    const sets: string[] = [];
    const params: any[]  = [];

    if (patch.status)     { params.push(patch.status);     sets.push(`status=$${params.length}`); }
    if (patch.admin_note !== undefined) {
      params.push(patch.admin_note); sets.push(`admin_note=$${params.length}`);
    }

    if (!sets.length) return null;
    sets.push('updated_at=NOW()');
    params.push(id);

    return this.query(
      `UPDATE unanswered_questions SET ${sets.join(',')} WHERE id=$${params.length} RETURNING *`,
      params,
    );
  }

  async deleteUnansweredQuestion(id: string) {
    return this.query(`DELETE FROM unanswered_questions WHERE id=$1 RETURNING id`, [id]);
  }

  // ─── API Endpoints ────────────────────────────────────────────────────────

  async getApiEndpointById(id: string): Promise<any | null> {
    const rows = await this.query(`SELECT * FROM api_endpoints WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async getApiEndpointByName(name: string): Promise<any | null> {
    const rows = await this.query(
      `SELECT * FROM api_endpoints WHERE name = $1 LIMIT 1`,
      [name],
    );
    return rows[0] ?? null;
  }

  /** Return all active endpoints without pagination (for runtime matching) */
  async getActiveApiEndpoints(): Promise<any[]> {
    return this.query(
      `SELECT * FROM api_endpoints WHERE is_active = true ORDER BY category, name`,
    );
  }

  async getApiEndpoints(page = 1, limit = 20, category?: string, activeOnly = false) {
    const offset       = (page - 1) * limit;
    const filterParams: any[] = [];
    const filters: string[]   = [];

    if (category)   { filterParams.push(category); filters.push(`category = $${filterParams.length}`); }
    if (activeOnly) { filters.push('is_active = true'); }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const n     = filterParams.length;

    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM api_endpoints ${where} ORDER BY category, name LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...filterParams, limit, offset],
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM api_endpoints ${where}`,
        filterParams,
      ),
    ]);
    return { data: rows, total: parseInt(countRow[0].count, 10), page, limit };
  }

  async upsertApiEndpoint(data: any) {
    const {
      id, name, description, url, method, body, headers,
      keywords_en, keywords_ar, category, is_active,
    } = data;
    if (id) {
      return this.query(
        `UPDATE api_endpoints
         SET name=$1,description=$2,url=$3,method=$4,body=$5,headers=$6,
             keywords_en=$7,keywords_ar=$8,category=$9,is_active=$10,updated_at=NOW()
         WHERE id=$11 RETURNING *`,
        [name, description, url, method,
         JSON.stringify(body ?? {}), JSON.stringify(headers ?? {}),
         JSON.stringify(keywords_en ?? []), JSON.stringify(keywords_ar ?? []),
         category, is_active ?? true, id],
      );
    }
    return this.query(
      `INSERT INTO api_endpoints
       (id,name,description,url,method,body,headers,keywords_en,keywords_ar,category,is_active,created_at,updated_at)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING *`,
      [name, description, url, method,
       JSON.stringify(body ?? {}), JSON.stringify(headers ?? {}),
       JSON.stringify(keywords_en ?? []), JSON.stringify(keywords_ar ?? []),
       category, is_active ?? true],
    );
  }

  async deleteApiEndpoint(id: string) {
    return this.query(`DELETE FROM api_endpoints WHERE id=$1 RETURNING id`, [id]);
  }

  // ─── System Settings ──────────────────────────────────────────────────────

  async getSystemSettings() {
    return this.query(`SELECT * FROM system_settings ORDER BY key`);
  }

  async upsertSystemSetting(key: string, value: string) {
    return this.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
       RETURNING *`,
      [key, value],
    );
  }

  async deleteSystemSetting(key: string) {
    return this.query(`DELETE FROM system_settings WHERE key=$1 RETURNING key`, [key]);
  }

  // ─── Summary for dashboard ────────────────────────────────────────────────

  async getChatbootSummary() {
    const rows = await this.query<{ tbl: string; count: string }>(`
      SELECT 'companies'            AS tbl, COUNT(*)::text AS count FROM companies
      UNION ALL
      SELECT 'faqs',                        COUNT(*)::text          FROM faqs
      UNION ALL
      SELECT 'knowledge_base',              COUNT(*)::text          FROM knowledge_base
      UNION ALL
      SELECT 'conversations',               COUNT(*)::text          FROM conversations
      UNION ALL
      SELECT 'unanswered_questions',        COUNT(*)::text          FROM unanswered_questions
      UNION ALL
      SELECT 'api_endpoints',               COUNT(*)::text          FROM api_endpoints
      UNION ALL
      SELECT 'system_settings',             COUNT(*)::text          FROM system_settings
    `);
    return Object.fromEntries(rows.map(r => [r.tbl, parseInt(r.count, 10)]));
  }
}
