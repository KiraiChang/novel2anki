// 只 mock getWordCache，讓 DefinitionLayerCache 使用真實實作（讀寫測試暫存檔）
jest.mock('../../nlp/wordCache', () => {
  const actual = jest.requireActual<typeof import('../../nlp/wordCache')>('../../nlp/wordCache');
  return { ...actual, getWordCache: jest.fn() };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { syncDefinitionCacheWithCsv } from '../../csv/beginnerTranslator';
import { getWordCache } from '../../nlp/wordCache';

// ── mock 設定 ─────────────────────────────────────────────────────────────────

const mockSetChinese = jest.fn<void, [string, string | null, string, string]>();
const mockGetChinese = jest.fn<string | null, [string, string | null]>();
const mockFlush      = jest.fn<void, []>();

let mockCacheDir: string;

(getWordCache as jest.Mock).mockImplementation(() => ({
  setChinese: mockSetChinese,
  getChinese: mockGetChinese,
  flush:      mockFlush,
  get cacheDir() { return mockCacheDir; },
}));

// ── 工具函式 ──────────────────────────────────────────────────────────────────

const HEADERS = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","context_sentence","context_sentence_zh","definition_zh"';

function makeRow(fields: {
  lemma?: string; pos?: string; cefrLevel?: string; rank?: string; freq?: string;
  defEn?: string; sentence?: string; sentenceZh?: string; defZh?: string;
}): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    fields.lemma      ?? 'word',
    fields.pos        ?? 'Noun',
    fields.cefrLevel  ?? 'B1',
    fields.rank       ?? '1',
    fields.freq       ?? '100',
    fields.defEn      ?? '',
    fields.sentence   ?? '',
    fields.sentenceZh ?? '',
    fields.defZh      ?? '',
  ].map(esc).join(',');
}

function writeCsv(dir: string, name: string, rows: string[]): string {
  const csvPath = path.join(dir, name);
  fs.writeFileSync(csvPath, [HEADERS, ...rows].join('\n'), 'utf-8');
  return csvPath;
}

function readDefZh(csvPath: string): string[] {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  return lines.slice(1).map(l => l.split(',').map(f => f.replace(/^"|"$/g, ''))[8]);
}

// ── テスト ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-def-test-'));
  mockCacheDir = tmpDir;
  jest.clearAllMocks();
  mockGetChinese.mockReturnValue(null);
  // re-apply implementation after clearAllMocks
  (getWordCache as jest.Mock).mockImplementation(() => ({
    setChinese: mockSetChinese,
    getChinese: mockGetChinese,
    flush:      mockFlush,
    get cacheDir() { return mockCacheDir; },
  }));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── syncDefinitionCacheWithCsv ────────────────────────────────────────────────

describe('syncDefinitionCacheWithCsv — CSV → cache (non-empty definition_zh)', () => {
  it('should call setChinese for rows with non-empty definition_zh', () => {
    // Given
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run',  pos: 'Verb', defZh: '奔跑' }),
      makeRow({ lemma: 'book', pos: 'Noun', defZh: '書籍' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(mockSetChinese).toHaveBeenCalledTimes(2);
    expect(mockSetChinese).toHaveBeenCalledWith('run',  'Verb', '奔跑', 'csv');
    expect(mockSetChinese).toHaveBeenCalledWith('book', 'Noun', '書籍', 'csv');
    expect(result.savedToCache).toBe(2);
    expect(result.filledFromCache).toBe(0);
  });

  it('should call flush after processing', () => {
    // Given
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', defZh: '奔跑' }),
    ]);
    // When
    syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});

describe('syncDefinitionCacheWithCsv — cache → CSV (empty definition_zh + cache hit)', () => {
  it('should fill definition_zh from cache when empty', () => {
    // Given
    mockGetChinese.mockImplementation((word: string) =>
      word === 'run' ? '奔跑' : null,
    );
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', defZh: '' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.filledFromCache).toBe(1);
    expect(result.savedToCache).toBe(0);
    const defZhValues = readDefZh(csvPath);
    expect(defZhValues[0]).toBe('奔跑');
  });

  it('should NOT overwrite cache when cache already has a value for the word', () => {
    // Given: row has definition_zh AND cache already has a value → skip, do not overwrite
    mockGetChinese.mockReturnValue('快取已有翻譯');
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', defZh: '已有翻譯' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then: setChinese not called; skippedCache incremented
    expect(mockSetChinese).not.toHaveBeenCalled();
    expect(result.savedToCache).toBe(0);
    expect(result.skippedCache).toBe(1);
    expect(result.filledFromCache).toBe(0);
  });

  it('should pass pos to getChinese for POS-aware lookup', () => {
    // Given
    mockGetChinese.mockReturnValue('測試');
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'fast', pos: 'Adjective', defZh: '' }),
    ]);
    // When
    syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(mockGetChinese).toHaveBeenCalledWith('fast', 'Adjective');
  });

  it('should count as noMatch when cache returns null for empty row', () => {
    // Given: cache miss
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'unknown', pos: 'Noun', defZh: '' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.noMatch).toBe(1);
    expect(result.filledFromCache).toBe(0);
  });
});

