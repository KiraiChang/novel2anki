jest.mock('../../nlp/wordCache');
jest.mock('../../cards/translator');

import { getWordCache } from '../../nlp/wordCache';
import { batchTranslate } from '../../cards/translator';
import { prefetchCefrToWordCache, prefetchCefrZhToWordCache, prefetchPhrasesToCache } from '../../nlp/cefrPrefetcher';

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
  getPhrase:                jest.fn(),
  setPhrase:                jest.fn(),
  hasPhrase:                jest.fn(),
  getWordZh:                jest.fn().mockReturnValue(null),
  setWordZhIfEmpty:         jest.fn().mockReturnValue(true),
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
  mockCache.hasPhrase.mockReturnValue(false);              // 預設：片語尚未查過
  mockCache.getWordZh.mockReturnValue(null);               // 預設：word_zh cache miss
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

  it('should strip MW em-dash notation before storing definition', async () => {
    // Given — MW shortdef often appends "—often used figuratively" or "—+ at" usage notes
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { fl: 'verb', shortdef: ['to move in a steady and continuous way —often used figuratively'] },
        { fl: 'noun', shortdef: ['to think about something carefully —+ on or about'] },
      ],
    });
    // When
    await prefetchCefrToWordCache(undefined, ['flow']);
    // Then — notation stripped, only the definition content stored
    expect(mockCache.setCache).toHaveBeenCalledWith('flow', 'verb', '(verb) to move in a steady and continuous way', 'MW');
    expect(mockCache.setCache).toHaveBeenCalledWith('flow', 'noun', '(noun) to think about something carefully', 'MW');
  });

  it('should skip a shortdef entry that becomes too short after stripping MW notation', async () => {
    // Given — entire shortdef is a usage note with no definition content before the dash
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        { fl: 'preposition', shortdef: ['—used to indicate the value of something'] }, // starts with dash, < 10 chars after strip
        { fl: 'adjective', shortdef: ['having a value equal to the price or cost of something'] }, // valid fallback
      ],
    });
    // When
    await prefetchCefrToWordCache(undefined, ['worth']);
    // Then — preposition entry dropped, adjective entry stored
    expect(mockCache.setCache).not.toHaveBeenCalledWith('worth', 'preposition', expect.anything(), 'MW');
    expect(mockCache.setCache).toHaveBeenCalledWith('worth', 'adjective', '(adjective) having a value equal to the price or cost of something', 'MW');
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
    // Given: run 有 verb 條目，且 verb + default 都已翻譯；word_zh 也已快取（避免觸發 word_zh 批次）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run fast' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue('跑步');
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
    expect(batchTranslate).not.toHaveBeenCalled();
  });

  it('should report source=cached in progress callback when all POS entries are already cached', async () => {
    // Given: word_zh 也已快取
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run fast' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue('跑步');
    const sources: string[] = [];
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, (_, __, meta) => sources.push(meta.source), ['run']);
    // Then
    expect(sources).toEqual(['cached']);
  });
});

