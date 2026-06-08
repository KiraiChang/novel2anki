jest.mock('deepl-node');
jest.mock('@anthropic-ai/sdk');

import * as deepl from 'deepl-node';
import Anthropic from '@anthropic-ai/sdk';
import { loadTranslatorConfig, batchTranslate, translateToZh } from '../../cards/translator';

// ── mock 設定 ─────────────────────────────────────────────────────────────────

const mockTranslateText = jest.fn();
(deepl.Translator as jest.Mock).mockImplementation(() => ({ translateText: mockTranslateText }));

const mockMessagesCreate = jest.fn();
(Anthropic as unknown as jest.Mock).mockImplementation(() => ({ messages: { create: mockMessagesCreate } }));

const origEnv = { ...process.env };
const origFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  // 清除所有相關 env
  delete process.env['TRANSLATE_PROVIDER'];
  delete process.env['DEEPL_API_KEY'];
  delete process.env['GOOGLE_TRANSLATE_API_KEY'];
  delete process.env['AZURE_TRANSLATOR_KEY'];
  delete process.env['AZURE_TRANSLATOR_REGION'];
  delete process.env['ANTHROPIC_API_KEY'];
  global.fetch = jest.fn();
});

afterEach(() => {
  // 還原 env
  Object.keys(origEnv).forEach(k => { process.env[k] = origEnv[k]; });
  global.fetch = origFetch;
});

// ── loadTranslatorConfig ──────────────────────────────────────────────────────

describe('loadTranslatorConfig', () => {
  it('should return deepl config when TRANSLATE_PROVIDER is unset (default)', () => {
    // Given
    process.env['DEEPL_API_KEY'] = 'deepl-key';
    // When
    const config = loadTranslatorConfig();
    // Then
    expect(config.provider).toBe('deepl');
    expect(config.apiKey).toBe('deepl-key');
  });

  it('should return deepl config when TRANSLATE_PROVIDER=deepl', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'deepl';
    process.env['DEEPL_API_KEY'] = 'deepl-key';
    // When / Then
    expect(loadTranslatorConfig().provider).toBe('deepl');
  });

  it('should return google config when TRANSLATE_PROVIDER=google', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'google';
    process.env['GOOGLE_TRANSLATE_API_KEY'] = 'google-key';
    // When
    const config = loadTranslatorConfig();
    // Then
    expect(config.provider).toBe('google');
    expect(config.apiKey).toBe('google-key');
  });

  it('should return azure config with default region eastasia when AZURE_TRANSLATOR_REGION unset', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'azure';
    process.env['AZURE_TRANSLATOR_KEY'] = 'azure-key';
    // When
    const config = loadTranslatorConfig();
    // Then
    expect(config.provider).toBe('azure');
    expect(config.region).toBe('eastasia');
  });

  it('should use AZURE_TRANSLATOR_REGION when set', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'azure';
    process.env['AZURE_TRANSLATOR_KEY'] = 'azure-key';
    process.env['AZURE_TRANSLATOR_REGION'] = 'japaneast';
    // When / Then
    expect(loadTranslatorConfig().region).toBe('japaneast');
  });

  it('should return claude config when TRANSLATE_PROVIDER=claude', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'claude';
    process.env['ANTHROPIC_API_KEY'] = 'claude-key';
    // When
    const config = loadTranslatorConfig();
    // Then
    expect(config.provider).toBe('claude');
    expect(config.apiKey).toBe('claude-key');
  });

  it('should throw when DEEPL_API_KEY is missing', () => {
    // Given: TRANSLATE_PROVIDER=deepl, no key
    process.env['TRANSLATE_PROVIDER'] = 'deepl';
    // When / Then
    expect(() => loadTranslatorConfig()).toThrow('DEEPL_API_KEY');
  });

  it('should throw when GOOGLE_TRANSLATE_API_KEY is missing', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'google';
    // When / Then
    expect(() => loadTranslatorConfig()).toThrow('GOOGLE_TRANSLATE_API_KEY');
  });

  it('should throw when AZURE_TRANSLATOR_KEY is missing', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'azure';
    // When / Then
    expect(() => loadTranslatorConfig()).toThrow('AZURE_TRANSLATOR_KEY');
  });

  it('should throw when ANTHROPIC_API_KEY is missing for claude provider', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'claude';
    // When / Then
    expect(() => loadTranslatorConfig()).toThrow('ANTHROPIC_API_KEY');
  });

  it('should throw for unknown TRANSLATE_PROVIDER value', () => {
    // Given
    process.env['TRANSLATE_PROVIDER'] = 'unknown-provider';
    process.env['DEEPL_API_KEY'] = 'key';
    // When / Then
    expect(() => loadTranslatorConfig()).toThrow();
  });
});

