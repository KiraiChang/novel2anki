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
const mockGet        = jest.fn<{ def: string; tier: string } | null, [string, string | null]>();
const mockSetCache   = jest.fn<void, [string, string | null, string, string]>();
const mockFlush      = jest.fn<void, []>();

let mockCacheDir: string;

(getWordCache as jest.Mock).mockImplementation(() => ({
  setChinese: mockSetChinese,
  getChinese: mockGetChinese,
  get:        mockGet,
  setCache:   mockSetCache,
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

const HEADERS_WITH_SRC = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","context_sentence","context_sentence_zh","context_sentence_zh_source","definition_zh","definition_zh_source"';

function makeRowWithSrc(fields: {
  lemma?: string; pos?: string; cefrLevel?: string;
  defEn?: string; sentence?: string; sentenceZh?: string; sentenceZhSrc?: string;
  defZh?: string; defZhSrc?: string;
}): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    fields.lemma        ?? 'word',
    fields.pos          ?? 'Noun',
    fields.cefrLevel    ?? 'B1',
    '1', '100',
    fields.defEn        ?? '',
    fields.sentence     ?? '',
    fields.sentenceZh   ?? '',
    fields.sentenceZhSrc ?? '',
    fields.defZh        ?? '',
    fields.defZhSrc     ?? '',
  ].map(esc).join(',');
}

function writeCsvWithSrc(dir: string, name: string, rows: string[]): string {
  const csvPath = path.join(dir, name);
  fs.writeFileSync(csvPath, [HEADERS_WITH_SRC, ...rows].join('\n'), 'utf-8');
  return csvPath;
}

function readRow(csvPath: string, rowIdx: number): string[] {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  return lines[rowIdx + 1].split(',').map(f => f.replace(/^"|"$/g, ''));
}

function readDefZh(csvPath: string): string[] {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  return lines.slice(1).map(l => l.split(',').map(f => f.replace(/^"|"$/g, ''))[8]);
}

function readDefEn(csvPath: string): string[] {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  return lines.slice(1).map(l => l.split(',').map(f => f.replace(/^"|"$/g, ''))[5]);
}

// ── テスト ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-def-test-'));
  mockCacheDir = tmpDir;
  jest.clearAllMocks();
  mockGetChinese.mockReturnValue(null);
  mockGet.mockReturnValue(null);
  // re-apply implementation after clearAllMocks
  (getWordCache as jest.Mock).mockImplementation(() => ({
    setChinese: mockSetChinese,
    getChinese: mockGetChinese,
    get:        mockGet,
    setCache:   mockSetCache,
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
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Record<string, {zh: string; source: string}>;
    expect(data['dactyl:noun'].zh).toBe('翼龍魔');
    expect(data['dactyl:noun'].source).toBe('csv');
    expect(mockSetChinese).not.toHaveBeenCalled(); // UNKNOWN → no global write
  });

  it('should write CEFR-known word to global only (NOT domain cache)', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'sword', pos: 'Noun', cefrLevel: 'C1', defZh: '劍' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    // CEFR-known → global only
    expect(mockSetChinese).toHaveBeenCalledWith('sword', 'Noun', '劍', 'csv');
    // domain cache should NOT be created / written
    const cacheFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    expect(fs.existsSync(cacheFile)).toBe(false);
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
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as Record<string, {zh: string; source: string}>;
    expect(data['dactyl:noun'].zh).toBe('翼龍魔');
  });

  it('should write UNKNOWN word to both book and domain caches when both specified', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defZh: '翼龍魔' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy', book: 'the-demon-awakens' });

    const bookFile   = path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json');
    const domainFile = path.join(tmpDir, 'domain_fantasy_cache_zh.json');
    const bookData   = JSON.parse(fs.readFileSync(bookFile, 'utf-8'))   as Record<string, {zh: string; source: string}>;
    const domainData = JSON.parse(fs.readFileSync(domainFile, 'utf-8')) as Record<string, {zh: string; source: string}>;
    expect(bookData['dactyl:noun'].zh).toBe('翼龍魔');
    expect(domainData['dactyl:noun'].zh).toBe('翼龍魔');
    expect(mockSetChinese).not.toHaveBeenCalled(); // UNKNOWN → no global write
  });

  it('should write CEFR-known word to global only (NOT book or domain)', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'sword', pos: 'Noun', cefrLevel: 'C1', defZh: '劍' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy', book: 'the-demon-awakens' });

    expect(mockSetChinese).toHaveBeenCalledWith('sword', 'Noun', '劍', 'csv');
    expect(fs.existsSync(path.join(tmpDir, 'book_the-demon-awakens_cache_zh.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'domain_fantasy_cache_zh.json'))).toBe(false);
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

// ── definition_en 雙向同步 ─────────────────────────────────────────────────────

describe('syncDefinitionCacheWithCsv — en cache → CSV (fill definition_en from cache)', () => {
  it('should fill definition_en from global word-cache when empty', () => {
    // Given: wc.get returns an entry for 'run'
    mockGet.mockImplementation((word: string) =>
      word === 'run' ? { def: 'to move fast', tier: 'cache' } : null,
    );
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'A2', defEn: '', defZh: '' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(readDefEn(csvPath)[0]).toBe('to move fast');
    expect(result.filledFromCache).toBe(1);
  });

  it('should fill definition_en from domain en cache (priority over global)', () => {
    // Given: domain en cache has an entry; global also has one
    const enCacheFile = path.join(tmpDir, 'domain_fantasy_cache.json');
    fs.writeFileSync(enCacheFile, JSON.stringify({ 'powrie:noun': { def: 'a foul dwarf', source: 'manual' } }), 'utf-8');
    mockGet.mockReturnValue({ def: 'generic def', tier: 'cache' });

    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'powrie', pos: 'Noun', cefrLevel: 'UNKNOWN', defEn: '', defZh: '' }),
    ]);
    // When
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });
    // Then: domain en cache takes priority
    expect(readDefEn(csvPath)[0]).toBe('a foul dwarf');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('should NOT overwrite existing definition_en in CSV', () => {
    mockGet.mockReturnValue({ def: 'from cache', tier: 'cache' });
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'A2', defEn: 'existing def', defZh: '' }),
    ]);
    const mtimeBefore = fs.statSync(csvPath).mtimeMs;
    // When
    syncDefinitionCacheWithCsv(csvPath);
    const mtimeAfter = fs.statSync(csvPath).mtimeMs;
    // Then: definition_en not overwritten; file only rewritten if zh was filled
    expect(readDefEn(csvPath)[0]).toBe('existing def');
    expect(mtimeAfter).toBe(mtimeBefore); // no change (defZh also empty, no cache hit)
  });
});

