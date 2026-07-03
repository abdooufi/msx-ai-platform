import { LlmService } from './llm.service';

// Config stub returning defaults — no API keys, so provider falls back to ollama
const configStub = { get: (_k: string, d?: any) => d } as any;

describe('LlmService.detectLanguage', () => {
  const svc = new LlmService(configStub);

  it('detects English', async () => {
    expect(await svc.detectLanguage('What is the BKMB stock price today?')).toBe('en');
  });

  it('detects Arabic', async () => {
    expect(await svc.detectLanguage('ما هو سعر سهم بنك مسقط؟')).toBe('ar');
  });

  it('treats Arabic question with English ticker as Arabic', async () => {
    expect(await svc.detectLanguage('ما هو BKMB؟')).toBe('ar');
  });

  it('defaults to English for symbols-only input', async () => {
    expect(await svc.detectLanguage('123 ???')).toBe('en');
  });
});

describe('LlmService.pickAutoProvider', () => {
  it('routes short queries to ollama', () => {
    const svc = new LlmService(configStub);
    expect(svc.pickAutoProvider('BKMB price?')).toBe('ollama');
  });

  it('keeps live-data price queries local', () => {
    const svc = new LlmService(configStub);
    expect(svc.pickAutoProvider('what is the current price of BKMB', true)).toBe('ollama');
  });

  it('falls back to ollama when DeepSeek is not configured', () => {
    const svc = new LlmService(configStub);
    expect(svc.pickAutoProvider(
      'please give me a detailed comparison of the dividend history of all listed banks',
    )).toBe('ollama');
  });

  it('routes long queries to DeepSeek when configured', () => {
    const withKey = {
      get: (k: string, d?: any) => (k === 'DEEPSEEK_API_KEY' ? 'sk-test' : d),
    } as any;
    const svc = new LlmService(withKey);
    expect(svc.pickAutoProvider(
      'please give me a detailed comparison of the dividend history of all listed banks',
    )).toBe('deepseek');
  });
});