// ── batchTranslate — 空陣列短路 ───────────────────────────────────────────────

describe('batchTranslate — empty input', () => {
  it('should return empty array without calling any API', async () => {
    // Given
    const config = { provider: 'deepl' as const, apiKey: 'key' };
    // When
    const result = await batchTranslate([], config);
    // Then
    expect(result).toEqual([]);
    expect(mockTranslateText).not.toHaveBeenCalled();
  });
});

// ── batchTranslate — DeepL ─────────────────────────────────────────────────────

describe('batchTranslate — DeepL', () => {
  it('should call deepl-node translateText with texts and zh-HANT target', async () => {
    // Given
    const config = { provider: 'deepl' as const, apiKey: 'deepl-key' };
    mockTranslateText.mockResolvedValue([{ text: '快速奔跑' }]);
    // When
    await batchTranslate(['to sprint'], config);
    // Then
    expect(mockTranslateText).toHaveBeenCalledWith(['to sprint'], null, 'zh-HANT');
  });

  it('should return translated texts from deepl-node', async () => {
    // Given
    const config = { provider: 'deepl' as const, apiKey: 'deepl-key' };
    mockTranslateText.mockResolvedValue([{ text: '快速奔跑' }, { text: '大型哺乳動物' }]);
    // When
    const result = await batchTranslate(['to sprint', 'a large mammal'], config);
    // Then
    expect(result).toEqual(['快速奔跑', '大型哺乳動物']);
  });
});

// ── batchTranslate — Google ───────────────────────────────────────────────────

describe('batchTranslate — Google', () => {
  it('should call fetch with API key in URL', async () => {
    // Given
    const config = { provider: 'google' as const, apiKey: 'google-key' };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { translations: [{ translatedText: '快速奔跑' }] } }),
    });
    // When
    await batchTranslate(['to sprint'], config);
    // Then
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('google-key'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should send texts as q array in request body', async () => {
    // Given
    const config = { provider: 'google' as const, apiKey: 'google-key' };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { translations: [{ translatedText: '快速奔跑' }] } }),
    });
    // When
    await batchTranslate(['to sprint'], config);
    // Then
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string);
    expect(body.q).toEqual(['to sprint']);
    expect(body.target).toBe('zh-TW');
  });

  it('should return translated texts from Google response', async () => {
    // Given
    const config = { provider: 'google' as const, apiKey: 'google-key' };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { translations: [{ translatedText: '快速奔跑' }, { translatedText: '大型哺乳動物' }] },
      }),
    });
    // When
    const result = await batchTranslate(['to sprint', 'a large mammal'], config);
    // Then
    expect(result).toEqual(['快速奔跑', '大型哺乳動物']);
  });

  it('should throw when Google returns non-200 status', async () => {
    // Given
    const config = { provider: 'google' as const, apiKey: 'google-key' };
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
    // When / Then
    await expect(batchTranslate(['text'], config)).rejects.toThrow('403');
  });
});

// ── batchTranslate — Azure ────────────────────────────────────────────────────

describe('batchTranslate — Azure', () => {
  it('should send Ocp-Apim-Subscription-Key header', async () => {
    // Given
    const config = { provider: 'azure' as const, apiKey: 'azure-key', region: 'eastasia' };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ translations: [{ text: '快速奔跑', to: 'zh-Hant' }] }],
    });
    // When
    await batchTranslate(['to sprint'], config);
    // Then
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('azure-key');
  });

  it('should send Ocp-Apim-Subscription-Region header when region is set', async () => {
    // Given
    const config = { provider: 'azure' as const, apiKey: 'azure-key', region: 'japaneast' };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ translations: [{ text: '快速奔跑', to: 'zh-Hant' }] }],
    });
    // When
    await batchTranslate(['to sprint'], config);
    // Then
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Region']).toBe('japaneast');
  });

  it('should return translated texts from Azure response', async () => {
    // Given
    const config = { provider: 'azure' as const, apiKey: 'azure-key', region: 'eastasia' };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { translations: [{ text: '快速奔跑', to: 'zh-Hant' }] },
        { translations: [{ text: '大型哺乳動物', to: 'zh-Hant' }] },
      ],
    });
    // When
    const result = await batchTranslate(['to sprint', 'a large mammal'], config);
    // Then
    expect(result).toEqual(['快速奔跑', '大型哺乳動物']);
  });
});

// ── batchTranslate — Azure 429 retry ─────────────────────────────────────────

