import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import Redis from 'ioredis';
import { ChatbootPgService } from './chatboot-pg.service';

// ─── Cache TTL by category (seconds) ─────────────────────────────────────────
const CACHE_TTL: Record<string, number> = {
  company:      5 * 60,    // 5 min  — snapshot changes often
  trading:      1 * 60,    // 1 min  — real-time trades
  news:         10 * 60,   // 10 min
  financial:    60 * 60,   // 1 hr
  chart:        5 * 60,    // 5 min
  governance:   86400,     // 1 day
  board:        86400,
  subsidiaries: 86400,
  ownership:    60 * 60,
  dividends:    60 * 60,
  general:      5 * 60,
};

// ─── Human-readable field names for MSX snapshot format ──────────────────────
const SNAPSHOT_FIELD_MAP: Record<string, string> = {
  LTP:            'Last Price',
  Change:         'Change',
  PerChange:      'Change%',
  Volume:         'Volume',
  Value:          'Value (OMR)',
  High:           'Day High',
  Low:            'Day Low',
  Open:           'Open',
  PreviousClose:  'Previous Close',
  NoOfTrades:     'No. of Trades',
  MarketCap:      'Market Cap',
  WeekHigh52:     '52-Week High',
  WeekLow52:      '52-Week Low',
  PE:             'P/E Ratio',
  EPS:            'EPS',
  Shares:         'Shares Outstanding',
  CompanyName:    'Company',
  Symbol:         'Symbol',
  Sector:         'Sector',
};

// ─── The 14 default MSX.om endpoints ─────────────────────────────────────────
const BASE = 'https://www.msx.om';

