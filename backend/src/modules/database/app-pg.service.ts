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
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
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

    const [volume, avgConf, langDist, channelDist] = await Promise.all([
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
    ]);

    return {
      volume,
      avgConfidence: Math.round(parseFloat(avgConf[0]?.avg ?? '0') * 100) / 100,
      languages: Object.fromEntries(langDist.map((r: any) => [r._id, r.count])),
      channels:  Object.fromEntries(channelDist.map((r: any) => [r._id, r.count])),
    };
  }

  // ─── Dashboard stats ───────────────────────────────────────────────────────

  async getDashboardStats() {
    const since30d = new Date(Date.now() - 30 * 24 * 3600_000);
    const [
      convCount, msgCount, failedCount, avgLatRow, langRows, dailyRows, feedbackRow,
    ] = await Promise.all([
      this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM conversations`),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM analytics_events WHERE type='message_sent'`,
      ),
      this.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM analytics_events WHERE type='message_failed'`,
      ),
      this.query<{ avg: string }>(
        `SELECT AVG(latency_ms)::text AS avg FROM analytics_events
         WHERE type='message_sent' AND created_at>=$1`,
        [since30d],
      ),
      this.query(
        `SELECT language AS _id, COUNT(*)::int AS count FROM analytics_events
         WHERE type='message_sent' GROUP BY 1`,
      ),
      this.query(
        `SELECT TO_CHAR(created_at,'YYYY-MM-DD') AS _id, COUNT(*)::int AS count
         FROM analytics_events WHERE type='message_sent' AND created_at>=$1
         GROUP BY 1 ORDER BY 1`,
        [since30d],
      ),
      this.query<{ positive: string; negative: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE msg->>'feedback' = 'positive')::text AS positive,
           COUNT(*) FILTER (WHERE msg->>'feedback' = 'negative')::text AS negative
         FROM conversations, jsonb_array_elements(messages::jsonb) AS msg
         WHERE msg->>'feedback' IS NOT NULL`,
      ),
    ]);

    const total  = parseInt(msgCount[0].count, 10);
    const failed = parseInt(failedCount[0].count, 10);
    return {
      conversations: parseInt(convCount[0].count, 10),
      messages: total,
      failed,
      successRate: total > 0 ? Math.round(((total - failed) / total) * 100) : 100,
      avgLatencyMs: Math.round(parseFloat(avgLatRow[0]?.avg ?? '0')),
      langBreakdown: Object.fromEntries(langRows.map((r: any) => [r._id, r.count])),
      dailyMessages: dailyRows,
      feedback: {
        positive: parseInt(feedbackRow[0]?.positive ?? '0', 10),
        negative: parseInt(feedbackRow[0]?.negative ?? '0', 10),
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
    qdrantId?: string; metadata?: any;
  }) {
    await this.query(
      `INSERT INTO knowledge_chunks
         (title,content,chunk_index,source_id,type,url,language,tags,qdrant_id,is_active,last_indexed_at,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),$10)
       ON CONFLICT (source_id, chunk_index) DO UPDATE SET
         title=$1, content=$2, url=$6, language=$7, tags=$8,
         qdrant_id=$9, is_active=true, last_indexed_at=NOW(), metadata=$10, updated_at=NOW()`,
      [
        data.title, data.content, data.chunkIndex, data.sourceId,
        data.type, data.url ?? null, data.language ?? null,
        JSON.stringify(data.tags ?? []), data.qdrantId ?? null,
        data.metadata ? JSON.stringify(data.metadata) : '{}',
      ],
    );
  }

  async deleteKnowledgeBySource(sourceId: string) {
    await this.query(`DELETE FROM knowledge_chunks WHERE source_id=$1`, [sourceId]);
  }

  async countActiveKnowledge(): Promise<number> {
    const rows = await this.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM knowledge_chunks WHERE is_active=true`);
    return parseInt(rows[0].count, 10);
  }

  // ─── Uploaded Documents ────────────────────────────────────────────────────

  async createDocument(data: {
    originalName: string; filename: string; mimeType: string; sizeBytes: number;
    uploadedBy?: string; tags?: string[]; description?: string;
  }) {
    const rows = await this.query(
      `INSERT INTO uploaded_documents
         (original_name,filename,mime_type,size_bytes,uploaded_by,tags,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.originalName, data.filename, data.mimeType, data.sizeBytes,
        data.uploadedBy ?? null, JSON.stringify(data.tags ?? []), data.description ?? null,
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
}