describe('batchTranslate — Azure 429 retry', () => {
  const azureConfig = { provider: 'azure' as const, apiKey: 'azure-key', region: 'eastasia' };

  const make429 = (retryAfterSec?: string) => ({
    status: 429,
    ok: false,
    headers: { get: (h: string) => h === 'Retry-After' ? (retryAfterSec ?? null) : null },
    json: async () => ({}),
  });

  const make200 = () => ({
    ok: true,
    json: async () => [{ translations: [{ text: '快速奔跑', to: 'zh-Hant' }] }],
  });

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('should retry and return successful translation after a single 429 response', async () => {
    // Given
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make200());
    // When
    const promise = batchTranslate(['to sprint'], azureConfig);
    await jest.runAllTimersAsync();
    const result = await promise;
    // Then
    expect(result).toEqual(['快速奔跑']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should NOT send second request before Retry-After delay has elapsed', async () => {
    // Given: Retry-After: 3 seconds
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(make429('3'))
      .mockResolvedValueOnce(make200());
    // When: advance only 2 seconds (not yet 3)
    const promise = batchTranslate(['to sprint'], azureConfig);
    await jest.advanceTimersByTimeAsync(2000);
    // Then: second call not yet sent
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Cleanup: drain so promise resolves
    await jest.runAllTimersAsync();
    await promise;
  });

  it('should send second request after full Retry-After seconds have elapsed', async () => {
    // Given: Retry-After: 3 seconds
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(make429('3'))
      .mockResolvedValueOnce(make200());
    // When: advance full 3 seconds
    const promise = batchTranslate(['to sprint'], azureConfig);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;
    // Then
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should NOT trigger second fetch within 2s when no Retry-After header (exponential backoff starts at 2s)', async () => {
    // Given: no Retry-After → first retry waits 2^1 = 2000ms
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make200());
    // When: advance only 1.9s
    const promise = batchTranslate(['to sprint'], azureConfig);
    await jest.advanceTimersByTimeAsync(1900);
    // Then: second fetch not yet triggered
    expect(global.fetch).toHaveBeenCalledTimes(1);
    // Cleanup
    await jest.runAllTimersAsync();
    await promise;
  });

  it('should throw error mentioning retry count after all AZURE_MAX_RETRIES attempts return 429', async () => {
    // Given: every response is 429
    (global.fetch as jest.Mock).mockResolvedValue(make429());
    // When
    const promise = batchTranslate(['to sprint'], azureConfig);
    // Register rejection handler BEFORE running timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow('已重試 4 次');
    await jest.runAllTimersAsync();
    // Then
    await assertion;
  });

  it('should write stderr warning message on each 429 retry', async () => {
    // Given
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make200());
    // When
    const promise = batchTranslate(['to sprint'], azureConfig);
    await jest.runAllTimersAsync();
    await promise;
    // Then
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('429'));
    stderrSpy.mockRestore();
  });
});

// ── batchTranslate — Claude ───────────────────────────────────────────────────

describe('batchTranslate — Claude', () => {
  it('should call messages.create with numbered list of texts', async () => {
    // Given
    const config = { provider: 'claude' as const, apiKey: 'claude-key' };
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '1. 快速奔跑\n2. 大型哺乳動物' }],
    });
    // When
    await batchTranslate(['to sprint', 'a large mammal'], config);
    // Then
    const prompt = mockMessagesCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('1. to sprint');
    expect(prompt).toContain('2. a large mammal');
  });

  it('should parse numbered response lines and return translations', async () => {
    // Given
    const config = { provider: 'claude' as const, apiKey: 'claude-key' };
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '1. 快速奔跑\n2. 大型哺乳動物' }],
    });
    // When
    const result = await batchTranslate(['to sprint', 'a large mammal'], config);
    // Then
    expect(result).toEqual(['快速奔跑', '大型哺乳動物']);
  });

  it('should fall back to original text when response has fewer items than input', async () => {
    // Given: Claude 只回傳 1 行，但輸入有 2 個
    const config = { provider: 'claude' as const, apiKey: 'claude-key' };
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '1. 快速奔跑' }],
    });
    // When
    const result = await batchTranslate(['to sprint', 'a large mammal'], config);
    // Then: 第二個 fallback 到原文
    expect(result[0]).toBe('快速奔跑');
    expect(result[1]).toBe('a large mammal');
  });
});

// ── translateToZh ─────────────────────────────────────────────────────────────

describe('translateToZh', () => {
  it('should return the first translated text', async () => {
    // Given
    const config = { provider: 'deepl' as const, apiKey: 'deepl-key' };
    mockTranslateText.mockResolvedValue([{ text: '快速奔跑' }]);
    // When
    const result = await translateToZh('to sprint', config);
    // Then
    expect(result).toBe('快速奔跑');
  });
});
