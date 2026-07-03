import { RagService } from './rag.service';

const configStub = { get: (_k: string, d?: any) => d } as any;

describe('RagService.chunkId', () => {
  const svc = new RagService(null as any, null as any, null as any, configStub) as any;

  it('is deterministic — same source + index always yields the same id', () => {
    expect(svc.chunkId('pg:faqs:42', 0)).toBe(svc.chunkId('pg:faqs:42', 0));
  });

  it('differs across chunk indexes and sources', () => {
    expect(svc.chunkId('pg:faqs:42', 0)).not.toBe(svc.chunkId('pg:faqs:42', 1));
    expect(svc.chunkId('pg:faqs:42', 0)).not.toBe(svc.chunkId('pg:faqs:43', 0));
  });

  it('is UUID-shaped (8-4-4-4-12 hex)', () => {
    expect(svc.chunkId('src', 7)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
