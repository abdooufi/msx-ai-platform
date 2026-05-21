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

// ─── Exact field mapping from real MSX API response ──────────────────────────
const FIELD_MAP: Record<string, string> = {
  // Price
  LTP:              'Current Price (LTP)',
  ClosePrice:       'Close Price',
  OpenPrice:        'Open Price',
  High:             'High',
  Low:              'Low',
  PrevClose:        'Previous Close',
  // Change
  Change:           'Change %',
  ChangeVal:        'Change Value',
  Image:            'Trend',
  // Volume
  Volume:           'Volume',
  LTV:              'Last Trade Volume',
  Turnover:         'Turnover',
  NoOfTrades:       'No. of Trades',
  // Bid/Ask
  BidPrice:         'Bid Price',
  BidVolume:        'Bid Volume',
  AskPrice:         'Ask Price',
  AskVolume:        'Ask Volume',
  // Company identity
  Symbol:           'Symbol',
  ShortNameEn:      'Name (EN)',
  ShortNameAr:      'Name (AR)',
  LongNameEn:       'Full Name (EN)',
  LongNameAr:       'Full Name (AR)',
  GroupEn:          'Market Group',
  GroupAr:          'Market Group (AR)',
  MarketID:         'Market ID',
  Type:             'Type',
  // Ownership
  NonOmani:         'Non-Omani Ownership %',
  GCC:              'GCC Ownership %',
  Arab:             'Arab Ownership %',
  Foreign:          'Foreign Ownership %',
  Omani:            'Omani Ownership %',
  NonOmaniPct:      'Non-Omani %',
  GCCPct:           'GCC %',
  ArabPct:          'Arab %',
  ForeignPct:       'Foreign %',
  OmaniPct:         'Omani %',
  // Status
  QuarterStatusEn:  'Quarter Status',
};