describe('syncDefinitionCacheWithCsv — CSV → en cache (write definition_en to cache)', () => {
  it('should write UNKNOWN word definition_en to domain en cache', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defEn: 'a winged lizard', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    const enFile = path.join(tmpDir, 'domain_fantasy_cache.json');
    expect(fs.existsSync(enFile)).toBe(true);
    const data = JSON.parse(fs.readFileSync(enFile, 'utf-8')) as Record<string, {def: string; source: string}>;
    expect(data['dactyl:noun'].def).toBe('a winged lizard');
    expect(data['dactyl:noun'].source).toBe('mw');
  });

  it('should write CEFR-known word definition_en to global cache (setCache)', () => {
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'sword', pos: 'Noun', cefrLevel: 'C1', defEn: 'a weapon with a long blade', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    expect(mockSetCache).toHaveBeenCalledWith('sword', 'Noun', 'a weapon with a long blade', 'csv');
    expect(fs.existsSync(path.join(tmpDir, 'domain_fantasy_cache.json'))).toBe(false);
  });

  it('should NOT overwrite existing domain en cache entry (setEnIfEmpty)', () => {
    const enFile = path.join(tmpDir, 'domain_fantasy_cache.json');
    fs.writeFileSync(enFile, JSON.stringify({ 'dactyl:noun': { def: 'old def', source: 'manual' } }), 'utf-8');

    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'dactyl', pos: 'Noun', cefrLevel: 'UNKNOWN', defEn: 'new def', defZh: '' }),
    ]);
    syncDefinitionCacheWithCsv(csvPath, undefined, { domain: 'fantasy' });

    const data = JSON.parse(fs.readFileSync(enFile, 'utf-8')) as Record<string, {def: string; source: string}>;
    expect(data['dactyl:noun'].def).toBe('old def');
  });
});