describe('prefetchCefrZhToWordCache — no English definition', () => {
  it('should increment noEnCount and skip definition translation when no English entries in cache', async () => {
    // Given: 無英文定義（定義翻譯跳過），但 word_zh 已快取（避免干擾此測試主旨）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([]);
    mockCache.getWordZh.mockReturnValue('已快取');
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
    // Given: 51 words × 1 POS each → 51 pending items → 2 batches (50 + 1)；word_zh 已快取不觸發第二批次
    const words = Array.from({ length: 51 }, (_, i) => `word${i}`);
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test definition text' }]);
    mockCache.getWordZh.mockReturnValue('已快取');  // 避免 word_zh 批次用盡 Once mock 後 crash
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
    // Given: chapter 的 noun POS 尚未快取，但 base（no-POS）已有舊格式翻譯；word_zh 也已快取
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) one of the main sections of a book' },
    ]);
    mockCache.hasChinese.mockImplementation((_: string, pos: string | null) => pos === null);
    mockCache.getChinese.mockReturnValue('（名詞）書籍的主要部分之一');
    mockCache.getWordZh.mockReturnValue('章節');
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['chapter']);
    // Then: 直接複製，不呼叫翻譯 API
    expect(batchTranslate).not.toHaveBeenCalled();
    expect(mockCache.setChinese).toHaveBeenCalledWith('chapter', 'noun', '（名詞）書籍的主要部分之一', 'legacy:copied');
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
  });

  it('should copy base zh to ALL missing POS keys when multiple are absent', async () => {
    // Given: cross 有 noun + verb，只有 base 翻譯（舊格式）；word_zh 也已快取
    mockCache.getAllCacheEntriesForWord.mockReturnValue([
      { pos: 'noun', def: '(noun) a cross' },
      { pos: 'verb', def: '(verb) to cross' },
    ]);
    mockCache.hasChinese.mockImplementation((_: string, pos: string | null) => pos === null);
    mockCache.getChinese.mockReturnValue('（名詞）十字形狀');
    mockCache.getWordZh.mockReturnValue('十字');
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['cross']);
    // Then: noun 和 verb 都複製自 base
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'noun', '（名詞）十字形狀', 'legacy:copied');
    expect(mockCache.setChinese).toHaveBeenCalledWith('cross', 'verb', '（名詞）十字形狀', 'legacy:copied');
    expect(batchTranslate).not.toHaveBeenCalled();
  });
});

// ── prefetchPhrasesToCache ────────────────────────────────────────────────────

const TEST_PHRASES = ['in terms of', 'for example', 'on the other hand'];

describe('prefetchPhrasesToCache — cache hit', () => {
  it('should skip phrase and report source=cached when already queried', async () => {
    // Given: phrase already in cache (either MW hit or no-def)
    mockCache.hasPhrase.mockReturnValue(true);
    const sources: string[] = [];
    // When
    await prefetchPhrasesToCache((_, __, meta) => sources.push(meta.source), TEST_PHRASES);
    // Then
    expect(sources).toEqual(['cached', 'cached', 'cached']);
    expect(mockCache.setPhrase).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should increment skippedCount for each already-cached phrase', async () => {
    // Given
    mockCache.hasPhrase.mockReturnValue(true);
    // When
    const result = await prefetchPhrasesToCache(undefined, TEST_PHRASES);
    // Then
    expect(result.skippedCount).toBe(3);
    expect(result.fetchedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });
});

describe('prefetchPhrasesToCache — no MW key', () => {
  it('should report source=no-key and increment failedCount when MW_API_KEY is absent', async () => {
    // Given: no MW key set
    const sources: string[] = [];
    // When
    await prefetchPhrasesToCache((_, __, meta) => sources.push(meta.source), ['in terms of']);
    // Then
    expect(sources).toEqual(['no-key']);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('prefetchPhrasesToCache — MW hit', () => {
  it('should call setPhrase with formatted definition and source=MW on success', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'phrase', shortdef: ['used to indicate a comparison or a relationship'] }],
    });
    // When
    await prefetchPhrasesToCache(undefined, ['in terms of']);
    // Then
    expect(mockCache.setPhrase).toHaveBeenCalledWith(
      'in terms of',
      '(phrase) used to indicate a comparison or a relationship',
      'MW',
    );
  });

  it('should report source=MW and increment fetchedCount on MW hit', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'adverb', shortdef: ['as one example among many possibilities'] }],
    });
    const sources: string[] = [];
    // When
    const result = await prefetchPhrasesToCache(
      (_, __, meta) => sources.push(meta.source),
      ['for example'],
    );
    // Then
    expect(sources).toEqual(['MW']);
    expect(result.fetchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  it('should strip MW em-dash notation from phrase definition', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'phrase', shortdef: ['used to show contrast —often used in formal writing'] }],
    });
    // When
    await prefetchPhrasesToCache(undefined, ['on the other hand']);
    // Then
    expect(mockCache.setPhrase).toHaveBeenCalledWith(
      'on the other hand',
      '(phrase) used to show contrast',
      'MW',
    );
  });
});

