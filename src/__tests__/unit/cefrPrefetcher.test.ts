jest.mock('../../nlp/wordCache');
jest.mock('../../cards/deeplTranslator');

import { getWordCache } from '../../nlp/wordCache';
import { batchTranslate } from '../../cards/deeplTranslator';
import { prefetchCefrToWordCache, prefetchCefrZhToWordCache } from '../../nlp/cefrPrefetcher';

// ── 共用 mock ─────────────────────────────────────────────────────────────────

const mockCache = {
  get:        jest.fn(),
  getChinese: jest.fn(),
  setCache:   jest.fn(),
  setDict:    jest.fn(),
  setChinese: jest.fn(),
  flush:      jest.fn(),
  cacheSize:  0,
};

const origMwKey  = process.env.MW_API_KEY;
const origFetch  = global.fetch;

// 測試用詞列表（3 個詞，避免跑真實 5782 筆）
const TEST_WORDS = ['run', 'bear', 'go'];

const DEEPL_CONFIG = { apiKey: 'test-deepl-key' };

beforeEach(() => {
  jest.clearAllMocks();
  (getWordCache as jest.Mock).mockReturnValue(mockCache);
  mockCache.get.mockReturnValue(null);        // 預設：英文 cache miss
  mockCache.getChinese.mockReturnValue(null); // 預設：中文 cache miss
  delete process.env.MW_API_KEY;
  global.fetch = jest.fn();
});

afterEach(() => {
  if (origMwKey === undefined) delete process.env.MW_API_KEY;
  else process.env.MW_API_KEY = origMwKey;
  global.fetch = origFetch;
});

// ── 快取命中（跳過邏輯）──────────────────────────────────────────────────────

describe('prefetchCefrToWordCache — cache hit', () => {
  it('should skip word and increment skippedCount when word-cache has base-key hit', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should skip word and report tier=dict when word-dict has entry', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) curated', tier: 'dict' });
    const progress: string[] = [];
    // When
    await prefetchCefrToWordCache((_, __, meta) => progress.push(meta.source), ['run']);
    // Then
    expect(progress).toEqual(['dict']);
    expect(mockCache.setCache).not.toHaveBeenCalled();
  });

  it('should return skippedCount equal to total when all words are cached', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) cached', tier: 'cache' });
    // When
    const result = await prefetchCefrToWordCache(undefined, TEST_WORDS);
    // Then
    expect(result.skippedCount).toBe(3);
    expect(result.fetchedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.totalCount).toBe(3);
  });
});

// ── 無 MW_API_KEY ─────────────────────────────────────────────────────────────

describe('prefetchCefrToWordCache — no MW_API_KEY', () => {
  it('should increment failedCount and not call fetch when MW_API_KEY is not set', async () => {
    // Given: cache miss, no MW key
    mockCache.get.mockReturnValue(null);
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should report source=no-key in progress callback', async () => {
    // Given
    const sources: string[] = [];
    // When
    await prefetchCefrToWordCache((_, __, meta) => sources.push(meta.source), ['run']);
    // Then
    expect(sources).toEqual(['no-key']);
  });
});

// ── MW API 呼叫成功 ───────────────────────────────────────────────────────────

describe('prefetchCefrToWordCache — MW API success', () => {
  it('should call fetch with word in URL when MW_API_KEY is set and cache misses', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'verb', shortdef: ['to move on foot rapidly'] }],
    });
    // When
    await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('run'),
      expect.anything(),
    );
  });

  it('should store each POS entry separately as word:pos key', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { fl: 'verb', shortdef: ['to move on foot rapidly'] },
        { fl: 'noun', shortdef: ['a race or contest of running'] },
      ],
    });
    // When
    await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(mockCache.setCache).toHaveBeenCalledWith('run', 'verb', expect.stringContaining('to move on foot'), 'MW');
    expect(mockCache.setCache).toHaveBeenCalledWith('run', 'noun', expect.stringContaining('a race or contest'), 'MW');
  });

  it('should also store base (POS-agnostic) key with first usable definition', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { fl: 'verb', shortdef: ['to move on foot rapidly'] },
        { fl: 'noun', shortdef: ['a race or contest of running'] },
      ],
    });
    // When
    await prefetchCefrToWordCache(undefined, ['run']);
    // Then: null = POS-agnostic base key
    expect(mockCache.setCache).toHaveBeenCalledWith('run', null, expect.stringContaining('to move on foot'), 'MW');
  });

  it('should increment fetchedCount and report source=MW on success', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'verb', shortdef: ['to move on foot rapidly'] }],
    });
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.fetchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });
});