// ── source 優先序保護（definition_zh_source 欄） ────────────────────────────────

describe('syncDefinitionCacheWithCsv — source priority protection', () => {
  it('should NOT fill from cache when source is "deepl" (higher priority)', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '', defZhSrc: 'deepl' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then: deepl 優先序 > cache，不覆蓋
    expect(result.noMatch).toBe(1);
    expect(result.filledFromCache).toBe(0);
    const row = readRow(csvPath, 0);
    expect(row[9]).toBe('');      // definition_zh 仍空
    expect(row[10]).toBe('deepl'); // source 未被清除
  });

  it('should NOT fill from cache when source is "azure"', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '', defZhSrc: 'azure' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.noMatch).toBe(1);
    expect(result.filledFromCache).toBe(0);
  });

  it('should NOT fill from cache when source is "csv" (highest priority)', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '', defZhSrc: 'csv' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.noMatch).toBe(1);
  });

  it('should fill from cache when source is "cache" (same level, refresh allowed)', () => {
    // Given
    mockGetChinese.mockReturnValue('新快取翻譯');
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '', defZhSrc: 'cache' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.filledFromCache).toBe(1);
    const row = readRow(csvPath, 0);
    expect(row[9]).toBe('新快取翻譯');
    expect(row[10]).toBe('cache');
  });

  it('should fill from cache when source is empty (no prior translation)', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '', defZhSrc: '' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(result.filledFromCache).toBe(1);
    const row = readRow(csvPath, 0);
    expect(row[9]).toBe('快取翻譯');
    expect(row[10]).toBe('cache');
  });

  it('should write "cache" to definition_zh_source after filling from cache', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '', defZhSrc: '' }),
    ]);
    // When
    syncDefinitionCacheWithCsv(csvPath);
    // Then
    const row = readRow(csvPath, 0);
    expect(row[10]).toBe('cache');
  });

  it('should NOT check source priority for old CSV without source column (backward compat)', () => {
    // Given: 舊格式，無 definition_zh_source 欄
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsv(tmpDir, 'old.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defZh: '' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then: 無 source 欄，照舊補填
    expect(result.filledFromCache).toBe(1);
  });

  it('should count as noMatch (not skippedCache) when source blocks fill, even if defEn is non-empty', () => {
    // Given: defZh 空 + source='deepl'（攔截）+ defEn 有值
    // skippedCache 的語意是「快取已有舊值」，不應把 source 攔截誤計入
    mockGetChinese.mockReturnValue(null);
    mockGet.mockReturnValue({ def: 'to sprint', tier: 'cache' }); // en cache 已有值（不寫入）
    const csvPath = writeCsvWithSrc(tmpDir, 'test.csv', [
      makeRowWithSrc({ lemma: 'run', pos: 'Verb', cefrLevel: 'B1', defEn: '(verb) to run', defZh: '', defZhSrc: 'deepl' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then: source 攔截 + en cache 已有 → 計入 noMatch，不計入 skippedCache
    expect(result.noMatch).toBe(1);
    expect(result.skippedCache).toBe(0);
  });
});