describe('syncDefinitionCacheWithCsv — mixed rows', () => {
  it('should handle CSV with both filled and empty definition_zh rows', () => {
    // Given
    mockGetChinese.mockImplementation((word: string) =>
      word === 'book' ? '書籍' : null,
    );
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run',     pos: 'Verb', defZh: '奔跑' }),   // → cache
      makeRow({ lemma: 'book',    pos: 'Noun', defZh: '' }),        // cache → CSV
      makeRow({ lemma: 'mystery', pos: 'Noun', defZh: '' }),        // no match
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.savedToCache).toBe(1);
    expect(result.filledFromCache).toBe(1);
    expect(result.noMatch).toBe(1);
    expect(mockSetChinese).toHaveBeenCalledWith('run', 'Verb', '奔跑', 'csv');
  });

  it('should NOT write CSV when no rows were filled from cache', () => {
    // Given: all rows have existing definition_zh
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', defZh: '奔跑' }),
    ]);
    const mtimeBefore = fs.statSync(csvPath).mtimeMs;
    // When
    syncDefinitionCacheWithCsv(csvPath);
    const mtimeAfter = fs.statSync(csvPath).mtimeMs;
    // Then: file not rewritten
    expect(mtimeAfter).toBe(mtimeBefore);
  });
});

describe('syncDefinitionCacheWithCsv — edge cases', () => {
  it('should return zero counts for empty CSV (header only)', () => {
    // Given
    const csvPath = path.join(tmpDir, 'empty.csv');
    fs.writeFileSync(csvPath, HEADERS, 'utf-8');
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.savedToCache).toBe(0);
    expect(result.filledFromCache).toBe(0);
    expect(result.noMatch).toBe(0);
  });

  it('should count as noMatch when lemma is empty', () => {
    // Given
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: '', pos: 'Noun', defZh: '' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.noMatch).toBe(1);
    expect(mockSetChinese).not.toHaveBeenCalled();
    expect(mockGetChinese).not.toHaveBeenCalled();
  });
});

// ── CEFR filter（global 寫入限制） ────────────────────────────────────────────

describe('syncDefinitionCacheWithCsv — CEFR filter on global write-back', () => {
  it('should write to global cache when CEFR level is known', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '奔跑' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath);
    expect(mockSetChinese).toHaveBeenCalledWith('run', 'Verb', '奔跑', 'csv');
  });

  it('should NOT write to global cache when CEFR level is UNKNOWN', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defZh: '翼龍魔' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath);
    expect(mockSetChinese).not.toHaveBeenCalled();
  });

  it('should NOT write to global cache when CEFR level is empty', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: '', defZh: '翼龍魔' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath);
    expect(mockSetChinese).not.toHaveBeenCalled();
  });

  it('should count UNKNOWN-only rows as skippedCache when no layer caches', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defZh: '翼龍魔' }),
    ]);
    const result = syncDefinitionCacheWithCsv(csvPath);
    expect(result.skippedCache).toBe(1);
    expect(result.savedToCache).toBe(0);
  });
});

// ── domain / book 分層快取 ────────────────────────────────────────────────────

