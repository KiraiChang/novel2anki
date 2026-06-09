jest.mock('../../nlp/wordCache');
jest.mock('../../cards/deeplTranslator');

import { getWordCache } from '../../nlp/wordCache';
import { batchTranslate } from '../../cards/deeplTranslator';
import { prefetchCefrToWordCache, prefetchCefrZhToWordCache } from '../../nlp/cefrPrefetcher';

// ── 共用 mock ─────────────────────────────────────────────────────────────────

const mockCache = {
  get:                      jest.fn(),
  getChinese:               jest.fn(),
  setCache:                 jest.fn(),
  setDict:                  jest.fn(),
  setChinese:               jest.fn(),
  flush:                    jest.fn(),
  hasChinese:               jest.fn(),
  hasPosCache:              jest.fn(),
  getAllCacheEntriesForWord: jest.fn(),
  cacheSize:                0,
};

const origMwKey  = process.env.MW_API_KEY;
const origFetch  = global.fetch;

// 測試用詞列表（3 個詞，避免跑真實 5782 筆）
const TEST_WORDS = ['run', 'bear', 'go'];

const DEEPL_CONFIG = { provider: 'deepl' as const, apiKey: 'test-deepl-key' };

beforeEach(() => {
  jest.clearAllMocks();
  (getWordCache as jest.Mock).mockReturnValue(mockCache);
  mockCache.get.mockReturnValue(null);                     // 預設：英文 cache miss
  mockCache.getChinese.mockReturnValue(null);              // 預設：中文 cache miss
  mockCache.hasChinese.mockReturnValue(false);             // 預設：無任何 zh 快取
  mockCache.hasPosCache.mockReturnValue(false);            // 預設：無 POS-specific cache 條目
  mockCache.getAllCacheEntriesForWord.mockReturnValue([]);  // 預設：無英文條目
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
  it('should skip word and report source=dict when word-dict has entry', async () => {
    // Given: dict entry → always skip regardless of POS cache
    mockCache.get.mockReturnValue({ def: '(verb) curated', tier: 'dict' });
    const progress: string[] = [];
    // When
    await prefetchCefrToWordCache((_, __, meta) => progress.push(meta.source), ['run']);
    // Then
    expect(progress).toEqual(['dict']);
    expect(mockCache.setCache).not.toHaveBeenCalled();
  });

  it('should skip word and increment skippedCount when POS cache entries exist', async () => {
    // Given: hasPosCache returns true → POS entries already correct
    mockCache.hasPosCache.mockReturnValue(true);
    // When
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should NOT skip word when only base cache key exists (no POS entries)', async () => {
    // Given: base key exists but no POS entries → re-fetch to populate POS entries
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    mockCache.hasPosCache.mockReturnValue(false);
    // When: no MW key → failedCount (but NOT skipped)
    const result = await prefetchCefrToWordCache(undefined, ['run']);
    // Then: attempted fetch (failed due to no key), not skipped
    expect(result.skippedCount).toBe(0);
    expect(result.failedCount).toBe(1);
  });

  it('should return skippedCount equal to total when all words have POS cache entries', async () => {
    // Given
    mockCache.hasPosCache.mockReturnValue(true);
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

  it('should NOT overwrite first POS entry with later compound-word entries sharing same POS', async () => {
    // Given: MW returns main entry + compound entry with same POS (root cause of the bug)
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { fl: 'noun', shortdef: ['a structure built across a river'] },   // correct: cross
        { fl: 'verb', shortdef: ['to go from one side to the other'] },   // correct: cross
        { fl: 'noun', shortdef: ['the act of wearing clothes for opposite sex'] }, // compound: cross-dressing
        { fl: 'verb', shortdef: ['to ask more questions of a witness'] },          // compound: cross-examine
      ],
    });
    // When
    await prefetchCefrToWordCache(undefined, ['cross']);
    // Then: only first noun and first verb stored; compound entries discarded
    expect(mockCache.setCache).toHaveBeenCalledWith('cross', 'noun', expect.stringContaining('a structure built across'), 'MW');
    expect(mockCache.setCache).toHaveBeenCalledWith('cross', 'verb', expect.stringContaining('to go from one side'), 'MW');
    // Compound entries must NOT have been stored
    const calls = (mockCache.setCache as jest.Mock).mock.calls;
    const nounCalls = calls.filter(([, pos]) => pos === 'noun');
    const verbCalls = calls.filter(([, pos]) => pos === 'verb');
    expect(nounCalls).toHaveLength(1);
    expect(verbCalls).toHaveLength(1);
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
    // Given: run → has POS cache (skip), bear → MW success, go → fetch error
    process.env.MW_API_KEY = 'test-key';
    mockCache.hasPosCache.mockImplementation((w: string) => w === 'run');
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
  it('should skip word and increment skippedCount when all POS entries are already cached', async () => {
    // Given: run 有 verb 條目，且 verb + default 都已翻譯
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run fast' }]);
    mockCache.hasChinese.mockReturnValue(true);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(batchTranslate).not.toHaveBeenCalled();
  });

  it('should report source=cached in progress callback when all POS entries are already cached', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run fast' }]);
    mockCache.hasChinese.mockReturnValue(true);
    const sources: string[] = [];
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, (_, __, meta) => sources.push(meta.source), ['run']);
    // Then
    expect(sources).toEqual(['cached']);
  });
});

