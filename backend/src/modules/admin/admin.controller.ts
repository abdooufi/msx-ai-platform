import {
  Controller, Get, Post, Put, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/guards/roles.decorator';
import { AdminService } from './admin.service';
import { ChatbootPgService } from './chatboot-pg.service';
import { LlmService, AiProvider } from '../rag/llm.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'agent')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly pg: ChatbootPgService,
    private readonly llm: LlmService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // MongoDB / NestJS stats
  // ══════════════════════════════════════════════════════════════════════════

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard stats (MongoDB)' })
  getStats() {
    return this.admin.getDashboardStats();
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

  @Post('ai-provider')
  @ApiOperation({ summary: 'Switch AI provider at runtime (no restart needed)' })
  setAiProvider(@Body() body: { provider: AiProvider }) {
    return this.llm.setProvider(body.provider);
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
  upsertCompany(@Body() body: any) {
    return this.pg.upsertCompany(body);
  }

  @Delete('pg/companies/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a company' })
  deleteCompany(@Param('id') id: string) {
    return this.pg.deleteCompany(id);
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
  upsertFaq(@Body() body: any) {
    return this.pg.upsertFaq(body);
  }

  @Delete('pg/faqs/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a FAQ' })
  deleteFaq(@Param('id') id: string) {
    return this.pg.deleteFaq(id);
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
  upsertKnowledge(@Body() body: any) {
    return this.pg.upsertKnowledge(body);
  }

  @Delete('pg/knowledge-base/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a knowledge base entry' })
  deleteKnowledge(@Param('id') id: string) {
    return this.pg.deleteKnowledge(id);
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
  upsertApiEndpoint(@Body() body: any) {
    return this.pg.upsertApiEndpoint(body);
  }

  @Delete('pg/api-endpoints/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an API endpoint configuration' })
  deleteApiEndpoint(@Param('id') id: string) {
    return this.pg.deleteApiEndpoint(id);
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
}
