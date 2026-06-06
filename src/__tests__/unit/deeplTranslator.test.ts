import { loadDeepLConfig } from '../../cards/deeplTranslator';

describe('loadDeepLConfig', () => {
  const ORIG = process.env.DEEPL_API_KEY;

  afterEach(() => {
    if (ORIG === undefined) delete process.env.DEEPL_API_KEY;
    else process.env.DEEPL_API_KEY = ORIG;
  });

  it('should return config when DEEPL_API_KEY is set', () => {
    process.env.DEEPL_API_KEY = 'test-key-123';
    const cfg = loadDeepLConfig();
    expect(cfg.apiKey).toBe('test-key-123');
  });

  it('should throw when DEEPL_API_KEY is not set', () => {
    delete process.env.DEEPL_API_KEY;
    expect(() => loadDeepLConfig()).toThrow('DEEPL_API_KEY');
  });
});