describe('prefetchPhrasesToCache — MW no result', () => {
  it('should call setPhrase with empty def and source=no-def when MW returns string array', async () => {
    // Given: MW 回傳建議字串陣列表示查無此片語
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ['term', 'terms', 'terminology'],
    });
    // When
    await prefetchPhrasesToCache(undefined, ['in terms of']);
    // Then: no-def 也寫入快取，避免重複查詢
    expect(mockCache.setPhrase).toHaveBeenCalledWith('in terms of', '', 'no-def');
  });

  it('should increment failedCount for no-def result', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ['suggestion'],
    });
    // When
    const result = await prefetchPhrasesToCache(undefined, ['in terms of']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(result.fetchedCount).toBe(0);
  });

  it('should increment failedCount when all shortdef entries are unusable', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'phrase', shortdef: ['see also'] }], // unusable
    });
    // When
    const result = await prefetchPhrasesToCache(undefined, ['in terms of']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setPhrase).toHaveBeenCalledWith('in terms of', '', 'no-def');
  });
});

describe('prefetchPhrasesToCache — MW API failures', () => {
  it('should increment failedCount and not call setPhrase when MW returns non-200', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 429 });
    // When
    const result = await prefetchPhrasesToCache(undefined, ['in terms of']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setPhrase).not.toHaveBeenCalled();
  });

  it('should increment failedCount and not call setPhrase when fetch throws', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
    // When
    const result = await prefetchPhrasesToCache(undefined, ['in terms of']);
    // Then
    expect(result.failedCount).toBe(1);
    expect(mockCache.setPhrase).not.toHaveBeenCalled();
  });
});

describe('prefetchPhrasesToCache — flush and counts', () => {
  it('should call flush() exactly once after processing all phrases', async () => {
    // Given
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'phrase', shortdef: ['used to indicate a comparison'] }],
    });
    // When
    await prefetchPhrasesToCache(undefined, TEST_PHRASES);
    // Then
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });

  it('should return correct totalCount matching input phrases length', async () => {
    // Given: first cached, second MW hit, third no-def
    mockCache.hasPhrase.mockReturnValueOnce(true).mockReturnValue(false);
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ fl: 'adverb', shortdef: ['as one example of many'] }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ['suggestion1', 'suggestion2'],
      });
    // When
    const result = await prefetchPhrasesToCache(undefined, TEST_PHRASES);
    // Then
    expect(result.totalCount).toBe(3);
    expect(result.skippedCount).toBe(1);
    expect(result.fetchedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});

// ── prefetchCefrZhToWordCache — Azure 429 break ───────────────────────────────

describe('prefetchCefrZhToWordCache — Azure 429 break', () => {
  it('should stop remaining batches when translation throws 429 and call flush once', async () => {
    // Given: 3 words → 1 def batch；batchTranslate 拋出 429（word_zh 已快取，不觸發第二批）
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run' }]);
    mockCache.getWordZh.mockReturnValue('已快取');
    (batchTranslate as jest.Mock).mockRejectedValue(new Error('Azure Translator HTTP 429'));
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: 只呼叫一次 batchTranslate，flush 仍寫盤
    expect(batchTranslate).toHaveBeenCalledTimes(1);
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
    expect(result.failedCount).toBeGreaterThan(0);
  });

  it('should continue processing next batch when error is NOT 429', async () => {
    // Given: 4 words → 1 def batch（非 429 錯誤）+ 1 word_zh batch（成功）
    // 只消費剛好 2 個 Once 回應（def 1 個 + word_zh 1 個），避免殘留污染後續測試
    const words = [...TEST_WORDS, 'extra'];  // 4 words
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'verb', def: '(verb) to run' }]);
    (batchTranslate as jest.Mock)
      .mockRejectedValueOnce(new Error('DeepL quota exceeded'))  // def batch 失敗（非 429）
      .mockResolvedValueOnce(['熊', '去', '去', '翻譯']);         // word_zh batch 成功
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, words);
    // Then: 非 429 → 繼續執行 word_zh 批次；flush 仍寫盤
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });
});

// ── prefetchCefrZhToWordCache — word_zh 單字直翻 ─────────────────────────────