const DEFAULT_ENDPOINTS = [
  {
    name:        'Company Snapshot',
    description: 'Real-time company price, volume, change, high/low and key stats',
    url:         `${BASE}/snapshot.aspx/company`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['price', 'stock', 'company', 'share', 'value', 'ltp', 'last', 'current', 'today', 'snapshot'],
    keywords_ar: ['سعر', 'شركة', 'سهم', 'قيمة', 'اليوم', 'الحالي'],
    category:    'company',
    is_active:   true,
  },
  {
    name:        'Last 4 Years Performance',
    description: 'Annual performance data for the last 4 years',
    url:         `${BASE}/snapshot.aspx/SnapLast4years`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['performance', 'annual', 'yearly', 'history', 'years', 'trend', '4 year'],
    keywords_ar: ['أداء', 'سنوي', 'تاريخ', 'سنوات', 'اتجاه'],
    category:    'financial',
    is_active:   true,
  },
  {
    name:        'Last 20 Trades',
    description: 'Most recent 20 trade transactions for the company',
    url:         `${BASE}/snapshot.aspx/SnapLast20trades`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['trade', 'trading', 'transaction', 'deals', 'last trades', 'recent trades'],
    keywords_ar: ['صفقات', 'تداول', 'معاملات', 'آخر صفقات'],
    category:    'trading',
    is_active:   true,
  },
  {
    name:        'Financial Statements',
    description: 'Income statement, balance sheet and financial ratios',
    url:         `${BASE}/snapshot.aspx/SnapFinancial`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['financial', 'profit', 'revenue', 'income', 'balance', 'earnings', 'results', 'financials'],
    keywords_ar: ['مالية', 'أرباح', 'إيرادات', 'دخل', 'ميزانية', 'نتائج', 'بيانات مالية'],
    category:    'financial',
    is_active:   true,
  },
  {
    name:        'Company News',
    description: 'Latest announcements and news releases from the company',
    url:         `${BASE}/snapshot.aspx/SnapNews`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['news', 'announcement', 'release', 'press', 'update', 'latest news'],
    keywords_ar: ['أخبار', 'إعلانات', 'بيانات', 'نشرة', 'آخر أخبار'],
    category:    'news',
    is_active:   true,
  },
  {
    name:        'Dividend Distribution',
    description: 'Historical dividend payments and distribution reports',
    url:         `${BASE}/snapshot.aspx/DividendDistributionReports`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['dividend', 'distribution', 'payout', 'yield', 'cash dividend', 'bonus'],
    keywords_ar: ['توزيعات', 'أرباح موزعة', 'عائد', 'توزيع نقدي'],
    category:    'dividends',
    is_active:   true,
  },
  {
    name:        'Chart Data 1 Month',
    description: 'Historical OHLCV chart data for the past month',
    url:         `${BASE}/snapshot.aspx/CompanyChartData`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['chart', 'graph', 'historical', 'ohlcv', 'candlestick', 'price history'],
    keywords_ar: ['رسم بياني', 'مخطط', 'تاريخ السعر', 'بيانات تاريخية'],
    category:    'chart',
    is_active:   true,
  },
  {
    name:        'Board of Directors',
    description: 'Board of directors members and their roles',
    url:         `${BASE}/BODMembersSnap.aspx?s={symbol}`,
    method:      'GET',
    body:        {},
    headers:     {},
    keywords_en: ['board', 'director', 'chairman', 'management', 'board members', 'bods'],
    keywords_ar: ['مجلس الإدارة', 'مدير', 'رئيس مجلس', 'إدارة'],
    category:    'governance',
    is_active:   true,
  },
  {
    name:        'Subsidiaries & Associates',
    description: 'Subsidiary companies and associate holdings',
    url:         `${BASE}/SubsidiariesandAssociatesSnap.aspx?s={symbol}`,
    method:      'GET',
    body:        {},
    headers:     {},
    keywords_en: ['subsidiary', 'subsidiaries', 'associate', 'holding', 'group companies'],
    keywords_ar: ['شركات تابعة', 'تابعة', 'شركة تابعة', 'مجموعة'],
    category:    'subsidiaries',
    is_active:   true,
  },
  {
    name:        'Company News Annual',
    description: 'Full-year company news and announcements archive',
    url:         `${BASE}/company-news.aspx?s={symbol}&y=2025`,
    method:      'GET',
    body:        {},
    headers:     {},
    keywords_en: ['annual news', 'news archive', 'all news', 'year news'],
    keywords_ar: ['أخبار سنوية', 'أرشيف الأخبار'],
    category:    'news',
    is_active:   true,
  },
  {
    name:        'Sustainability Reports',
    description: 'ESG and sustainability performance reports',
    url:         `${BASE}/snapshot.aspx/SustainabilityReports`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['sustainability', 'esg', 'environment', 'green', 'social', 'governance report'],
    keywords_ar: ['استدامة', 'بيئي', 'اجتماعي', 'حوكمة بيئية'],
    category:    'governance',
    is_active:   true,
  },
  {
    name:        'Corporate Governance Report',
    description: 'Annual corporate governance compliance report',
    url:         `${BASE}/snapshot.aspx/CorporateGovernanceReport`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['governance', 'compliance', 'corporate governance', 'audit', 'committee'],
    keywords_ar: ['حوكمة', 'حوكمة الشركات', 'امتثال', 'تدقيق', 'لجنة'],
    category:    'governance',
    is_active:   true,
  },
  {
    name:        'Ownership Structure',
    description: 'Shareholding breakdown — Omani vs non-Omani ownership percentages',
    url:         `${BASE}/snapshot.aspx/SnapOwnership`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['ownership', 'non omani', 'foreign', 'shareholder structure', 'ownership percentage'],
    keywords_ar: ['ملكية', 'غير عماني', 'أجنبي', 'هيكل الملكية', 'نسبة الملكية'],
    category:    'ownership',
    is_active:   true,
  },
  {
    name:        'Major Shareholders',
    description: 'Top shareholders and their percentage stakes',
    url:         `${BASE}/snapshot.aspx/SnapMajorShareholders`,
    method:      'POST',
    body:        { Symbol: '{Symbol}' },
    headers:     {},
    keywords_en: ['major shareholder', 'top shareholder', 'largest holder', 'stake', 'institutional'],
    keywords_ar: ['كبار المساهمين', 'أكبر مساهم', 'حصة', 'مساهمين رئيسيين'],
    category:    'ownership',
    is_active:   true,
  },
];

// ─── Symbol regex — matches 2–6 uppercase letters as whole word ───────────────
const TICKER_RE = /\b([A-Z]{2,6})\b/g;

// ─── Common MSX stock symbols (fast lookup without DB hit) ───────────────────
const KNOWN_SYMBOLS = new Set([
  'OQEP','BKMB','BNK','NBO','NRIC','GSM','MERI','AIOM','OMAN',
  'ORPIC','OMVST','ABOB','ABOJ','HBMO','MBSB','UASC','DCOR',
  'OQAPC','SCBX','SMEF','ROON','HSMO','BKDB','CMSC',
  'MSM30','MFI','MSI','IFI', // indices
]);