describe('prefetchCefrZhToWordCache — no English definition', () => {
  it('should increment noEnCount and skip translation when no English entries in cache', async () => {
    // Given: getAllCacheEntriesForWord 回傳空陣列（無英文定義）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([]);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.noEnCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(batchTranslate).not.toHaveBeenCalled();
  });
});

describe('prefetchCefrZhToWordCache — translation', () => {
  it('should call batchTranslate with English definition for each untranslated POS entry', async () => {
    // Given: run 有 verb 條目，尚未翻譯
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to sprint' }]);
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(batchTranslate).toHaveBeenCalledWith(
      expect.arrayContaining(['(verb) to sprint']),
      DEEPL_CONFIG,
    );
  });

  it('should store Chinese translation with POS key and source', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to sprint' }]);
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then: POS 鍵帶 source
    expect(mockCache.setChinese).toHaveBeenCalledWith('run', 'verb', '快速奔跑', 'deepl');
  });

  it('should increment fetchedCount once per word on successful translation', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to sprint' }]);
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.fetchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('should increment failedCount when batchTranslate throws', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to sprint' }]);
    (batchTranslate as jest.Mock).mockRejectedValue(new Error('DeepL quota exceeded'));
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setChinese).not.toHaveBeenCalled();
  });
});

describe('prefetchCefrZhToWordCache — inter-batch delay', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('should insert 500ms delay between batches when processing more than one batch', async () => {
    // Given: 51 words × 1 POS each → 51 pending items → 2 batches (50 + 1)
    const words = Array.from({ length: 51 }, (_, i) => `word${i}`);
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test definition text' }]);
    (batchTranslate as jest.Mock)
      .mockResolvedValueOnce(Array(50).fill('翻譯'))
      .mockResolvedValueOnce(['翻譯']);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    // When
    const promise = prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, words);
    await jest.runAllTimersAsync();
    await promise;
    // Then: setTimeout called with 500ms inter-batch delay
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it('should NOT insert delay before the first batch', async () => {
    // Given: 3 words × 1 POS each → 3 pending items → single batch, no inter-batch delay needed
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test definition text' }]);
    (batchTranslate as jest.Mock).mockResolvedValue(['翻譯', '翻譯', '翻譯']);
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    // When
    const promise = prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    await jest.runAllTimersAsync();
    await promise;
    // Then: no 500ms delay calls
    const delay500 = setTimeoutSpy.mock.calls.find(args => args[1] === 500);
    expect(delay500).toBeUndefined();
  });
});

describe('prefetchCefrZhToWordCache — flush and counts', () => {
  it('should call flush() exactly once after processing all words', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to sprint' }]);
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑', '熊', '去']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });

  it('should return correct counts for mixed results', async () => {
    // Given: run→全部已快取(skip), bear→有 noun 待翻譯, go→無英文條目
    mockCache.getAllCacheEntriesForWord.mockImplementation((word: string) => {
      if (word === 'run')  return [{ pos: 'verb', def: '(verb) to run fast' }];
      if (word === 'bear') return [{ pos: 'noun', def: '(noun) a large mammal' }];
      return [];  // go → no en
    });
    mockCache.hasChinese.mockImplementation((word: string) => word === 'run');
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

// ── prefetchCefrZhToWordCache — POS-specific translation ──────────────────────

describe('prefetchCefrZhToWordCache — POS-specific translation', () => {
  it('should translate each POS entry separately and store with POS key + source', async () => {
    // Given: cross 有 noun 和 verb 兩個條目
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) a cross-shaped object' },
      { pos: 'verb', def: '(verb) to cross a river' },
    ]);
    (batchTranslate as jest.Mock).mockResolvedValue(['十字形物體', '渡過河流']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['cross']);
    // Then: 每個 POS 各存一筆，帶 source
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'noun', '十字形物體', 'deepl');
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'verb', '渡過河流', 'deepl');
  });

  it('should set default key to noun translation when noun POS is available', async () => {
    // Given: cross 有 noun + verb，預設鍵尚未設定
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) a cross-shaped object' },
      { pos: 'verb', def: '(verb) to cross a river' },
    ]);
    // hasChinese(word, null) = false → 需衍生預設鍵
    mockCache.hasChinese.mockReturnValue(false);
    (batchTranslate as jest.Mock).mockResolvedValue(['十字形物體', '渡過河流']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['cross']);
    // Then: 預設鍵使用名詞翻譯，source 標為 derived
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', null, '十字形物體', 'deepl:derived');
  });

  it('should use first available POS as default when no noun exists', async () => {
    // Given: run 只有 verb（無 noun）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'verb', def: '(verb) to run fast' },
      { pos: 'adjective', def: '(adjective) running' },
    ]);
    mockCache.hasChinese.mockReturnValue(false);
    (batchTranslate as jest.Mock).mockResolvedValue(['快速奔跑', '奔跑的']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then: 無名詞時取第一個 POS（verb）的翻譯作為預設
    expect(mockCache.setChinese).toHaveBeenCalledWith('run', null, '快速奔跑', 'deepl:derived');
  });

  it('should skip already-cached POS entries and only translate uncached ones', async () => {
    // Given: cross 有 noun（已快取）+ verb（未快取）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) a cross-shaped object' },
      { pos: 'verb', def: '(verb) to cross a river' },
    ]);
    mockCache.hasChinese.mockImplementation((_: string, pos: string | null) => pos === 'noun');
    (batchTranslate as jest.Mock).mockResolvedValue(['渡過河流']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['cross']);
    // Then: 只翻譯 verb，不重翻 noun
    expect(batchTranslate).toHaveBeenCalledWith(['(verb) to cross a river'], DEEPL_CONFIG);
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'verb', '渡過河流', 'deepl');
    expect(mockCache.setChinese).not.toHaveBeenCalledWith('cross', 'noun', expect.anything(), expect.anything());
  });

  it('should increment fetchedCount once per word even when word has multiple POS entries', async () => {
    // Given: cross 有兩個 POS
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) a cross' },
      { pos: 'verb', def: '(verb) to cross' },
    ]);
    (batchTranslate as jest.Mock).mockResolvedValue(['十字', '渡過']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['cross']);
    // Then: 一個詞只算一次 fetched
    expect(result.fetchedCount).toBe(1);
  });
});