describe('prefetchCefrZhToWordCache — word_zh translation', () => {
  it('should call batchTranslate with bare lemma for word_zh when not cached', async () => {
    // Given: 定義已快取（跳過定義翻譯），但 word_zh 未快取
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) to sprint' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['跑']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then: 以 lemma 本身呼叫翻譯
    expect(batchTranslate).toHaveBeenCalledWith(['run'], DEEPL_CONFIG);
  });

  it('should store word_zh via setWordZhIfEmpty with provider source', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) to sprint' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['跑']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then
    expect(mockCache.setWordZhIfEmpty).toHaveBeenCalledWith('run', null, '跑', 'deepl');
  });

  it('should skip word_zh translation when already cached in word-cache-zh.json', async () => {
    // Given: word_zh 已有快取值
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) to sprint' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue('奔跑');
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then: 不呼叫翻譯 API，不寫入快取
    expect(batchTranslate).not.toHaveBeenCalled();
    expect(mockCache.setWordZhIfEmpty).not.toHaveBeenCalled();
  });

  it('should translate word_zh even when no English definition exists', async () => {
    // Given: 無英文定義（定義翻譯跳過），但 word_zh 未快取，仍需直翻 lemma
    mockCache.getAllCacheEntriesForWord.mockReturnValue([]);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['跑']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then: 定義翻譯跳過（noEnCount=1），但 word_zh 仍被翻譯
    expect(result.noEnCount).toBe(1);
    expect(batchTranslate).toHaveBeenCalledWith(['run'], DEEPL_CONFIG);
    expect(mockCache.setWordZhIfEmpty).toHaveBeenCalledWith('run', null, '跑', 'deepl');
  });

  it('should NOT store word_zh when batchTranslate returns empty string', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([]);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['']);
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, ['run']);
    // Then: 空字串不寫入
    expect(mockCache.setWordZhIfEmpty).not.toHaveBeenCalled();
  });

  it('should stop word_zh batches when translation throws 429', async () => {
    // Given: 51 words → 2 word_zh batches；第一批 429 → 停止
    const words = Array.from({ length: 51 }, (_, i) => `word${i}`);
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.hasChinese.mockReturnValue(true);   // 定義已快取，跳過定義翻譯
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockRejectedValue(new Error('DeepL HTTP 429'));
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, words);
    // Then: 只呼叫一次 batchTranslate（第一批 429 → break）
    expect(batchTranslate).toHaveBeenCalledTimes(1);
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });

  it('should fire sentinel progress (done=0, source=word_zh) before batch starts', async () => {
    // Given: 定義已快取，word_zh 未快取
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['跑']);
    const progressCalls: Array<{ done: number; total: number; source: string; word: string }> = [];
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, (done, total, meta) => {
      progressCalls.push({ done, total, source: meta.source, word: meta.word });
    }, ['run']);
    // Then: 第一筆 word_zh 進度為哨兵（done=0, word='', total=1）
    const sentinel = progressCalls.find(p => p.source === 'word_zh' && p.done === 0);
    expect(sentinel).toEqual({ done: 0, total: 1, source: 'word_zh', word: '' });
  });

  it('should fire per-word progress after translating each word in word_zh batch', async () => {
    // Given
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['跑', '熊', '去']);
    const wordZhProgress: Array<{ done: number; word: string }> = [];
    // When
    await prefetchCefrZhToWordCache(DEEPL_CONFIG, (done, _, meta) => {
      if (done > 0 && (meta.source === 'word_zh' || meta.source === 'word_zh:error')) {
        wordZhProgress.push({ done, word: meta.word });
      }
    }, TEST_WORDS);
    // Then: 每個詞依序回報進度（done 遞增，word 為 lemma）
    expect(wordZhProgress).toEqual([
      { done: 1, word: 'run' },
      { done: 2, word: 'bear' },
      { done: 3, word: 'go' },
    ]);
  });

  it('should return wordZhFetched and wordZhPendingCount in result', async () => {
    // Given: run 已有 word_zh 快取，bear 和 go 沒有
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockImplementation((word: string) => word === 'run' ? '跑步' : null);
    (batchTranslate as jest.Mock).mockResolvedValue(['熊', '去']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: 2 詞待翻，2 詞成功翻譯
    expect(result.wordZhPendingCount).toBe(2);
    expect(result.wordZhFetched).toBe(2);
  });
});