@Injectable()
export class DynamicApiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DynamicApiService.name);
  private redis: Redis | null = null;

  constructor(
    private readonly pg: ChatbootPgService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    try {
      this.redis = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        commandTimeout: 2000,
      });
      this.redis.on('error', () => {}); // cache is best-effort
    } catch {
      this.logger.warn('Redis init failed — dynamic API caching disabled');
    }
  }

  async onModuleDestroy() {
    try { await this.redis?.quit(); } catch {}
  }

  // ─── {Symbol} substitution ────────────────────────────────────────────────

  /**
   * Recursively replace {Symbol} → UPPERCASE and {symbol} → lowercase
   * in strings, arrays, and plain objects.
   */
  substitute(template: any, symbol: string): any {
    if (typeof template === 'string') {
      return template
        .replace(/\{Symbol\}/g, symbol.toUpperCase())
        .replace(/\{symbol\}/g, symbol.toLowerCase());
    }
    if (Array.isArray(template)) {
      return template.map(v => this.substitute(v, symbol));
    }
    if (template && typeof template === 'object') {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(template)) {
        out[k] = this.substitute(v, symbol);
      }
      return out;
    }
    return template;
  }

  // ─── ASP.NET WebMethod unwrap ─────────────────────────────────────────────

  /**
   * Unwrap {"d": "JSON_STRING"} format returned by all MSX.om WebMethod endpoints.
   * If not in that format, return data as-is.
   */
  unwrap(data: any): any {
    if (data && typeof data === 'object' && typeof data.d === 'string') {
      try {
        const inner = JSON.parse(data.d);
        return inner;
      } catch {
        return data.d; // return raw string if not parseable
      }
    }
    return data;
  }

  // ─── HTTP caller with Redis caching ──────────────────────────────────────

  async callEndpoint(ep: any, symbol: string): Promise<any> {
    const url = this.substitute(ep.url, symbol);
    const ttl = CACHE_TTL[ep.category] ?? 300;
    const cacheKey = `msx:${ep.name}:${symbol.toUpperCase()}`;

    // Check Redis cache
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          this.logger.debug(`Cache HIT: ${cacheKey}`);
          return JSON.parse(cached);
        }
      } catch { /* redis unavailable */ }
    }

    // Make HTTP call
    let data: any;
    try {
      const method = (ep.method || 'GET').toUpperCase();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
        ...this.substitute(ep.headers || {}, symbol),
      };
      const body = method === 'POST'
        ? this.substitute(ep.body || {}, symbol)
        : undefined;

      const response = await axios({
        method,
        url,
        data: body,
        headers,
        timeout: 12_000,
        validateStatus: s => s < 500,
      });

      if (response.status >= 400) {
        this.logger.warn(`API call ${ep.name} returned HTTP ${response.status}`);
        return null;
      }

      data = this.unwrap(response.data);
    } catch (err: any) {
      this.logger.warn(`API call failed [${ep.name}/${symbol}]: ${err.message}`);
      return null;
    }

    // Cache the result
    if (this.redis && data !== null) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(data), 'EX', ttl);
      } catch { /* non-fatal */ }
    }

    return data;
  }

  // ─── Clear cache ──────────────────────────────────────────────────────────

  async clearCache(symbol?: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const pattern = symbol
        ? `msx:*:${symbol.toUpperCase()}`
        : 'msx:*';
      const keys = await this.redis.keys(pattern);
      if (!keys.length) return 0;
      await this.redis.del(...keys);
      return keys.length;
    } catch {
      return 0;
    }
  }

  // ─── Keyword matching ─────────────────────────────────────────────────────

  /**
   * Returns true if `message` contains ANY keyword from either list.
   * English: case-insensitive substring match.
   * Arabic: exact substring match.
   */
  matchKeywords(
    message: string,
    keywordsEn: string[],
    keywordsAr: string[],
  ): boolean {
    const lowerMsg = message.toLowerCase();
    for (const kw of keywordsEn ?? []) {
      if (kw && lowerMsg.includes(kw.toLowerCase())) return true;
    }
    for (const kw of keywordsAr ?? []) {
      if (kw && message.includes(kw)) return true;
    }
    return false;
  }

  // ─── Get endpoints that match user message ────────────────────────────────

  async getMatchedEndpoints(message: string): Promise<any[]> {
    try {
      const all = await this.pg.getActiveApiEndpoints();
      return all.filter(ep => {
        const hasKeywords = (ep.keywords_en?.length || ep.keywords_ar?.length);
        if (!hasKeywords) return false;
        return this.matchKeywords(
          message,
          ep.keywords_en ?? [],
          ep.keywords_ar ?? [],
        );
      });
    } catch (err: any) {
      this.logger.error(`Failed to load active endpoints: ${err.message}`);
      return [];
    }
  }

  // ─── Company symbol extraction ────────────────────────────────────────────

  /**
   * Extract the most likely stock symbol from a user message.
   * Strategy:
   *   1. Scan for known MSX symbols in the message
   *   2. Regex for any uppercase ticker-like token (2–6 chars)
   *   3. Try partial DB lookup if nothing found
   */
  extractSymbol(message: string): string | null {
    // Pass 1: known symbols
    const upper = message.toUpperCase();
    for (const sym of KNOWN_SYMBOLS) {
      // whole-word check
      const re = new RegExp(`\\b${sym}\\b`);
      if (re.test(upper)) return sym;
    }

    // Pass 2: generic uppercase-token regex in original message
    const tokens = message.match(TICKER_RE) ?? [];
    const filtered = tokens.filter(t =>
      t.length >= 2 &&
      t.length <= 6 &&
      !['GET','POST','PUT','THE','AND','FOR','ARE','MSX','URL','API','AI'].includes(t),
    );
    if (filtered.length) return filtered[0];

    return null;
  }

  // ─── Fetch and format live data for AI context ────────────────────────────

  async fetchDynamicData(message: string, symbol: string): Promise<string | null> {
    const endpoints = await this.getMatchedEndpoints(message);
    if (!endpoints.length) return null;

    this.logger.log(
      `Dynamic API: symbol=${symbol}, matched ${endpoints.length} endpoint(s): ` +
      endpoints.map(e => e.name).join(', '),
    );

    const results = await Promise.all(
      endpoints.map(async ep => {
        const data = await this.callEndpoint(ep, symbol);
        if (!data) return null;

        const isSnapshot = ep.category === 'company' || ep.name.toLowerCase().includes('snapshot');
        const formatted = isSnapshot
          ? this.formatSnapshotForAi(data)
          : this.flattenAny(data);

        return formatted ? `🔹 ${ep.name}:\n${formatted}` : null;
      }),
    );

    const valid = results.filter(Boolean);
    if (!valid.length) return null;

    const divider = '─'.repeat(40);
    return `📡 Live Market Data for ${symbol.toUpperCase()}\n${divider}\n${valid.join('\n\n')}`;
  }

  // ─── Formatters ───────────────────────────────────────────────────────────

  /**
   * Format MSX company snapshot using human-readable field names.
   * Input is the parsed inner object from the WebMethod response.
   */
  private formatSnapshotForAi(data: any): string {
    if (!data || typeof data !== 'object') return String(data ?? '');

    // The snapshot might be an object or an array of one object
    const obj: Record<string, any> = Array.isArray(data) ? data[0] : data;
    if (!obj) return '';

    const lines: string[] = [];
    for (const [raw, value] of Object.entries(obj)) {
      if (value === null || value === undefined || value === '' || value === '0') continue;
      const label = SNAPSHOT_FIELD_MAP[raw] ?? raw;
      lines.push(`  ${label}: ${value}`);
    }
    return lines.join('\n');
  }

  /**
   * Generic recursive flattener — handles any JSON shape.
   * Used for non-snapshot endpoints.
   */
  flattenAny(data: any, depth = 0, maxItems = 25): string {
    if (data === null || data === undefined) return '';
    if (typeof data === 'boolean') return String(data);

    if (typeof data === 'string') {
      const trimmed = data.trim();
      if (!trimmed || trimmed === '0' || trimmed.includes('{Symbol}')) return '';
      return trimmed;
    }

    if (typeof data === 'number') return String(data);
    if (depth > 3) return '…';

    if (Array.isArray(data)) {
      const items = data.slice(0, maxItems);
      const lines = items
        .map(item => {
          const line = this.flattenAny(item, depth + 1);
          return line ? `  • ${line}` : null;
        })
        .filter(Boolean);
      if (data.length > maxItems) lines.push(`  … and ${data.length - maxItems} more`);
      return lines.join('\n');
    }

    if (typeof data === 'object') {
      const lines: string[] = [];
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        if (count >= maxItems) { lines.push('  …'); break; }
        if (v === null || v === undefined || v === '' || v === 0 || v === '0') continue;
        const val = this.flattenAny(v, depth + 1);
        if (val) { lines.push(`  ${k}: ${val}`); count++; }
      }
      return lines.join('\n');
    }

    return '';
  }

  // ─── Test endpoint (admin) ────────────────────────────────────────────────

  async testEndpoint(id: string, symbol: string): Promise<any> {
    const ep = await this.pg.getApiEndpointById(id);
    if (!ep) throw new Error(`Endpoint not found: ${id}`);

    const raw = await this.callEndpoint({ ...ep, name: `__test_${ep.name}` }, symbol);
    return {
      endpoint: ep.name,
      symbol:   symbol.toUpperCase(),
      url:      this.substitute(ep.url, symbol),
      raw,
    };
  }

  // ─── Seed default endpoints ───────────────────────────────────────────────

  async seedDefaultEndpoints(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    for (const ep of DEFAULT_ENDPOINTS) {
      const existing = await this.pg.getApiEndpointByName(ep.name);
      if (existing) {
        skipped++;
        continue;
      }
      await this.pg.upsertApiEndpoint(ep);
      created++;
      this.logger.log(`Seeded endpoint: ${ep.name}`);
    }

    this.logger.log(
      `Seed complete: ${created} created, ${skipped} already existed`,
    );
    return { created, skipped };
  }
}
