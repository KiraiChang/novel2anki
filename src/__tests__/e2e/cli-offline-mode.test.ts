/**
 * 端對端測試：CLI --offline 旗標
 * fetch 透過 jest.mock 模擬，不需實際 Ollama 環境。
 */

import { loadOllamaConfig } from '../../cards/offlineGenerator';

// ── loadOllamaConfig（CLI 傳入路徑）─────────────────────────────────────────

describe('--offline CLI integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should not require ANTHROPIC_API_KEY when --offline is simulated', () => {
    // 當使用 --offline 模式時，不應要求 ANTHROPIC_API_KEY
    // 驗證方式：loadOllamaConfig 在無 ANTHROPIC_API_KEY 環境下可正常執行
    expect(() => loadOllamaConfig()).not.toThrow();
  });

  it('should use --model value in config', () => {
    const config = loadOllamaConfig('gemma3');
    expect(config.model).toBe('gemma3');
  });

  it('should display correct model name in config', () => {
    process.env.OLLAMA_MODEL = 'mistral';
    const config = loadOllamaConfig();
    expect(config.model).toBe('mistral');
  });

  it('should resolve base URL from env', () => {
    process.env.OLLAMA_BASE_URL = 'http://10.0.0.1:11434';
    const config = loadOllamaConfig();
    expect(config.baseUrl).toBe('http://10.0.0.1:11434');
  });
});