// ── prefetchCefrZhToWordCache — missingEnWords / missingZhWords ───────────────

describe('prefetchCefrZhToWordCache — missing words report', () => {
  it('should include words with no EN cache entry in missingEnWords', async () => {
    // Given: run 無 EN 條目；bear 有 EN；go 無 EN
    mockCache.getAllCacheEntriesForWord.mockImplementation((word: string) =>
      word === 'bear' ? [{ pos: 'noun', def: '(noun) large mammal' }] : [],
    );
    mockCache.get.mockReturnValue(null);                     // 所有詞 EN cache miss
    mockCache.getChinese.mockReturnValue(null);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockResolvedValue(['跑', '熊', '去']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: run 和 go 無 EN → 都在 missingEnWords；bear 有 EN cache
    // 注意：get() mock 全回 null，所以三個詞都在 missingEnWords
    expect(result.missingEnWords).toEqual(expect.arrayContaining(['run', 'go']));
    expect(result.missingEnWords).toHaveLength(3);  // 全都 null
  });

  it('should not include words that have EN definition in missingEnWords', async () => {
    // Given: 所有詞都有 EN cache hit
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.get.mockReturnValue({ def: '(noun) test', tier: 'cache' as const });
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getWordZh.mockReturnValue('已快取');
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: 無漏字
    expect(result.missingEnWords).toHaveLength(0);
  });

  it('should include words with no ZH translation in missingZhWords', async () => {
    // Given: 所有詞有 EN 但翻譯失敗（batchTranslate 拋錯），且 getWordZh 也沒有
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.get.mockReturnValue({ def: '(noun) test', tier: 'cache' as const });
    mockCache.getChinese.mockReturnValue(null);
    mockCache.getWordZh.mockReturnValue(null);
    (batchTranslate as jest.Mock).mockRejectedValue(new Error('DeepL quota exceeded'));
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: 翻譯失敗，ZH 仍然缺失
    expect(result.missingZhWords).toEqual(expect.arrayContaining(['run', 'bear', 'go']));
  });

  it('should not include words that have getChinese value in missingZhWords', async () => {
    // Given: 所有詞有 EN 且 getChinese 有值
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.get.mockReturnValue({ def: '(noun) test', tier: 'cache' as const });
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.getChinese.mockReturnValue('已有翻譯');
    mockCache.getWordZh.mockReturnValue(null);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: getChinese 有值 → 不算缺 ZH
    expect(result.missingZhWords).toHaveLength(0);
  });

  it('should not include words that have word_zh value in missingZhWords', async () => {
    // Given: getChinese 無值，但 getWordZh 有值
    mockCache.getAllCacheEntriesForWord.mockReturnValue([]);    // no EN → noEnCount
    mockCache.get.mockReturnValue({ def: '(noun) test', tier: 'cache' as const });
    mockCache.getChinese.mockReturnValue(null);
    mockCache.getWordZh.mockReturnValue('直翻詞');
    (batchTranslate as jest.Mock).mockResolvedValue(['跑', '熊', '去']);
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then: getWordZh 有值 → 不算缺 ZH
    expect(result.missingZhWords).toHaveLength(0);
  });

  it('should return empty arrays when all words have both EN and ZH', async () => {
    // Given: 全部完整
    mockCache.getAllCacheEntriesForWord.mockReturnValue([{ pos: 'noun', def: '(noun) test' }]);
    mockCache.hasChinese.mockReturnValue(true);
    mockCache.get.mockReturnValue({ def: '(noun) test', tier: 'cache' as const });
    mockCache.getChinese.mockReturnValue('繁體中文定義');
    mockCache.getWordZh.mockReturnValue('直翻詞');
    // When
    const result = await prefetchCefrZhToWordCache(DEEPL_CONFIG, undefined, TEST_WORDS);
    // Then
    expect(result.missingEnWords).toHaveLength(0);
    expect(result.missingZhWords).toHaveLength(0);
  });
});
