jest.mock('../../nlp/wordCache');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { syncDefinitionCacheWithCsv } from '../../csv/beginnerDeeplTranslator';
import { getWordCache } from '../../nlp/wordCache';

// ── mock 設定 ─────────────────────────────────────────────────────────────────

const mockSetChinese = jest.fn<void, [string, string | null, string, string]>();
const mockGetChinese = jest.fn<string | null, [string, string | null]>();
const mockFlush      = jest.fn<void, []>();

(getWordCache as jest.Mock).mockReturnValue({
  setChinese: mockSetChinese,
  getChinese: mockGetChinese,
  flush:      mockFlush,
});

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
  jest.clearAllMocks();
  mockGetChinese.mockReturnValue(null);
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

  it('should NOT overwrite non-empty definition_zh', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', pos: 'Verb', defZh: '已有翻譯' }),
    ]);
    // When
    const result = syncDefinitionCacheWithCsv(csvPath);
    // Then
    expect(mockSetChinese).toHaveBeenCalledWith('run', 'Verb', '已有翻譯', 'csv');
    expect(result.savedToCache).toBe(1);
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
