import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus, Request, OnModuleInit,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { AdminService } from './admin.service';
import { ChatbootPgService } from './chatboot-pg.service';
import { PgIndexingService, IndexableTable } from './pg-indexing.service';
import { DynamicApiService } from './dynamic-api.service';
import { LlmService, AiProvider } from '../rag/llm.service';
import { RagService } from '../rag/rag.service';
import { QdrantService } from '../rag/qdrant.service';
import { EmbeddingService } from '../rag/embedding.service';
import { AppPgService } from '../database/app-pg.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../../schemas/audit-log.schema';
import { MarketRecapService } from './market-recap.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'agent', 'super_admin', 'editor')
@Controller('admin')
export class AdminController implements OnModuleInit {
  constructor(
    private readonly admin:     AdminService,
    private readonly pg:        ChatbootPgService,
    private readonly appPg:     AppPgService,
    private readonly pgIndexing: PgIndexingService,
    private readonly dynamicApi: DynamicApiService,
    private readonly llm:       LlmService,
    private readonly rag:       RagService,
    private readonly qdrant:    QdrantService,
    private readonly embedding:  EmbeddingService,
    private readonly audit:     AuditService,
    private readonly recap:     MarketRecapService,
  ) {}

  /** Restore persisted AI provider on startup */
  async onModuleInit() {
    try {
      const rows = await this.pg.getSystemSettings();
      const row  = (rows as any[]).find(r => r.key === 'ai_provider');
      if (row?.value) {
        try {
          this.llm.setProvider(row.value as AiProvider);
        } catch { /* ignore if key not configured */ }
      }
    } catch { /* non-fatal */ }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MongoDB / NestJS stats
  // ══════════════════════════════════════════════════════════════════════════

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard stats (MongoDB)' })
  getStats() {
    return this.admin.getDashboardStats();
  }

  // ── Market recap ──────────────────────────────────────────────────────────

  @Get('recap/status')
  @ApiOperation({ summary: 'Daily market recap schedule status' })
  getRecapStatus() {
    return this.recap.getStatus();
  }

  @Post('recap/run')
  @ApiOperation({ summary: 'Build + index today\'s market recap now' })
  runRecap() {
    return this.recap.runNow();
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Paginated conversations (MongoDB)' })
  async getConversations(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('lang') lang?: string,
  ): Promise<any> {
    const filter = lang ? { language: lang } : {};
    return this.admin.getConversations(parseInt(page), parseInt(limit), filter);
  }

  @Get('failed')
  @ApiOperation({ summary: 'Low-confidence answers (MongoDB)' })
  getFailed(@Query('page') page = '1') {
    return this.admin.getFailedQuestions(parseInt(page));
  }

  @Get('settings')
  @ApiOperation({ summary: 'Current env config' })
  getSettings() {
    return this.admin.getSettings();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AI Provider switching (Ollama ↔ DeepSeek)
  // ══════════════════════════════════════════════════════════════════════════

  @Get('ai-provider')
  @ApiOperation({ summary: 'Get current AI provider and available options' })
  getAiProvider() {
    return this.llm.getProviderInfo();
  }

  @Get('ai-provider/balance')
  @ApiOperation({ summary: 'Check live balance/quota for each configured AI provider' })
  getAiProviderBalance() {
    return this.llm.getProviderBalance();
  }

  @Post('ai-provider')
  @ApiOperation({ summary: 'Switch AI provider at runtime and persist selection' })
  async setAiProvider(@Body() body: { provider: AiProvider }, @Request() req) {
    const result = await this.llm.setProvider(body.provider);
    // Persist so it survives a backend restart
    await this.pg.upsertSystemSetting('ai_provider', body.provider).catch(() => {});
    await this.audit.log(AuditService.ctx(req), {
      action: AuditAction.AI_PROVIDER_CHANGE, resource: 'settings',
      details: `Switched AI provider to ${body.provider}`,
    });
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Chatboot PostgreSQL — schema overview
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/summary')
  @ApiOperation({ summary: 'Row counts for all Chatboot PG tables' })
  getPgSummary() {
    return this.pg.getChatbootSummary();
  }

  @Get('pg/tables')
  @ApiOperation({ summary: 'List all table names in Chatboot PG' })
  getPgTables() {
    return this.pg.getTableNames();
  }

  @Get('pg/tables/:table/schema')
  @ApiOperation({ summary: 'Column schema for a specific table' })
  getPgTableSchema(@Param('table') table: string) {
    return this.pg.getTableSchema(table);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Companies
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/companies')
  @ApiOperation({ summary: 'List companies' })
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'search', required: false })
  getCompanies(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.pg.getCompanies(parseInt(page), parseInt(limit), search);
  }

  @Post('pg/companies')
  @ApiOperation({ summary: 'Create or update a company (include id to update)' })
  async upsertCompany(@Body() body: any, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.upsertCompany(body, ctx.userEmail);
    const isUpdate = !!body.id;
    await this.audit.log(ctx, {
      action:     isUpdate ? AuditAction.COMPANY_UPDATE : AuditAction.COMPANY_CREATE,
      resource:   'company',
      resourceId: body.id ?? result[0]?.id,
      details:    `${isUpdate ? 'Updated' : 'Created'} company ${body.symbol ?? body.id}`,
      changes:    isUpdate ? { after: body } : { after: body },
    });
    return result;
  }

  @Delete('pg/companies/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a company' })
  async deleteCompany(@Param('id') id: string, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.deleteCompany(id);
    await this.audit.log(ctx, {
      action: AuditAction.COMPANY_DELETE, resource: 'company', resourceId: id,
      details: `Deleted company ${id}`,
    });
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FAQs
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/faqs')
  @ApiOperation({ summary: 'List FAQs' })
  @ApiQuery({ name: 'page',       required: false })
  @ApiQuery({ name: 'limit',      required: false })
  @ApiQuery({ name: 'category',   required: false })
  @ApiQuery({ name: 'activeOnly', required: false })
  getFaqs(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('category') category?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.pg.getFaqs(parseInt(page), parseInt(limit), category, activeOnly === 'true');
  }

  @Post('pg/faqs')
  @ApiOperation({ summary: 'Create or update FAQ (include id to update)' })
  async upsertFaq(@Body() body: any, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.upsertFaq(body, ctx.userEmail);
    const isUpdate = !!body.id;
    await this.audit.log(ctx, {
      action:     isUpdate ? AuditAction.FAQ_UPDATE : AuditAction.FAQ_CREATE,
      resource:   'faq',
      resourceId: body.id ?? result[0]?.id,
      details:    `${isUpdate ? 'Updated' : 'Created'} FAQ: ${(body.question ?? '').slice(0, 80)}`,
      changes:    { after: { question: body.question, category: body.category } },
    });
    return result;
  }

  @Delete('pg/faqs/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a FAQ' })
  async deleteFaq(@Param('id') id: string, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.deleteFaq(id);
    await this.audit.log(ctx, {
      action: AuditAction.FAQ_DELETE, resource: 'faq', resourceId: id,
      details: `Deleted FAQ ${id}`,
    });
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Knowledge Base
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/knowledge-base')
  @ApiOperation({ summary: 'List knowledge base entries (content truncated to 200 chars)' })
  @ApiQuery({ name: 'page',     required: false })
  @ApiQuery({ name: 'limit',    required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'search',   required: false })
  getKnowledgeBase(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    return this.pg.getKnowledgeBase(parseInt(page), parseInt(limit), category, search);
  }

  @Get('pg/knowledge-base/:id')
  @ApiOperation({ summary: 'Get single knowledge base entry (full content)' })
  getKnowledgeEntry(@Param('id') id: string) {
    return this.pg.getKnowledgeEntry(id);
  }

  @Post('pg/knowledge-base')
  @ApiOperation({ summary: 'Create or update knowledge base entry (include id to update)' })
  async upsertKnowledge(@Body() body: any, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.upsertKnowledge(body, ctx.userEmail);
    const isUpdate = !!body.id;
    await this.audit.log(ctx, {
      action:     isUpdate ? AuditAction.KB_UPDATE : AuditAction.KB_CREATE,
      resource:   'knowledge_base',
      resourceId: body.id ?? result[0]?.id,
      details:    `${isUpdate ? 'Updated' : 'Created'} KB entry: ${(body.title ?? '').slice(0, 80)}`,
      changes:    { after: { title: body.title, category: body.category } },
    });
    return result;
  }

  @Delete('pg/knowledge-base/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a knowledge base entry' })
  async deleteKnowledge(@Param('id') id: string, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.deleteKnowledge(id);
    await this.audit.log(ctx, {
      action: AuditAction.KB_DELETE, resource: 'knowledge_base', resourceId: id,
      details: `Deleted KB entry ${id}`,
    });
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Conversations (PostgreSQL)
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/conversations')
  @ApiOperation({ summary: 'List PostgreSQL conversations' })
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'limit', required: false })
  getPgConversations(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.pg.getPgConversations(parseInt(page), parseInt(limit));
  }

  @Get('pg/conversations/:id')
  @ApiOperation({ summary: 'Get a single PostgreSQL conversation with full messages' })
  getPgConversation(@Param('id') id: string) {
    return this.pg.getPgConversation(id);
  }

  @Delete('pg/conversations/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a PostgreSQL conversation' })
  deletePgConversation(@Param('id') id: string) {
    return this.pg.deletePgConversation(id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Unanswered Questions
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/unanswered-questions')
  @ApiOperation({ summary: 'List unanswered questions' })
  @ApiQuery({ name: 'page',   required: false })
  @ApiQuery({ name: 'limit',  required: false })
  @ApiQuery({ name: 'status', required: false, description: 'pending | reviewed | resolved' })
  getUnansweredQuestions(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
  ) {
    return this.pg.getUnansweredQuestions(parseInt(page), parseInt(limit), status);
  }

  @Patch('pg/unanswered-questions/:id')
  @ApiOperation({ summary: 'Update status / admin_note on an unanswered question' })
  updateUnansweredQuestion(
    @Param('id') id: string,
    @Body() body: { status?: string; admin_note?: string },
  ) {
    return this.pg.updateUnansweredQuestion(id, body);
  }

  @Delete('pg/unanswered-questions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an unanswered question' })
  deleteUnansweredQuestion(@Param('id') id: string) {
    return this.pg.deleteUnansweredQuestion(id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // API Endpoints
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/api-endpoints')
  @ApiOperation({ summary: 'List API endpoint configurations' })
  @ApiQuery({ name: 'page',       required: false })
  @ApiQuery({ name: 'limit',      required: false })
  @ApiQuery({ name: 'category',   required: false })
  @ApiQuery({ name: 'activeOnly', required: false })
  getApiEndpoints(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('category') category?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.pg.getApiEndpoints(parseInt(page), parseInt(limit), category, activeOnly === 'true');
  }

  @Post('pg/api-endpoints')
  @ApiOperation({ summary: 'Create or update API endpoint (include id to update)' })
  async upsertApiEndpoint(@Body() body: any, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.upsertApiEndpoint(body, ctx.userEmail);
    const isUpdate = !!body.id;
    await this.audit.log(ctx, {
      action:     isUpdate ? AuditAction.ENDPOINT_UPDATE : AuditAction.ENDPOINT_CREATE,
      resource:   'api_endpoint',
      resourceId: body.id ?? result[0]?.id,
      details:    `${isUpdate ? 'Updated' : 'Created'} endpoint: ${body.name}`,
      changes:    { after: { name: body.name, url: body.url, method: body.method } },
    });
    return result;
  }

  @Delete('pg/api-endpoints/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an API endpoint configuration' })
  async deleteApiEndpoint(@Param('id') id: string, @Request() req) {
    const ctx = AuditService.ctx(req);
    const result = await this.pg.deleteApiEndpoint(id);
    await this.audit.log(ctx, {
      action: AuditAction.ENDPOINT_DELETE, resource: 'api_endpoint', resourceId: id,
      details: `Deleted endpoint ${id}`,
    });
    return result;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // System Settings
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/system-settings')
  @ApiOperation({ summary: 'List all system settings (key-value)' })
  getSystemSettings() {
    return this.pg.getSystemSettings();
  }

  @Put('pg/system-settings/:key')
  @ApiOperation({ summary: 'Create or update a system setting' })
  upsertSystemSetting(
    @Param('key') key: string,
    @Body() body: { value: string },
  ) {
    return this.pg.upsertSystemSetting(key, body.value);
  }

  @Delete('pg/system-settings/:key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a system setting' })
  deleteSystemSetting(@Param('key') key: string) {
    return this.pg.deleteSystemSetting(key);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PG → Qdrant Indexing
  // ══════════════════════════════════════════════════════════════════════════

  @Get('pg/index-status')
  @ApiOperation({ summary: 'Get per-table Qdrant indexing status' })
  getIndexStatus() {
    return this.pgIndexing.getStatus();
  }

  @Post('pg/index-all')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger full re-index of all PG tables into Qdrant (async)' })
  indexAll() {
    // Fire and forget — client polls /index-status for progress
    this.pgIndexing.indexAll().catch(() => {});
    return { message: 'Indexing started for all tables' };
  }

  @Post('pg/index/:table')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger re-index for a single PG table (async)' })
  indexTable(@Param('table') table: IndexableTable) {
    this.pgIndexing.indexTable(table).catch(() => {});
    return { message: `Indexing started for table: ${table}` };
  }

  @Delete('pg/index/:table')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear Qdrant vectors for a single PG table' })
  clearTableIndex(@Param('table') table: IndexableTable) {
    return this.pgIndexing.clearTableIndex(table);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Dynamic API — runtime testing, seeding, cache management
  // ══════════════════════════════════════════════════════════════════════════

  @Post('pg/api-endpoints/:id/test')
  @ApiOperation({ summary: 'Test an API endpoint live against a real symbol' })
  @ApiQuery({ name: 'symbol', required: false, description: 'Company ticker e.g. OQEP' })
  testApiEndpoint(
    @Param('id') id: string,
    @Query('symbol') symbol = 'OQEP',
  ) {
    return this.dynamicApi.testEndpoint(id, symbol);
  }

  @Post('pg/api-endpoints/seed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed the 14 default MSX.om API endpoints (idempotent)' })
  seedApiEndpoints() {
    return this.dynamicApi.seedDefaultEndpoints();
  }

  @Delete('admin/cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all dynamic API Redis cache' })
  async clearAllCache(@Request() req) {
    const n = await this.dynamicApi.clearCache();
    await this.audit.log(AuditService.ctx(req), {
      action: AuditAction.CACHE_CLEAR, resource: 'cache',
      details: `Cleared all Redis cache (${n} keys)`,
    });
    return { cleared: n };
  }

  @Delete('admin/cache/:symbol')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear Redis cache for a specific symbol' })
  async clearSymbolCache(@Param('symbol') symbol: string, @Request() req) {
    const n = await this.dynamicApi.clearCache(symbol);
    await this.audit.log(AuditService.ctx(req), {
      action: AuditAction.CACHE_CLEAR, resource: 'cache',
      details: `Cleared Redis cache for symbol ${symbol} (${n} keys)`,
    });
    return { cleared: n, symbol };
  }

  @Get('cache/stats')
  @ApiOperation({ summary: 'Redis cache stats — key counts by category, TTL reference' })
  getCacheStats() {
    return this.dynamicApi.getCacheStats();
  }

  @Get('models')
  @ApiOperation({ summary: 'List available AI models / provider info' })
  getModels() {
    return this.llm.getProviderInfo();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Company API routes — proxy to live MSX.om data
  // ══════════════════════════════════════════════════════════════════════════

  @Get('companies/snapshot/:symbol')
  @ApiOperation({ summary: 'Live company snapshot (price, change, volume)' })
  getCompanySnapshot(@Param('symbol') symbol: string) {
    return this.dynamicApi.getCompanyData('Company Snapshot', symbol);
  }

  @Get('companies/news/:symbol')
  @ApiOperation({ summary: 'Latest company news / announcements' })
  getCompanyNews(@Param('symbol') symbol: string) {
    return this.dynamicApi.getCompanyData('Company News', symbol);
  }

  @Get('companies/chart/:symbol')
  @ApiOperation({ summary: 'Real-time intraday chart data from company-chart-data.aspx' })
  @ApiQuery({ name: 'period', required: false })
  getCompanyChart(@Param('symbol') symbol: string) {
    return this.dynamicApi.getChartData(symbol);
  }

  @Get('companies/dividends/:symbol')
  @ApiOperation({ summary: 'Dividend distribution history (scraped from snapshot.aspx)' })
  getCompanyDividends(@Param('symbol') symbol: string) {
    return this.dynamicApi.getDividends(symbol);
  }

  @Get('companies/financial/:symbol')
  @ApiOperation({ summary: 'Financial statements (P&L, balance sheet)' })
  getCompanyFinancial(@Param('symbol') symbol: string) {
    return this.dynamicApi.getCompanyData('Financial Statements', symbol);
  }

  @Get('companies/board/:symbol')
  @ApiOperation({ summary: 'Board of directors — normalised role/name pairs' })
  getCompanyBoard(@Param('symbol') symbol: string) {
    return this.dynamicApi.getBoardMembers(symbol);
  }

  @Get('companies/ownership/:symbol')
  @ApiOperation({ summary: 'Ownership structure (Omani vs non-Omani)' })
  getCompanyOwnership(@Param('symbol') symbol: string) {
    return this.dynamicApi.getCompanyData('Ownership Structure', symbol);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Qdrant Admin — search, browse, manage vectors
  // ══════════════════════════════════════════════════════════════════════════

  /** GET /admin/qdrant/collections — list all collections with vector counts */
  @Get('qdrant/collections')
  @ApiOperation({ summary: 'List all Qdrant collections with stats' })
  async listQdrantCollections() {
    const names = await this.qdrant.listCollections();
    const stats = await Promise.all(
      names.map(async (name) => {
        const count = await this.qdrant.count(name);
        const raw   = await this.qdrant.getStats(name);
        return {
          name,
          vectors:    count,
          isCompany:  name.startsWith('msx_co_'),
          symbol:     name.startsWith('msx_co_') ? name.replace('msx_co_', '').toUpperCase() : null,
          status:     raw?.status ?? 'unknown',
          diskBytes:  raw?.segments_count ?? 0,
        };
      }),
    );
    return stats.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** POST /admin/qdrant/search — semantic search using a text query */
  @Post('qdrant/search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Semantic search across Qdrant collections' })
  async searchQdrant(
    @Body() body: {
      query:          string;
      collection?:    string;
      topK?:          number;
      scoreThreshold?: number;
      filterType?:    string;
      filterLanguage?: string;
    },
  ) {
    const t = Date.now();
    const { query, collection, topK = 10, scoreThreshold = 0.2, filterType, filterLanguage } = body;

    if (!query?.trim()) return { results: [], total: 0, queryMs: 0 };

    // Build optional Qdrant filter
    const must: any[] = [];
    if (filterType)     must.push({ key: 'type',     match: { value: filterType } });
    if (filterLanguage) must.push({ key: 'language', match: { value: filterLanguage } });
    const filter = must.length ? { must } : undefined;

    // Embed the query
    let vector: number[];
    try {
      vector = await this.embedding.embed(query);
    } catch (err) {
      return { results: [], total: 0, queryMs: Date.now() - t, error: err.message };
    }

    // Search — either a specific collection or all collections
    let results: any[];
    if (collection) {
      results = await this.qdrant.search(vector, topK, scoreThreshold, filter, collection);
      results = results.map(r => ({ ...r, collection }));
    } else {
      const collections = await this.qdrant.listCollections();
      const all = await Promise.all(
        collections.map(c =>
          this.qdrant.search(vector, topK, scoreThreshold, filter, c)
            .then(rs => rs.map(r => ({ ...r, collection: c })))
            .catch(() => []),
        ),
      );
      results = all
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    return {
      results: results.map(r => ({
        id:         r.id,
        score:      Math.round(r.score * 1000) / 1000,
        collection: r.collection,
        payload:    r.payload,
      })),
      total:   results.length,
      queryMs: Date.now() - t,
    };
  }

  /** GET /admin/qdrant/browse — scroll/browse vectors (no query needed) */
  @Get('qdrant/browse')
  @ApiOperation({ summary: 'Browse (scroll) Qdrant vectors without a search query' })
  @ApiQuery({ name: 'collection', required: false })
  @ApiQuery({ name: 'limit',      required: false })
  @ApiQuery({ name: 'offset',     required: false })
  @ApiQuery({ name: 'type',       required: false })
  async browseQdrant(
    @Query('collection') collection?: string,
    @Query('limit')      limit = '20',
    @Query('offset')     offset?: string,
    @Query('type')       type?: string,
  ) {
    const name   = collection ?? this.qdrant.defaultCollection;
    const filter = type ? { must: [{ key: 'type', match: { value: type } }] } : undefined;
    const { points, nextOffset } = await this.qdrant.scroll(
      name, parseInt(limit), offset || null, filter,
    );
    return {
      collection: name,
      points: points.map(p => ({ id: p.id, payload: p.payload })),
      nextOffset,
    };
  }

  /** DELETE /admin/qdrant/point/:id — delete a single vector */
  @Delete('qdrant/point/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a single Qdrant vector by ID' })
  @ApiQuery({ name: 'collection', required: false })
  async deleteQdrantPoint(
    @Param('id') id: string,
    @Query('collection') collection?: string,
    @Request() req?: any,
  ) {
    const name = collection ?? this.qdrant.defaultCollection;
    await this.qdrant.deletePoint(id, name);
    if (req) {
      await this.audit.log(AuditService.ctx(req), {
        action: AuditAction.KB_DELETE, resource: 'qdrant_vector',
        resourceId: id, details: `Deleted Qdrant point ${id} from ${name}`,
      });
    }
    return { deleted: id, collection: name };
  }

  // ── Qdrant snapshots ──────────────────────────────────────────────────────

  /** DELETE /admin/qdrant/all — wipe every Qdrant collection (super_admin only) */
  @Delete('qdrant/all')
  @HttpCode(HttpStatus.OK)
  @Roles('super_admin')
  @ApiOperation({ summary: 'Delete ALL Qdrant collections — super_admin only' })
  async deleteAllQdrantCollections(@Request() req) {
    const collections = await this.qdrant.listCollections();
    let deleted = 0;
    let failed  = 0;

    // Delete in parallel batches of 20 so we don't time out on large collection sets
    const BATCH = 20;
    for (let i = 0; i < collections.length; i += BATCH) {
      const batch = collections.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(name =>
          this.qdrant.deleteCollection(name)
            .then(() => true)
            .catch(() => false),
        ),
      );
      deleted += results.filter(Boolean).length;
      failed  += results.filter(v => !v).length;
    }

    await this.audit.log(AuditService.ctx(req), {
      action:   AuditAction.KB_DELETE,
      resource: 'qdrant_all',
      details:  `Wiped ALL Qdrant collections: ${deleted} deleted, ${failed} failed`,
    });
    return { deleted, failed, total: collections.length };
  }

  /** POST /admin/qdrant/snapshot  — create snapshot for all or one collection */
  @Post('qdrant/snapshot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create Qdrant snapshot (all collections or one)' })
  @ApiQuery({ name: 'collection', required: false })
  async createQdrantSnapshot(@Query('collection') collection?: string, @Request() req?: any) {
    const results = await this.qdrant.createSnapshot(collection || undefined);
    if (req) {
      await this.audit.log(AuditService.ctx(req), {
        action: AuditAction.SETTINGS_UPDATE, resource: 'qdrant_snapshot',
        details: `Manual snapshot: ${collection || 'all collections'}`,
      });
    }
    return { snapshots: results, total: results.length };
  }

  /** GET /admin/qdrant/snapshots/:collection — list snapshots for one collection */
  @Get('qdrant/snapshots/:collection')
  @ApiOperation({ summary: 'List Qdrant snapshots for a collection' })
  async listQdrantSnapshots(@Param('collection') collection: string) {
    const list = await this.qdrant.listSnapshots(collection);
    return { collection, snapshots: list };
  }

  /** DELETE /admin/qdrant/snapshot/:collection/:name — delete a named snapshot */
  @Delete('qdrant/snapshot/:collection/:name')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a named Qdrant snapshot' })
  async deleteQdrantSnapshot(
    @Param('collection') collection: string,
    @Param('name') name: string,
    @Request() req?: any,
  ) {
    await this.qdrant.deleteSnapshot(collection, name);
    if (req) {
      await this.audit.log(AuditService.ctx(req), {
        action: AuditAction.KB_DELETE, resource: 'qdrant_snapshot',
        details: `Deleted snapshot ${name} from ${collection}`,
      });
    }
    return { deleted: name, collection };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RAG Debug Tools (Feature #9: Admin Test Query)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /admin/rag/test
   * Run a test RAG query and return full debug info: retrieved chunks, scores,
   * whether the hard threshold would be met, and context preview.
   */
  @Post('rag/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test RAG retrieval — debug tool showing retrieved context and scores' })
  async testRagQuery(
    @Body() body: {
      query:           string;
      language?:       string;
      companySymbol?:  string;
    },
  ) {
    const start   = Date.now();
    const { query, language = 'en', companySymbol } = body;
    if (!query?.trim()) return { error: 'query is required' };

    const result = await this.rag.retrieve(query, language, companySymbol || undefined);

    // Determine what the chat service would do
    const hardThreshold = parseFloat(process.env.RAG_HARD_THRESHOLD ?? '0.55');
    const wouldRefuse =
      !result.hadResults ||
      (result.hadResults && result.topScore < hardThreshold);

    return {
      query,
      language,
      companySymbol:   companySymbol || null,
      hadResults:      result.hadResults,
      topScore:        result.topScore,
      hardThreshold,
      wouldRefuse,
      refuseReason:    !result.hadResults ? 'no_results' : wouldRefuse ? 'low_confidence' : null,
      sourceCount:     result.sources.length,
      sources:         result.sources,
      contextPreview:  result.context.slice(0, 800),
      latencyMs:       Date.now() - start,
    };
  }

  /**
   * GET /admin/retrieval-logs
   * Paginated retrieval audit trail — every RAG query with scores and refused/answered status.
   */
  @Get('retrieval-logs')
  @ApiOperation({ summary: 'RAG retrieval audit logs' })
  @ApiQuery({ name: 'page', required: false })
  async getRetrievalLogs(@Query('page') page = '1') {
    return this.appPg.listRetrievalLogs(parseInt(page));
  }

  /**
   * GET /admin/failed-jobs
   * Dead-letter queue — jobs that exhausted all retry attempts.
   */
  @Get('failed-jobs')
  @ApiOperation({ summary: 'Dead-letter queue — permanently failed background jobs' })
  @ApiQuery({ name: 'page',  required: false })
  @ApiQuery({ name: 'queue', required: false })
  async getFailedJobs(
    @Query('page') page = '1',
    @Query('queue') queue?: string,
  ) {
    return this.appPg.listFailedJobs(parseInt(page), 50, queue);
  }
}
