import { ChatService } from './chat.service';

/**
 * Unit tests for the pure-logic parts of ChatService.
 * The constructor only stores references, so dummy deps are safe here —
 * no test below touches the network or a database.
 */
const configStub = { get: (_k: string, d?: any) => d } as any;

function makeService(): ChatService {
  return new ChatService(
    null as any, // AppPgService
    null as any, // ChatbootPgService
    null as any, // RagService
    null as any, // LlmService
    null as any, // DynamicApiService
    null as any, // AnswerCacheService
    configStub,
  );
}

describe('ChatService off-topic guard', () => {
  const svc = makeService() as any;

  it('allows finance questions (English)', () => {
    expect(svc.checkOffTopic('What is the BKMB stock price?', 'en')).toBeNull();
    expect(svc.checkOffTopic('show me top gainers in the market', 'en')).toBeNull();
  });

  it('allows finance questions (Arabic)', () => {
    expect(svc.checkOffTopic('ما هو سعر سهم بنك مسقط؟', 'ar')).toBeNull();
  });

  it('blocks clearly off-topic questions', () => {
    expect(svc.checkOffTopic('give me a good pasta recipe', 'en')).toContain('MSX');
    expect(svc.checkOffTopic('ما هي أفضل وصفة طبخ', 'ar')).toContain('بورصة مسقط');
  });

  it('lets ambiguous questions through to the LLM', () => {
    expect(svc.checkOffTopic('hello, how are you?', 'en')).toBeNull();
  });

  it('finance keyword wins over off-topic keyword', () => {
    // "trip" is off-topic but "dividend" is finance → allow
    expect(svc.checkOffTopic('dividend payout before my trip', 'en')).toBeNull();
  });
});

describe('ChatService handoff detection', () => {
  const svc = makeService() as any;

  it('detects English handoff requests', () => {
    expect(svc.isHandoffRequest('I want to talk to a human')).toBe(true);
    expect(svc.isHandoffRequest('can I speak with an agent please')).toBe(true);
    expect(svc.isHandoffRequest('customer service number')).toBe(true);
  });

  it('detects Arabic handoff requests', () => {
    expect(svc.isHandoffRequest('أريد التحدث مع موظف')).toBe(true);
    expect(svc.isHandoffRequest('خدمة العملاء')).toBe(true);
  });

  it('does not trigger on normal questions', () => {
    expect(svc.isHandoffRequest('what is the MSM30 index?')).toBe(false);
    expect(svc.isHandoffRequest('human resources sector companies')).toBe(false);
  });
});

describe('ChatService chart request detection', () => {
  const svc = makeService() as any;

  it('detects chart requests in both languages', () => {
    expect(svc.isChartRequest('draw a chart for BKMB')).toBe(true);
    expect(svc.isChartRequest('show intraday graph')).toBe(true);
    expect(svc.isChartRequest('ارسم مخطط السهم')).toBe(true);
  });

  it('ignores non-chart messages', () => {
    expect(svc.isChartRequest('what is the price of BKMB?')).toBe(false);
  });
});

describe('ChatService.buildChartPayload', () => {
  const svc = makeService() as any;

  const raw = [
    { Year: 2026, Month: 7, Day: 3, Hour: 10, Minute: 30, LTP: '0.500', Volume: '1000', Turnover: '500' },
    { Year: 2026, Month: 7, Day: 3, Hour: 10, Minute: 0,  LTP: '0.480', Volume: '2000', Turnover: '960' },
    { Year: 2026, Month: 7, Day: 3, Hour: 11, Minute: 15, LTP: '0.520', Volume: '500',  Turnover: '260' },
  ];

  it('sorts points chronologically and computes OHLC summary', () => {
    const p = svc.buildChartPayload('bkmb', raw);
    expect(p.symbol).toBe('BKMB');
    expect(p.points.map((x: any) => x.time)).toEqual(['10:00', '10:30', '11:15']);
    expect(p.summary.open).toBe(0.48);
    expect(p.summary.last).toBe(0.52);
    expect(p.summary.high).toBe(0.52);
    expect(p.summary.low).toBe(0.48);
    expect(p.summary.totalShares).toBe(3500);
    expect(p.summary.tradesCount).toBe(3);
  });

  it('returns null for empty or invalid input', () => {
    expect(svc.buildChartPayload('bkmb', [])).toBeNull();
    expect(svc.buildChartPayload('bkmb', null)).toBeNull();
    expect(svc.buildChartPayload('bkmb', [{ LTP: '0' }])).toBeNull(); // zero prices filtered out
  });

  it('unwraps the { d: [...] } ASP.NET envelope', () => {
    const p = svc.buildChartPayload('bkmb', { d: raw });
    expect(p.points.length).toBe(3);
  });
});
