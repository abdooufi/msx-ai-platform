import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AppPgService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppPgService.name);
  private pool: Pool;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    this.pool = new Pool({
      host:     this.config.get('CHATBOOT_PG_HOST', 'host.docker.internal'),
      port:     parseInt(this.config.get('CHATBOOT_PG_PORT', '5432'), 10),
      user:     this.config.get('CHATBOOT_PG_USER', 'postgres'),
      password: this.config.get('CHATBOOT_PG_PASS', 'root'),
      database: this.config.get('CHATBOOT_PG_DB', 'Chatboot'),
      max: 20,                        // more headroom during startup bursts
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000, // wait longer before giving up
    });
    try {
      const c = await this.pool.connect(); c.release();
      this.logger.log('✅ AppPgService connected to PostgreSQL');
      await this.runMigrations();
    } catch (err) {
      this.logger.error(`AppPgService PG connect failed: ${err.message}`);
    }
  }

  async onModuleDestroy() { await this.pool?.end(); }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const client: PoolClient = await this.pool.connect();
    try {
      const { rows } = await client.query(sql, params);
      return rows as T[];
    } finally { client.release(); }
  }

  /**
   * Shallow snake_case → camelCase transform for PG rows.
   * Also maps `id` → `_id` so frontend receives the same shape as MongoDB docs.
   * Does NOT recurse into nested JSONB objects.
   */
  private static c(row: Record<string, any>): any {
    return Object.entries(row).reduce((acc, [k, v]) => {
      if (k === 'id') { acc['_id'] = v; return acc; }
      const camel = k.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
      acc[camel] = v;
      return acc;
    }, {} as any);
  }

  private async runMigrations() {
    // app_users
    await this.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'viewer',
        is_active BOOLEAN DEFAULT true,
        last_login_at TIMESTAMPTZ,
        refresh_token TEXT,
        preferences JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // audit_logs
    await this.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        user_email VARCHAR(255) NOT NULL,
        user_role VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(100) NOT NULL,
        resource_id VARCHAR(255),
        details TEXT NOT NULL,
        changes JSONB,
        ip VARCHAR(100) DEFAULT '',
        user_agent TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_email ON audit_logs(user_email, created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC)`);
    // analytics_events
    await this.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(100) NOT NULL,
        session_id VARCHAR(255),
        language VARCHAR(10) DEFAULT 'en',
        channel VARCHAR(50) DEFAULT 'web',
        latency_ms INTEGER,
        confidence_score FLOAT,
        tokens_used INTEGER,
        had_context BOOLEAN,
        error_type VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(type, created_at DESC)`);
    // knowledge_chunks
    await this.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        source_id VARCHAR(500) NOT NULL,
        type VARCHAR(50) DEFAULT 'website',
        url TEXT,
        language VARCHAR(10),
        tags JSONB DEFAULT '[]',
        qdrant_id VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        last_indexed_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_source_chunk ON knowledge_chunks(source_id, chunk_index)
    `);
    // uploaded_documents
    await this.query(`
      CREATE TABLE IF NOT EXISTS uploaded_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        original_name VARCHAR(500) NOT NULL,
        filename VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        size_bytes BIGINT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        chunks_indexed INTEGER DEFAULT 0,
        uploaded_by UUID,
        error_message TEXT,
        language VARCHAR(10),
        tags JSONB DEFAULT '[]',
        description TEXT,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // extend conversations table with extra columns if they don't exist
    await this.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en'`);
    await this.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel VARCHAR(50) DEFAULT 'web'`);
    await this.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_agent TEXT`);
    await this.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100)`);
    await this.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
    // ensure id column has a default (pre-existing table may lack one)
    try {
      await this.query(`ALTER TABLE conversations ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
    } catch { /* already has a default or extension unavailable — harmless */ }
    // ensure session_id index
    await this.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id)`);
    // performance indices — conversations
    await this.query(`CREATE INDEX IF NOT EXISTS idx_conversations_created   ON conversations(created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_conversations_language  ON conversations(language, created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_conversations_channel   ON conversations(channel, created_at DESC)`);
    // performance indices — analytics
    await this.query(`CREATE INDEX IF NOT EXISTS idx_analytics_session       ON analytics_events(session_id, created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_analytics_channel       ON analytics_events(channel, created_at DESC)`);
    // company_symbol columns (added in v2)
    await this.query(`ALTER TABLE knowledge_chunks     ADD COLUMN IF NOT EXISTS company_symbol VARCHAR(20)`);
    await this.query(`ALTER TABLE uploaded_documents   ADD COLUMN IF NOT EXISTS company_symbol VARCHAR(20)`);
    // performance indices — knowledge & documents
    await this.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_company       ON knowledge_chunks(company_symbol, is_active)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_type_active   ON knowledge_chunks(type, is_active, created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_docs_status             ON uploaded_documents(status, created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_docs_company            ON uploaded_documents(company_symbol, created_at DESC)`);
    // URL watch schedules (added in v3)
    await this.query(`
      CREATE TABLE IF NOT EXISTS doc_url_schedules (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url            TEXT NOT NULL UNIQUE,
        company_symbol VARCHAR(20),
        cron           VARCHAR(50) NOT NULL,
        last_run_at    TIMESTAMP,
        files_found    INTEGER DEFAULT 0,
        updated_at     TIMESTAMP DEFAULT NOW(),
        created_at     TIMESTAMP DEFAULT NOW()
      )
    `);
    // source_hashes — content-hash change detection for incremental crawling (Feature #5)
    await this.query(`
      CREATE TABLE IF NOT EXISTS source_hashes (
        source_id    TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        chunk_count  INTEGER DEFAULT 0,
        indexed_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // retrieval_logs — audit trail for every RAG query (Feature #4)
    await this.query(`
      CREATE TABLE IF NOT EXISTS retrieval_logs (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id     VARCHAR(255),
        query          TEXT NOT NULL,
        language       VARCHAR(10) DEFAULT 'en',
        top_score      FLOAT,
        source_count   INTEGER DEFAULT 0,
        answered       BOOLEAN DEFAULT true,
        refused_reason VARCHAR(100),
        latency_ms     INTEGER,
        sources        JSONB DEFAULT '[]',
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_retrieval_created ON retrieval_logs(created_at DESC)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_retrieval_session  ON retrieval_logs(session_id, created_at DESC)`);
    // failed_jobs — dead-letter queue for permanently failed BullMQ jobs (Feature #7)
    await this.query(`
      CREATE TABLE IF NOT EXISTS failed_jobs (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        queue         VARCHAR(100) NOT NULL,
        job_id        VARCHAR(255),
        job_name      VARCHAR(255),
        attempts_made INTEGER DEFAULT 0,
        error_message TEXT,
        job_data      JSONB DEFAULT '{}',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_failed_jobs_queue   ON failed_jobs(queue, created_at DESC)`);
    // ensure app_users admin
    await this.ensureAdminUser();
    this.logger.log('✅ AppPg migrations complete');
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  private async ensureAdminUser() {
    const email = this.config.get('ADMIN_EMAIL', 'admin@msx.om');
    const rows = await this.query(`SELECT id FROM app_users WHERE email=$1`, [email]);
    if (!rows.length) {
      const password = this.config.get('ADMIN_PASSWORD', 'Admin123!');
      const hash = await bcrypt.hash(password, 12);
      await this.query(
        `INSERT INTO app_users (email, password, name, role) VALUES ($1,$2,$3,$4)`,
        [email, hash, 'Administrator', 'super_admin'],
      );
      this.logger.log(`✅ Super-admin created: ${email}`);
    }
  }

  async findUserByEmail(email: string, withPassword = false): Promise<any | null> {
    const cols = withPassword ? '*' : 'id,email,name,role,is_active,last_login_at,preferences,created_at,updated_at';
    const rows = await this.query(`SELECT ${cols} FROM app_users WHERE email=$1 AND is_active=true`, [email.toLowerCase()]);
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async findUserById(id: string): Promise<any | null> {
    const rows = await this.query(
      `SELECT id,email,name,role,is_active,last_login_at,preferences,created_at,updated_at FROM app_users WHERE id=$1`,
      [id],
    );
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async createUser(data: { email: string; password: string; name: string; role: string }) {
    const hash = await bcrypt.hash(data.password, 12);
    const rows = await this.query(
      `INSERT INTO app_users (email,password,name,role) VALUES ($1,$2,$3,$4)
       RETURNING id,email,name,role,is_active,created_at`,
      [data.email.toLowerCase(), hash, data.name, data.role],
    );
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async updateUser(id: string, data: { name?: string; role?: string; isActive?: boolean }) {
    const sets: string[] = ['updated_at=NOW()'];
    const params: any[] = [];
    if (data.name     !== undefined) { params.push(data.name);     sets.push(`name=$${params.length}`); }
    if (data.role     !== undefined) { params.push(data.role);     sets.push(`role=$${params.length}`); }
    if (data.isActive !== undefined) { params.push(data.isActive); sets.push(`is_active=$${params.length}`); }
    if (params.length === 0) return null;
    params.push(id);
    const rows = await this.query(
      `UPDATE app_users SET ${sets.join(',')} WHERE id=$${params.length}
       RETURNING id,email,name,role,is_active,created_at,updated_at`,
      params,
    );
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async changeUserPassword(id: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.query(`UPDATE app_users SET password=$1,updated_at=NOW() WHERE id=$2`, [hash, id]);
    return { ok: true };
  }

  async deleteUser(id: string) {
    const rows = await this.query(`DELETE FROM app_users WHERE id=$1 RETURNING id,email,name,role`, [id]);
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async listUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [users, countRow] = await Promise.all([
      this.query(
        `SELECT id,email,name,role,is_active,last_login_at,created_at,updated_at
         FROM app_users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, skip],
      ),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM app_users`),
    ]);
    return { users: users.map(r => AppPgService.c(r)), total: parseInt(countRow[0].count, 10), page, pages: Math.ceil(parseInt(countRow[0].count, 10) / limit) };
  }

  async updateUserLastLogin(id: string) {
    await this.query(`UPDATE app_users SET last_login_at=NOW() WHERE id=$1`, [id]);
  }

  // ─── Audit Logs ────────────────────────────────────────────────────────────

  async createAuditLog(data: {
    userId?: string; userEmail: string; userRole: string;
    action: string; resource: string; resourceId?: string;
    details: string; changes?: any; ip?: string; userAgent?: string;
  }) {
    await this.query(
      `INSERT INTO audit_logs
         (user_id,user_email,user_role,action,resource,resource_id,details,changes,ip,user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        data.userId ?? null, data.userEmail, data.userRole,
        data.action, data.resource, data.resourceId ?? null,
        data.details, data.changes ? JSON.stringify(data.changes) : null,
        data.ip ?? '', data.userAgent ?? '',
      ],
    );
  }

  async listAuditLogs(opts: {
    page?: number; limit?: number; action?: string; resource?: string;
    email?: string; from?: string; to?: string;
  } = {}) {
    const { page = 1, limit = 50, action, resource, email, from, to } = opts;
    const filters: string[] = [];
    const params: any[] = [];

    if (action)   { params.push(action);                  filters.push(`action=$${params.length}`); }
    if (resource) { params.push(resource);                filters.push(`resource=$${params.length}`); }
    if (email)    { params.push(`%${email}%`);            filters.push(`user_email ILIKE $${params.length}`); }
    if (from)     { params.push(new Date(from));          filters.push(`created_at>=$${params.length}`); }
    if (to)       { params.push(new Date(to));            filters.push(`created_at<=$${params.length}`); }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const skip  = (page - 1) * limit;

    const [logs, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, skip],
      ),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM audit_logs ${where}`, params),
    ]);
    return { logs: logs.map(r => AppPgService.c(r)), total: parseInt(countRow[0].count, 10), page, pages: Math.ceil(parseInt(countRow[0].count, 10) / limit) };
  }

  async auditStats() {
    const today = new Date(); today.setHours(0,0,0,0);
    const [total, todayCount, byAction] = await Promise.all([
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM audit_logs`),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM audit_logs WHERE created_at>=$1`, [today]),
      this.query<{ action: string; count: string }>(
        `SELECT action, COUNT(*)::text AS count FROM audit_logs GROUP BY action ORDER BY count DESC LIMIT 10`,
      ),
    ]);
    return {
      total: parseInt(total[0].count, 10),
      today: parseInt(todayCount[0].count, 10),
      byAction: byAction.map(r => ({ _id: r.action, count: parseInt(r.count, 10) })),
    };
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────

  async trackEvent(data: {
    type: string; sessionId?: string; language?: string; channel?: string;
    latencyMs?: number; confidenceScore?: number; tokensUsed?: number;
    hadContext?: boolean; errorType?: string; metadata?: any;
  }) {
    await this.query(
      `INSERT INTO analytics_events
         (type,session_id,language,channel,latency_ms,confidence_score,tokens_used,had_context,error_type,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        data.type, data.sessionId ?? null, data.language ?? 'en', data.channel ?? 'web',
        data.latencyMs ?? null, data.confidenceScore ?? null, data.tokensUsed ?? null,
        data.hadContext ?? null, data.errorType ?? null,
        data.metadata ? JSON.stringify(data.metadata) : '{}',
      ],
    );
  }

  async getAnalyticsSummary(days = 7) {
    const since = new Date(Date.now() - days * 24 * 3600_000);

    const [volume, avgConf, langDist, channelDist, feedbackRows] = await Promise.all([
      this.query(
        `SELECT TO_CHAR(created_at,'YYYY-MM-DD') AS _id, COUNT(*)::int AS count
         FROM analytics_events WHERE type='message_sent' AND created_at>=$1
         GROUP BY 1 ORDER BY 1`,
        [since],
      ),
      this.query<{ avg: string }>(
        `SELECT AVG(confidence_score)::text AS avg FROM analytics_events
         WHERE type='message_sent' AND created_at>=$1`,
        [since],
      ),
      this.query(
        `SELECT language AS _id, COUNT(*)::int AS count FROM analytics_events
         WHERE created_at>=$1 GROUP BY 1`,
        [since],
      ),
      this.query(
        `SELECT channel AS _id, COUNT(*)::int AS count FROM analytics_events
         WHERE created_at>=$1 GROUP BY 1`,
        [since],
      ),
      // Thumbs up/down on assistant messages within the window
      this.query<{ fb: string; count: number }>(
        `SELECT COALESCE(msg->>'feedback','none') AS fb, COUNT(*)::int AS count
         FROM conversations c, jsonb_array_elements(c.messages::jsonb) AS msg
         WHERE c.updated_at >= $1 AND msg->>'role' = 'assistant'
         GROUP BY 1`,
        [since],
      ).catch(() => [] as any[]),
    ]);

    const fb: Record<string, number> =
      Object.fromEntries(feedbackRows.map((r: any) => [r.fb, r.count]));
    const positive = fb.positive ?? 0;
    const negative = fb.negative ?? 0;
    const rated    = positive + negative;

    return {
      volume,
      avgConfidence: Math.round(parseFloat(avgConf[0]?.avg ?? '0') * 100) / 100,
      languages: Object.fromEntries(langDist.map((r: any) => [r._id, r.count])),
      channels:  Object.fromEntries(channelDist.map((r: any) => [r._id, r.count])),
      feedback: {
        positive,
        negative,
        unrated: fb.none ?? 0,
        satisfactionRate: rated ? Math.round((positive / rated) * 100) : null,
      },
    };
  }

  // ─── Dashboard stats ───────────────────────────────────────────────────────

  async getDashboardStats() {
    const since30d = new Date(Date.now() - 30 * 24 * 3600_000);

    // Use a single connection with a combined CTE query to avoid pool pressure at startup.
    const rows = await this.query<any>(`
      WITH
        conv_cnt AS (
          SELECT COUNT(*)::bigint AS n FROM conversations
        ),
        msg_cnt AS (
          SELECT COUNT(*)::bigint AS n FROM analytics_events WHERE type='message_sent'
        ),
        fail_cnt AS (
          SELECT COUNT(*)::bigint AS n FROM analytics_events WHERE type='message_failed'
        ),
        avg_lat AS (
          SELECT COALESCE(AVG(latency_ms), 0)::float AS n
          FROM analytics_events
          WHERE type='message_sent' AND created_at >= $1
        ),
        lang_dist AS (
          SELECT COALESCE(json_object_agg(_id, cnt), '{}')::text AS data
          FROM (
            SELECT language AS _id, COUNT(*)::int AS cnt
            FROM analytics_events WHERE type='message_sent'
            GROUP BY 1
          ) x
        ),
        daily AS (
          SELECT COALESCE(json_agg(row ORDER BY row->>'_id'), '[]')::text AS data
          FROM (
            SELECT json_build_object('_id', TO_CHAR(created_at,'YYYY-MM-DD'), 'count', COUNT(*)::int) AS row
            FROM analytics_events WHERE type='message_sent' AND created_at >= $1
            GROUP BY 1
          ) x
        ),
        feedback AS (
          SELECT
            COALESCE(SUM(CASE WHEN msg->>'feedback'='positive' THEN 1 END), 0)::bigint AS pos,
            COALESCE(SUM(CASE WHEN msg->>'feedback'='negative' THEN 1 END), 0)::bigint AS neg
          FROM conversations c,
               jsonb_array_elements(
                 CASE WHEN c.messages IS NULL OR c.messages = ''
                      THEN '[]'::jsonb
                      ELSE c.messages::jsonb END
               ) AS msg
        )
      SELECT
        (SELECT n FROM conv_cnt)  AS conversations,
        (SELECT n FROM msg_cnt)   AS messages,
        (SELECT n FROM fail_cnt)  AS failed,
        (SELECT n FROM avg_lat)   AS avg_latency,
        (SELECT data FROM lang_dist) AS lang_breakdown,
        (SELECT data FROM daily)     AS daily_messages,
        (SELECT pos FROM feedback)   AS feedback_positive,
        (SELECT neg FROM feedback)   AS feedback_negative
    `, [since30d]);

    const r      = rows[0] ?? {};
    const total  = Number(r.messages  ?? 0);
    const failed = Number(r.failed    ?? 0);
    return {
      conversations: Number(r.conversations ?? 0),
      messages:      total,
      failed,
      successRate:   total > 0 ? Math.round(((total - failed) / total) * 100) : 100,
      avgLatencyMs:  Math.round(Number(r.avg_latency ?? 0)),
      langBreakdown: JSON.parse(r.lang_breakdown ?? '{}'),
      dailyMessages: JSON.parse(r.daily_messages ?? '[]'),
      feedback: {
        positive: Number(r.feedback_positive ?? 0),
        negative: Number(r.feedback_negative ?? 0),
      },
    };
  }

  // ─── Conversations ─────────────────────────────────────────────────────────

  async upsertConversation(sessionId: string, messages: any[], meta: {
    language?: string; channel?: string;
  } = {}) {
    await this.query(
      `INSERT INTO conversations (id, session_id, messages, language, channel, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, NOW(), NOW())
       ON CONFLICT (session_id) DO UPDATE
         SET messages   = (
               SELECT jsonb_agg(msg)
               FROM (
                 SELECT jsonb_array_elements(conversations.messages::jsonb) AS msg
                 UNION ALL
                 SELECT jsonb_array_elements($3::jsonb) AS msg
               ) sub
             ),
             updated_at = NOW()`,
      [uuidv4(), sessionId, JSON.stringify(messages), meta.language ?? 'en', meta.channel ?? 'web'],
    );
  }

  async getConversationBySession(sessionId: string) {
    const rows = await this.query(`SELECT * FROM conversations WHERE session_id=$1`, [sessionId]);
    return rows[0] ?? null;
  }

  async listConversations(page = 1, limit = 20, filter: { language?: string } = {}) {
    const skip = (page - 1) * limit;
    const params: any[] = [];
    const filters: string[] = [];
    if (filter.language) { params.push(filter.language); filters.push(`language=$${params.length}`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const [rows, countRow] = await Promise.all([
      this.query(
        `SELECT id, session_id, language, channel, created_at, updated_at,
                jsonb_array_length(messages::jsonb) AS message_count,
                messages::jsonb->-1 AS last_message
         FROM conversations ${where} ORDER BY created_at DESC
         LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, skip],
      ),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM conversations ${where}`, params),
    ]);
    return {
      conversations: rows.map((row: any) => {
        const mapped = AppPgService.c(row);
        // lastMessage was mapped from last_message (JSONB object); replace with the content string
        mapped.lastMessage = row.last_message?.content?.substring(0, 100);
        return mapped;
      }),
      total: parseInt(countRow[0].count, 10),
      page,
      pages: Math.ceil(parseInt(countRow[0].count, 10) / limit),
    };
  }

  async getFailedQuestions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    // Find assistant messages with low confidence scores
    const rows = await this.query(
      `SELECT c.session_id, c.language,
              msg->>'content' AS question,
              (msg->>'confidence_score')::float AS score,
              msg->>'created_at' AS date
       FROM conversations c,
            jsonb_array_elements(c.messages::jsonb) AS msg
       WHERE msg->>'role' = 'assistant'
         AND (msg->>'confidence_score')::float < 0.3
       ORDER BY (msg->>'created_at') DESC
       LIMIT $1 OFFSET $2`,
      [limit, skip],
    );
    return rows;
  }

  async updateMessageFeedback(sessionId: string, messageId: string, feedback: string, note?: string) {
    // Update feedback on a specific message in the JSONB array
    await this.query(
      `UPDATE conversations
       SET messages = (
         SELECT jsonb_agg(
           CASE WHEN msg->>'_id' = $2
                THEN msg || jsonb_build_object('feedback', $3, 'feedbackNote', $4)
                ELSE msg END
         )
         FROM jsonb_array_elements(messages::jsonb) AS msg
       ),
       updated_at = NOW()
       WHERE session_id = $1`,
      [sessionId, messageId, feedback, note ?? ''],
    );
    return { ok: true };
  }

  // ─── Knowledge Chunks ──────────────────────────────────────────────────────

  async upsertKnowledgeChunk(data: {
    title: string; content: string; chunkIndex: number; sourceId: string;
    type: string; url?: string; language?: string; tags?: string[];
    qdrantId?: string; metadata?: any; companySymbol?: string;
  }) {
    await this.query(
      `INSERT INTO knowledge_chunks
         (title,content,chunk_index,source_id,type,url,language,tags,qdrant_id,is_active,last_indexed_at,metadata,company_symbol)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),$10,$11)
       ON CONFLICT (source_id, chunk_index) DO UPDATE SET
         title=$1, content=$2, url=$6, language=$7, tags=$8,
         qdrant_id=$9, is_active=true, last_indexed_at=NOW(), metadata=$10,
         company_symbol=$11, updated_at=NOW()`,
      [
        data.title, data.content, data.chunkIndex, data.sourceId,
        data.type, data.url ?? null, data.language ?? null,
        JSON.stringify(data.tags ?? []), data.qdrantId ?? null,
        data.metadata ? JSON.stringify(data.metadata) : '{}',
        data.companySymbol ?? null,
      ],
    );
  }

  async deleteKnowledgeBySource(sourceId: string) {
    await this.query(`DELETE FROM knowledge_chunks WHERE source_id=$1`, [sourceId]);
  }

  async deleteKnowledgeByCompany(symbol: string) {
    await this.query(`DELETE FROM knowledge_chunks WHERE company_symbol=$1`, [symbol.toUpperCase()]);
  }

  async countActiveKnowledge(): Promise<number> {
    const rows = await this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM knowledge_chunks WHERE is_active=true`);
    return parseInt(rows[0].count, 10);
  }

  // ─── Uploaded Documents ────────────────────────────────────────────────────

  async createDocument(data: {
    originalName: string; filename: string; mimeType: string; sizeBytes: number;
    uploadedBy?: string; tags?: string[]; description?: string; companySymbol?: string;
  }) {
    const rows = await this.query(
      `INSERT INTO uploaded_documents
         (original_name,filename,mime_type,size_bytes,uploaded_by,tags,description,company_symbol)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        data.originalName, data.filename, data.mimeType, data.sizeBytes,
        data.uploadedBy ?? null, JSON.stringify(data.tags ?? []),
        data.description ?? null, data.companySymbol ? data.companySymbol.toUpperCase() : null,
      ],
    );
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async listDocuments(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [docs, countRow] = await Promise.all([
      this.query(`SELECT * FROM uploaded_documents ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, skip]),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM uploaded_documents`),
    ]);
    return { docs: docs.map(r => AppPgService.c(r)), total: parseInt(countRow[0].count, 10), page, pages: Math.ceil(parseInt(countRow[0].count, 10) / limit) };
  }

  async getDocument(id: string) {
    const rows = await this.query(`SELECT * FROM uploaded_documents WHERE id=$1`, [id]);
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async updateDocumentStatus(id: string, data: {
    status: string; chunksIndexed?: number; errorMessage?: string; processedAt?: Date;
  }) {
    const sets: string[] = ['status=$1','updated_at=NOW()'];
    const params: any[] = [data.status];
    if (data.chunksIndexed !== undefined) { params.push(data.chunksIndexed); sets.push(`chunks_indexed=$${params.length}`); }
    if (data.errorMessage  !== undefined) { params.push(data.errorMessage);  sets.push(`error_message=$${params.length}`); }
    if (data.processedAt   !== undefined) { params.push(data.processedAt);   sets.push(`processed_at=$${params.length}`); }
    params.push(id);
    await this.query(`UPDATE uploaded_documents SET ${sets.join(',')} WHERE id=$${params.length}`, params);
  }

  async deleteDocument(id: string) {
    await this.query(`DELETE FROM uploaded_documents WHERE id=$1`, [id]);
    return { ok: true };
  }

  /** Check whether a document with this exact original filename already exists */
  async documentExistsByName(originalName: string): Promise<boolean> {
    const rows = await this.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM uploaded_documents WHERE original_name=$1`,
      [originalName],
    );
    return parseInt(rows[0].count, 10) > 0;
  }

  // ─── URL Watch Schedules ──────────────────────────────────────────────────

  async createUrlSchedule(data: {
    id: string; url: string; companySymbol?: string; cron: string;
  }) {
    await this.query(
      `INSERT INTO doc_url_schedules (id, url, company_symbol, cron)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (url) DO UPDATE SET cron=$4, company_symbol=$3, updated_at=NOW()`,
      [data.id, data.url, data.companySymbol?.toUpperCase() ?? null, data.cron],
    );
  }

  async listUrlSchedules() {
    const rows = await this.query(`SELECT * FROM doc_url_schedules ORDER BY created_at DESC`);
    return rows.map(r => AppPgService.c(r));
  }

  async getUrlScheduleById(id: string) {
    const rows = await this.query(`SELECT * FROM doc_url_schedules WHERE id=$1`, [id]);
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async getUrlScheduleByUrl(url: string) {
    const rows = await this.query(`SELECT * FROM doc_url_schedules WHERE url=$1`, [url]);
    return rows[0] ? AppPgService.c(rows[0]) : null;
  }

  async updateUrlScheduleRun(id: string, filesFound: number) {
    await this.query(
      `UPDATE doc_url_schedules SET last_run_at=NOW(), files_found=$2, updated_at=NOW() WHERE id=$1`,
      [id, filesFound],
    );
  }

  async deleteUrlSchedule(id: string) {
    await this.query(`DELETE FROM doc_url_schedules WHERE id=$1`, [id]);
    return { ok: true };
  }

  // ─── Source Hashes (content-hash change detection) ────────────────────────

  /** Return the stored SHA-256 hash for a source URL/ID, or null if not yet indexed */
  async getSourceHash(sourceId: string): Promise<string | null> {
    const rows = await this.query<{ content_hash: string }>(
      `SELECT content_hash FROM source_hashes WHERE source_id=$1`,
      [sourceId],
    );
    return rows[0]?.content_hash ?? null;
  }

  /** Upsert the content hash and chunk count for a source after successful indexing */
  async upsertSourceHash(sourceId: string, contentHash: string, chunkCount = 0): Promise<void> {
    await this.query(
      `INSERT INTO source_hashes (source_id, content_hash, chunk_count, indexed_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (source_id) DO UPDATE
         SET content_hash=$2, chunk_count=$3, updated_at=NOW()`,
      [sourceId, contentHash, chunkCount],
    );
  }

  // ─── Retrieval Logs (RAG audit trail) ────────────────────────────────────

  async logRetrieval(data: {
    sessionId:     string;
    query:         string;
    language?:     string;
    topScore?:     number;
    sourceCount?:  number;
    answered?:     boolean;
    refusedReason?: string;
    latencyMs?:    number;
    sources?:      any[];
  }): Promise<void> {
    try {
      await this.query(
        `INSERT INTO retrieval_logs
           (session_id, query, language, top_score, source_count, answered, refused_reason, latency_ms, sources)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          data.sessionId, data.query, data.language ?? 'en',
          data.topScore ?? null, data.sourceCount ?? 0,
          data.answered ?? true, data.refusedReason ?? null,
          data.latencyMs ?? null,
          data.sources ? JSON.stringify(data.sources.map(s => ({ title: s.title, url: s.url, score: s.score }))) : '[]',
        ],
      );
    } catch { /* never crash the chat flow */ }
  }

  async listRetrievalLogs(page = 1, limit = 50): Promise<any> {
    const skip = (page - 1) * limit;
    const [logs, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM retrieval_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, skip],
      ),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM retrieval_logs`),
    ]);
    return { logs: logs.map(r => AppPgService.c(r)), total: parseInt(countRow[0].count, 10), page };
  }

  // ─── Failed Jobs (dead-letter queue) ─────────────────────────────────────

  async logFailedJob(data: {
    queue:         string;
    jobId?:        string | number;
    jobName?:      string;
    attemptsMade?: number;
    errorMessage?: string;
    jobData?:      any;
  }): Promise<void> {
    try {
      await this.query(
        `INSERT INTO failed_jobs (queue, job_id, job_name, attempts_made, error_message, job_data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          data.queue, data.jobId ? String(data.jobId) : null, data.jobName ?? null,
          data.attemptsMade ?? 0, data.errorMessage ?? null,
          data.jobData ? JSON.stringify(data.jobData) : '{}',
        ],
      );
    } catch { /* never crash the queue processor */ }
  }

  async listFailedJobs(page = 1, limit = 50, queue?: string): Promise<any> {
    const skip = (page - 1) * limit;
    const params: any[] = [];
    const where = queue ? `WHERE queue=$${(params.push(queue), params.length)}` : '';
    const [jobs, countRow] = await Promise.all([
      this.query(
        `SELECT * FROM failed_jobs ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
        [...params, limit, skip],
      ),
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM failed_jobs ${where}`, params),
    ]);
    return { jobs: jobs.map(r => AppPgService.c(r)), total: parseInt(countRow[0].count, 10), page };
  }
}