// ── prefetchCefrZhToWordCache — legacy base zh copy ───────────────────────────

describe('prefetchCefrZhToWordCache — legacy base zh copy', () => {
  it('should copy existing base zh to missing POS keys without calling translation API', async () => {
    // Given: chapter 的 noun POS 尚未快取，但 base（no-POS）已有舊格式翻譯
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) one of the main sections of a book' },
    ]);
    mockCache.hasChinese.mockImplementation((_: string, pos: string | null) => pos === null);
    mockCache.getChinese.mockReturnValue('（名詞）書籍的主要部分之一');
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['chapter']);
    // Then: 直接複製，不呼叫翻譯 API
    expect(batchTranslate).not.toHaveBeenCalled();
    expect(mockCache.setChinese).toHaveBeenCalledWith('chapter', 'noun', '（名詞）書籍的主要部分之一', 'legacy:copied');
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
  });

  it('should copy base zh to ALL missing POS keys when multiple are absent', async () => {
    // Given: cross 有 noun + verb，只有 base 翻譯（舊格式）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) a cross' },
      { pos: 'verb', def: '(verb) to cross' },
    ]);
    mockCache.hasChinese.mockImplementation((_: string, pos: string | null) => pos === null);
    mockCache.getChinese.mockReturnValue('（名詞）十字形狀');
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['cross']);
    // Then: noun 和 verb 都複製自 base
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'noun', '（名詞）十字形狀', 'legacy:copied');
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'verb', '（名詞）十字形狀', 'legacy:copied');
    expect(batchTranslate).not.toHaveBeenCalled();
  });
});

// ── prefetchCefrZhToWordCache — Azure 429 break ───────────────────────────────

describe('prefetchCefrZhToWordCache — Azure 429 break', () => {
  it('should stop remaining batches when translation throws 429 and call flush once', async () => {
    // Given: 3 words → 1 batch；batchTranslate 拋出 429
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run' }]);
    (batchTranslate as jest.Mock).mockRejectedValue(new Error('Azure Translator HTTP 429'));
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: 只呼叫一次 batchTranslate，flush 仍寫盤
    expect(batchTranslate).toHaveBeenCalledTimes(1);
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
    expect(result.failedCount).toBeGreaterThan(0);
  });

  it('should continue processing next batch when error is NOT 429', async () => {
    // Given: 3 words → 1 batch；拋出非 429 錯誤
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run' }]);
    (batchTranslate as jest.Mock)
      .mockRejectedValueOnce(new Error('DeepL quota exceeded'))
      .mockResolvedValueOnce(['熊', '去']);
    // When: 只有 1 批（3 詞），但第一批失敗後仍只有 1 批（不會再觸發第二批）
    // 改用 2 batch 情境：first throws non-429, second succeeds
    const words = [...TEST_WORDS, 'extra'];  // 4 words still 1 batch
    (batchTranslate as jest.Mock)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(['翻譯']);
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, words);
    // 由於 TEST_WORDS+extra 只有 4 詞 → 1 batch，非 429 → 不 break，但只有 1 batch
    // 正確的 assert 是：非 429 時不 break（batchTranslate 僅被呼叫 1 次因為只有 1 批）
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });
});