describe('syncDefinitionCacheWithCsv — domain cache write-back', () => {
  it('should write UNKNOWN word to domain cache (no CEFR restriction)', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defZh: '翼龍魔' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    const cacheFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    expect(fs.existsSync(cacheFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Record<string, string>;
    expect(data['dactyl:noun']).toBe('翼龍魔');
    expect(mockSetChinese).not.toHaveBeenCalled(); // UNKNOWN → no global write
  });

  it('should write CEFR-known word to both domain cache and global cache', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'sword', pos: 'Noun', cefrLevel: 'C1', defZh: '劍' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    const cacheFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Record<string, string>;
    expect(data['sword:noun']).toBe('劍');
    expect(mockSetChinese).toHaveBeenCalledWith('sword', 'Noun', '劍', 'csv');
  });

  it('should NOT overwrite existing domain cache entry (setIfEmpty)', () => {
    const cacheFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    fs.writeFileSync(cacheFile, JSON.stringify({ 'dactyl:noun': '舊翻譯' }), 'utf-8');

    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defZh: '新翻譯' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Record<string, string>;
    expect(data['dactyl:noun']).toBe('舊翻譯');
  });
});

describe('syncDefinitionCacheWithCsv — book cache write-back', () => {
  it('should write to book cache using correct filename', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defZh: '翼龍魔' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { book: 'the-demon-awakens' });

    const cacheFile = path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json');
    expect(fs.existsSync(cacheFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Record<string, string>;
    expect(data['dactyl:noun']).toBe('翼龍魔');
  });

  it('should write to both book and domain caches when both specified', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'goblin', pos: 'Noun', cefrLevel: 'A2', defZh: '哥布林' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy', book: 'the-demon-awakens' });

    const bookFile   = path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json');
    const domainFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    const bookData   = JSON.parse(fs.readFileSync(bookFile, 'utf-8'))   as Record<string, string>;
    const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf-8')) as Record<string, string>;
    expect(bookData['goblin:noun']).toBe('哥布林');
    expect(domainData['goblin:noun']).toBe('哥布林');
    expect(mockSetChinese).toHaveBeenCalledWith('goblin', 'Noun', '哥布林', 'csv'); // also global
  });
});

describe('syncDefinitionCacheWithCsv — layered cache read (cache → CSV)', () => {
  it('should fill from book cache first (priority over domain and global)', () => {
    const bookFile   = path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json');
    const domainFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    fs.writeFileSync(bookFile,   JSON.stringify({ 'run:verb': '快跑（書）' }), 'utf-8');
    fs.writeFileSync(domainFile, JSON.stringify({ 'run:verb': '奔跑（域）' }), 'utf-8');
    mockGetChinese.mockReturnValue('奔跑（全局）');

    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'A2', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy', book: 'the-demon-awakens' });

    const filled = readDefZh(csvPath);
    expect(filled[0]).toBe('快跑（書）');
    expect(mockGetChinese).not.toHaveBeenCalled(); // global not consulted
  });

  it('should fall back to domain cache when book cache misses', () => {
    const bookFile   = path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json');
    const domainFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    fs.writeFileSync(bookFile,   JSON.stringify({}), 'utf-8');
    fs.writeFileSync(domainFile, JSON.stringify({ 'run:verb': '奔跑（域）' }), 'utf-8');
    mockGetChinese.mockReturnValue(null);

    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'A2', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy', book: 'the-demon-awakens' });

    expect(readDefZh(csvPath)[0]).toBe('奔跑（域）');
  });

  it('should fall back to global cache when both book and domain miss', () => {
    fs.writeFileSync(path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json'), JSON.stringify({}), 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'domain_fantasy_cache_zh.json'),         JSON.stringify({}), 'utf-8');
    mockGetChinese.mockReturnValue('奔跑（全局）');

    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'A2', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy', book: 'the-demon-awakens' });

    expect(readDefZh(csvPath)[0]).toBe('奔跑（全局）');
    expect(mockGetChinese).toHaveBeenCalledWith('run', 'Verb');
  });

  it('should fill from global directly when no domain/book specified', () => {
    mockGetChinese.mockReturnValue('奔跑');
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'A2', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, {});

    expect(readDefZh(csvPath)[0]).toBe('奔跑');
    expect(mockGetChinese).toHaveBeenCalledWith('run', 'Verb');
  });
});