// ── MW API 失敗情境 ───────────────────────────────────────────────────────────

describe('prefetchCefrToWordCache — MW API failures', () => {
  it('should increment failedCount when MW returns non-200 status', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403 });
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setCache).not.toHaveBeenCalled();
  });

  it('should increment failedCount when MW response contains no object entries (word not found)', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    // MW 回傳建議字串陣列代表查無此詞
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ['runner', 'running', 'runway'],
    });
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setCache).not.toHaveBeenCalled();
  });

  it('should increment failedCount when fetch throws (network error)', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network error'));
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setCache).not.toHaveBeenCalled();
  });

  it('should increment failedCount when all shortdef entries are too short to be usable', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'verb', shortdef: ['run'] }], // too short (< 10 chars)
    });
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
  });
});

// ── flush & 計數 ──────────────────────────────────────────────────────────────

describe('prefetchCefrToWordCache — flush and counts', () => {
  it('should call flush() exactly once after processing all words', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'verb', shortdef: ['to move on foot rapidly'] }],
    });
    // When
    await prefetchCefrToWordCache(undefined, TEST_WORDS);
    // Then
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });

  it('should return correct counts for mixed results', async () => {
    // Given: run → cached, bear → MW success, go → fetch error
    process.env.MW_API_KEY = 'test-key';
    mockCache.get
      .mockReturnValueOnce({ def: '(verb) to sprint', tier: 'cache' }) // run → skip
      .mockReturnValueOnce(null)                                        // bear → fetch
      .mockReturnValueOnce(null);                                       // go → fetch
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ fl: 'noun', shortdef: ['a large omnivorous mammal'] }],
      })
      .mockRejectedValueOnce(new Error('timeout'));
    // When
    const result = await prefetchCefrToWordCache(undefined, TEST_WORDS);
    // Then
    expect(result.totalCount).toBe(3);
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});

// ── prefetchCefrZhToWordCache ─────────────────────────────────────────────────

describe('prefetchCefrZhToWordCache — Chinese cache hit', () => {
  it('should skip word and increment skippedCount when Chinese cache already has entry', async () => {
    // Given
    mockCache.getChinese.mockReturnValue('快速奔跑');
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(batchTranslate).not.toHaveBeenCalled();
  });

  it('should report source=cached in progress callback for Chinese cache hit', async () => {
    // Given
    mockCache.getChinese.mockReturnValue('快速奔跑');
    const sources: string[] = [];
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, (_, __, meta) => sources.push(meta.source), ['run']);
    // Then
    expect(sources).toEqual(['cached']);
  });
});

describe('prefetchCefrZhToWordCache — no English definition', () => {
  it('should increment noEnCount and skip DeepL when no English definition in cache', async () => {
    // Given: 中文 miss、英文也 miss
    mockCache.getChinese.mockReturnValue(null);
    mockCache.get.mockReturnValue(null);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.noEnCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(batchTranslate).not.toHaveBeenCalled();
  });
});

describe('prefetchCefrZhToWordCache — DeepL translation', () => {
  it('should call batchTranslate with English definition for cache misses', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(batchTranslate).toHaveBeenCalledWith(
      expect.arrayContaining(['(verb) to sprint']),
      DEEPL_CONFIG,
    );
  });

  it('should store Chinese translation via setChinese with base (POS-agnostic) key', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(mockCache.setChinese).toHaveBeenCalledWith('run', null, '快速奔跑');
  });

  it('should increment fetchedCount on successful translation', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.fetchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('should increment failedCount when batchTranslate throws', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    (batchTranslate as jest.Mock).mockRejectedValue(new Error('DeepL quota exceeded'));
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setChinese).not.toHaveBeenCalled();
  });
});

describe('prefetchCefrZhToWordCache — flush and counts', () => {
  it('should call flush() exactly once after processing all words', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑', '熊', '去']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });

  it('should return correct counts for mixed results', async () => {
    // Given: run→中文快取命中, bear→翻譯成功, go→無英文定義
    mockCache.getChinese
      .mockReturnValueOnce('快速奔跑')  // run → cached
      .mockReturnValueOnce(null)        // bear → miss
      .mockReturnValueOnce(null);       // go → miss
    mockCache.get
      .mockReturnValueOnce({ def: '(noun) a large mammal', tier: 'cache' }) // bear → has en
      .mockReturnValueOnce(null);                                            // go → no en
    (batchTranslate as jest.Mock).mockResolvedValue(['熊']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then
    expect(result.totalCount).toBe(3);
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.noEnCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });
});