const PRIORITY_FIELDS = [
  'Current Price (LTP)', 'Change %', 'Change Value', 'Trend',
  'Open Price', 'High', 'Low', 'Previous Close',
  'Volume', 'Turnover', 'No. of Trades', 'Last Trade Volume',
  'Bid Price', 'Ask Price', 'Market Group',
  'Non-Omani Ownership %', 'GCC Ownership %',
  'Arab Ownership %', 'Foreign Ownership %', 'Omani Ownership %',
];

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
    name:        'Chart Data',
    description: 'Real-time intraday trade data — each trade record with LTP, Volume and timestamp',
    url:         `${BASE}/company-chart-data.aspx?t=true&s={symbol}`,
    method:      'GET',
    body:        {},
    headers:     {},
    keywords_en: ['chart', 'graph', 'historical', 'ohlcv', 'candlestick', 'price history', 'intraday', 'trades today'],
    keywords_ar: ['رسم بياني', 'مخطط', 'تاريخ السعر', 'بيانات تاريخية', 'صفقات اليوم'],
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
   * Unwrap MSX.om ASP.NET WebMethod responses.
   *
   * The API returns one of two shapes:
   *   { "d": "JSON_STRING" }   — WebMethod string-serialised response (old endpoints)
   *   { "d": [ {...}, ... ] }  — WebMethod returning a pre-parsed array/object (most snapshot.aspx endpoints)
   *
   * In both cases we want the inner value.  We also handle the edge case
   * where the response is already a plain array / object with no "d" wrapper.
   */
  unwrap(data: any): any {
    if (data && typeof data === 'object' && 'd' in data) {
      const d = data.d;
      if (typeof d === 'string') {
        try { return JSON.parse(d); } catch { return d; }
      }
      // d is already parsed (array or nested object) — return it directly
      return d;
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

  // ─── Cache stats ─────────────────────────────────────────────────────────

  async getCacheStats(): Promise<{
    connected: boolean;
    totalKeys: number;
    byCategory: Record<string, number>;
    ttlReference: Record<string, number>;
  }> {
    const ttlReference = { ...CACHE_TTL };

    if (!this.redis) {
      return { connected: false, totalKeys: 0, byCategory: {}, ttlReference };
    }

    try {
      const keys = await this.redis.keys('msx:*');
      const byCategory: Record<string, number> = {};

      for (const key of keys) {
        // key format: msx:{endpointName}:{SYMBOL}
        // use category from endpoint name heuristic
        const parts = key.split(':');
        const endpointName = parts[1] ?? 'unknown';
        // Try to map back to category via endpoint name lookup in DEFAULT_ENDPOINTS
        const ep = DEFAULT_ENDPOINTS.find(e => e.name === endpointName);
        const cat = ep?.category ?? 'general';
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      }

      return { connected: true, totalKeys: keys.length, byCategory, ttlReference };
    } catch {
      return { connected: false, totalKeys: 0, byCategory: {}, ttlReference };
    }
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
    let pool: any[] = [];

    try {
      const dbEndpoints = await this.pg.getActiveApiEndpoints();
      pool = dbEndpoints.length ? dbEndpoints : DEFAULT_ENDPOINTS;
    } catch (err: any) {
      this.logger.warn(`DB endpoint lookup failed, using defaults: ${err.message}`);
      pool = DEFAULT_ENDPOINTS;
    }

    return pool.filter(ep => {
      const hasKeywords = (ep.keywords_en?.length || ep.keywords_ar?.length);
      if (!hasKeywords) return false;
      return this.matchKeywords(
        message,
        ep.keywords_en ?? [],
        ep.keywords_ar ?? [],
      );
    });
  }

  // ─── Company symbol / query extraction ───────────────────────────────────

  /**
   * Port of Python detect_company_query():
   * 1. MSX URL param (?s=SYMBOL)
   * 2. Uppercase ticker standalone (3–6 chars, not in stopwords)
   * 3. Trigger words → extract name after them
   * 4. Arabic text pattern
   */
  detectCompanyQuery(message: string): string | null {
    // 1. MSX URL param
    const urlMatch = message.match(/[?&]s=([A-Za-z0-9]+)/i);
    if (urlMatch) return urlMatch[1].toUpperCase();

    const STOPWORDS = new Set([
      'WHAT','WHEN','WHERE','TELL','SHOW','GIVE','FROM','WITH',
      'ABOUT','INFO','THIS','THAT','HAVE','DOES','WILL','YOUR',
      'THEIR','HELP','NEED','WANT','PLEASE','THANK','HELLO','GOOD',
      'LIST','MOST','LAST','NEXT','BEST','MORE','LESS','MANY','THE',
      'SURE','JUST','SOME','MUCH','VERY','ALSO','ONLY','THEN','THAN',
      'GET','POST','PUT','ARE','MSX','URL','API','AI','FOR',
    ]);

    // 2. Known symbols first
    const upper = message.toUpperCase();
    for (const sym of KNOWN_SYMBOLS) {
      if (new RegExp(`\\b${sym}\\b`).test(upper)) return sym;
    }

    // 3. Generic uppercase tickers (3–6 chars)
    const tickers = message.match(/\b([A-Z]{3,6})\b/g) ?? [];
    for (const t of tickers) {
      if (!STOPWORDS.has(t)) return t;
    }

    // 4. Trigger-word extraction
    const triggerMatch = message.match(
      /(?:about|info(?:rmation)?|search|lookup|find|price(?:\s+of)?|stock(?:\s+of)?|shares?(?:\s+of)?|company|tell me about|what is|show me|details?|explain|news(?:\s+of)?|dividend(?:\s+of)?|financial(?:\s+of)?|chart(?:\s+of)?|trade(?:\s+of)?|أخبار|سعر|شركة|معلومات|توزيعات|مالية|تداول|رسم)\s+(?:of\s+|for\s+|about\s+)?(.+?)(?:\?|$)/i,
    );
    if (triggerMatch) {
      let raw = triggerMatch[1].trim().replace(/^(?:of|for|about|the|on)\s+/i, '').trim();
      if (/^[A-Z]{3,6}$/.test(raw)) return raw;
      if (raw) return raw;
    }

    // 5. Arabic text pattern
    const arMatch = message.match(/[؀-ۿ\s]{3,}/);
    if (arMatch) return arMatch[0].trim();

    return null;
  }

  /** Alias kept for backward compat */
  extractSymbol(message: string): string | null {
    return this.detectCompanyQuery(message);
  }

  /**
   * Full symbol resolution:
   * 1. Fast static pattern matching (no DB hit)
   * 2. DB fallback — searches clone_name, all name columns, symbol
   *
   * Use this in ChatService instead of the sync extractSymbol().
   */
  async resolveSymbolWithDb(message: string): Promise<string | null> {
    // 1. Static — covers known symbols, URL params, uppercase tickers
    const fast = this.detectCompanyQuery(message);
    if (fast) return fast;

    // 2. DB fallback — uses clone_name + all name columns
    try {
      return await this.pg.findCompanyByAlias(message);
    } catch (err: any) {
      this.logger.warn(`DB alias lookup failed: ${err.message}`);
      return null;
    }
  }

  // ─── Time period detection ────────────────────────────────────────────────

  /** Detect historical-price duration from message: D/W/M/Y */
  detectDuration(message: string): 'D' | 'W' | 'M' | 'Y' {
    const m = message.toLowerCase();
    if (/daily|today|\bday\b|يومي/.test(m))     return 'D';
    if (/weekly|\bweek\b|أسبوعي/.test(m))        return 'W';
    if (/yearly|\byear\b|annual|سنوي/.test(m))   return 'Y';
    return 'M';
  }

  /** Detect chart period from message: 1w/1m/3m/6m/1y/5y */
  detectChartPeriod(message: string): '1w' | '1m' | '3m' | '6m' | '1y' | '5y' {
    const m = message.toLowerCase();
    if (/week|1w|7\s*day/.test(m))              return '1w';
    if (/3\s*month|3m|quarter/.test(m))         return '3m';
    if (/6\s*month|6m|half/.test(m))            return '6m';
    if (/\byear\b|1y|12\s*month/.test(m))       return '1y';
    if (/5\s*year|5y/.test(m))                  return '5y';
    return '1m';
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
          ? this.formatSnapshotForAi(symbol, data)
          : this.flattenAny(data).join('\n');

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
   * Returns null for blank / zero / template placeholder values.
   * Port of Python _clean() in msx_parser.py.
   */
  cleanValue(v: any): any {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return null;
      if (t.includes('{Symbol}') || t.includes('{symbol}')) return null;
      // Filter string representations of zero  ("0", "0.0", "0.00", "0,000" etc.)
      const numericStr = t.replace(/,/g, '');
      if (!isNaN(Number(numericStr)) && Number(numericStr) === 0) return null;
      return t;
    }
    if (typeof v === 'number') {
      if (v === 0 || !isFinite(v)) return null;
      return v;
    }
    return v;
  }

  /**
   * Map raw API keys to human-readable labels (port of parse_company_snapshot()).
   * Returns a flat Record with clean values only.
   */
  parseCompanySnapshot(data: any): Record<string, any> {
    const obj: Record<string, any> = Array.isArray(data) ? (data[0] ?? {}) : (data ?? {});
    const result: Record<string, any> = {};

    for (const [k, v] of Object.entries(obj)) {
      const clean = this.cleanValue(v);
      if (clean === null) continue;
      const label = FIELD_MAP[k] ?? k;
      result[label] = clean;
    }
    return result;
  }

  /**
   * Format MSX company snapshot using human-readable field names,
   * with priority fields shown first. Port of format_snapshot_for_ai().
   */
  formatSnapshotForAi(symbol: string, data: any): string {
    const mapped = this.parseCompanySnapshot(data);
    if (!Object.keys(mapped).length) return '';

    const lines: string[] = [];
    lines.push(`📊 Live Market Data: ${symbol.toUpperCase()}`);

    // Priority fields first
    for (const label of PRIORITY_FIELDS) {
      if (label in mapped) {
        lines.push(`  ${label}: ${mapped[label]}`);
      }
    }

    // Remaining fields not in priority list
    for (const [label, value] of Object.entries(mapped)) {
      if (!PRIORITY_FIELDS.includes(label)) {
        lines.push(`  ${label}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generic recursive flattener — handles any JSON shape.
   * Returns an array of bullet-point strings (port of flatten_any()).
   * Used for non-snapshot endpoints.
   */
  flattenAny(data: any, prefix = '', depth = 0): string[] {
    if (depth > 4) return [];
    if (data === null || data === undefined) return [];

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      const clean = this.cleanValue(data);
      if (clean === null) return [];
      const line = prefix ? `${prefix}: ${clean}` : String(clean);
      return [line];
    }

    if (Array.isArray(data)) {
      const lines: string[] = [];
      const items = data.slice(0, 25);
      for (let i = 0; i < items.length; i++) {
        const sub = this.flattenAny(
          items[i],
          prefix ? `${prefix}[${i + 1}]` : `Item ${i + 1}`,
          depth + 1,
        );
        lines.push(...sub.map(l => `  ${l}`));
      }
      if (data.length > 25) lines.push(`  … and ${data.length - 25} more`);
      return lines;
    }

    if (typeof data === 'object') {
      const lines: string[] = [];
      let count = 0;
      for (const [k, v] of Object.entries(data)) {
        if (count >= 30) { lines.push('  …'); break; }
        const label = FIELD_MAP[k] ?? k;
        const sub = this.flattenAny(v, prefix ? `${prefix} > ${label}` : label, depth + 1);
        if (sub.length) { lines.push(...sub); count++; }
      }
      return lines;
    }

    return [];
  }

  // ─── Chart data (intraday) ────────────────────────────────────────────────

  /**
   * Fetch real-time intraday chart data from company-chart-data.aspx.
   * Returns an array of trade records: { Year, Month, Day, Hour, Minute, LTP, Volume, Value, Turnover }.
   * The Date field is null — date must be constructed from the numeric fields.
   */
  async getChartData(symbol: string): Promise<any> {
    const ep = {
      name:     'Chart Data',
      url:      `${BASE}/company-chart-data.aspx?t=true&s={symbol}`,
      method:   'GET',
      body:     {},
      headers:  {},
      category: 'chart',
    };
    return this.callEndpoint(ep, symbol);
  }

  // ─── Board members transformer ────────────────────────────────────────────

  /**
   * Fetch board/profile data from BODMembersSnap.aspx and normalise it into
   * a flat array of { role, nameEn, nameAr } objects that the frontend can
   * display generically.
   *
   * BODMembersSnap returns an array where the first element is the company
   * profile record (ChairmanEn/Ar, DeputyEn/Ar, MemberNameEn/Ar, etc.).
   */
  async getBoardMembers(symbol: string): Promise<{ role: string; nameEn: string; nameAr: string }[]> {
    const raw = await this.getCompanyData('Board of Directors', symbol);
    const rec = Array.isArray(raw) ? (raw[0] ?? {}) : (raw ?? {});

    const ROLES: Array<[string, string, string]> = [
      // [displayRole, EnField, ArField]
      ['Chairman',                 'ChairmanEn',             'ChairmanAr'],
      ['Deputy',                   'DeputyEn',               'DeputyAr'],
      ['Secretary',                'SecretaryEn',            'SecretaryAr'],
      ['Members',                  'MembersEn',              'MembersAr'],
      ['Executive President',      'ExecutivePresidentEn',   'ExecutivePresidentAr'],
      ['Deputy Exec. President',   'DeputyExecutivePresidentEn', 'DeputyExecutivePresidentAr'],
      ['Managing Director',        'ManagingDirectorEn',     'ManagingDirectorAr'],
      ['Internal Auditor',         'InternalAuditorAr',      'InternalAuditorAr'],
      ['Legal Advisor',            'LegalAdvisorEn',         'LegalAdvisorAr'],
      ['Auditor',                  'AuditorEn',              'AuditorAr'],
    ];

    // Also include individual member rows (when endpoint returns multiple rows)
    const members = Array.isArray(raw) ? raw : [];
    const result: { role: string; nameEn: string; nameAr: string }[] = [];

    // Named roles from the first record
    for (const [role, enField, arField] of ROLES) {
      const nameEn = String(rec[enField] ?? '').trim();
      const nameAr = String(rec[arField] ?? '').trim();
      if (nameEn || nameAr) {
        result.push({ role, nameEn, nameAr });
      }
    }

    // Additional member rows (some companies return each board member as a separate array element)
    for (let i = 1; i < members.length; i++) {
      const m = members[i];
      const nameEn = String(m.MemberNameEn ?? m.NameEn ?? m.ExecutivePresidentEn ?? '').trim();
      const nameAr = String(m.MemberNameAr ?? m.NameAr ?? '').trim();
      const role   = String(m.IndependentEn ?? m.ExecutiveEn ?? m.ShareholderEn ?? 'Member').trim();
      if (nameEn || nameAr) {
        result.push({ role, nameEn, nameAr });
      }
    }

    return result;
  }

  // ─── Company data by category ────────────────────────────────────────────

  /**
   * Fetch data from the first active endpoint matching a given name or category.
   * Used by company API routes.
   */
  async getCompanyData(
    nameOrCategory: string,
    symbol: string,
    byCategory = false,
  ): Promise<any> {
    let ep: any = null;
    if (byCategory) {
      const all = await this.pg.getActiveApiEndpoints();
      ep = all.find(e => e.category === nameOrCategory);
    } else {
      ep = await this.pg.getApiEndpointByName(nameOrCategory);
    }
    if (!ep) {
      // fallback to DEFAULT_ENDPOINTS
      const def = byCategory
        ? DEFAULT_ENDPOINTS.find(e => e.category === nameOrCategory)
        : DEFAULT_ENDPOINTS.find(e => e.name === nameOrCategory);
      if (!def) throw new Error(`No endpoint found for: ${nameOrCategory}`);
      ep = def;
    }
    return this.callEndpoint(ep, symbol);
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
