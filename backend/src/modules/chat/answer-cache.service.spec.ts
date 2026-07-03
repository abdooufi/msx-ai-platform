import { AnswerCacheService } from './answer-cache.service';

// TTL=0 disables Redis entirely — tests stay offline
const disabledConfig = {
  get: (k: string, d?: any) => (k === 'ANSWER_CACHE_TTL' ? '0' : d),
} as any;

describe('AnswerCacheService key normalization', () => {
  const svc = new AnswerCacheService(disabledConfig) as any;

  it('ignores case, extra whitespace and trailing punctuation', () => {
    const a = svc.key('What is the BKMB price?', 'en');
    expect(svc.key('what is  the bkmb PRICE', 'en')).toBe(a);
    expect(svc.key('  What is the BKMB price???  ', 'en')).toBe(a);
  });

  it('normalizes Arabic question marks too', () => {
    expect(svc.key('ما هو سعر السهم؟', 'ar')).toBe(svc.key('ما هو سعر السهم', 'ar'));
  });

  it('separates entries by language', () => {
    expect(svc.key('hello', 'en')).not.toBe(svc.key('hello', 'ar'));
  });

  it('differs for different questions', () => {
    expect(svc.key('price of BKMB', 'en')).not.toBe(svc.key('price of OQEP', 'en'));
  });
});

describe('AnswerCacheService disabled mode', () => {
  const svc = new AnswerCacheService(disabledConfig);

  it('get returns null and set is a no-op when disabled', async () => {
    await svc.set('q', 'en', { text: 'a', language: 'en', sources: [] });
    expect(await svc.get('q', 'en')).toBeNull();
  });
});
