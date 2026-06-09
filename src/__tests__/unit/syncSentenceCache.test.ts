jest.mock('../../nlp/wordCache');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { syncSentenceCacheWithCsv } from '../../csv/beginnerDeeplTranslator';
import { getWordCache } from '../../nlp/wordCache';

// ── mock 設定 ─────────────────────────────────────────────────────────────────

const mockSetSentenceZh = jest.fn<void, [string, string]>();
const mockGetSentenceZh = jest.fn<string | null, [string]>();
const mockFlush         = jest.fn<void, []>();

(getWordCache as jest.Mock).mockReturnValue({
  setSentenceZh: mockSetSentenceZh,
  getSentenceZh: mockGetSentenceZh,
  flush:         mockFlush,
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

function readCsv(csvPath: string): string[][] {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  return lines.slice(1).map(l => l.split(',').map(f => f.replace(/^"|"$/g, '')));
}

// ── テスト ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-sent-test-'));
  jest.clearAllMocks();
  mockGetSentenceZh.mockReturnValue(null);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── syncSentenceCacheWithCsv ──────────────────────────────────────────────────

describe('syncSentenceCacheWithCsv — CSV → cache (non-empty sentenceZh)', () => {
  it('should call setSentenceZh for rows with non-empty context_sentence_zh', () => {
    // Given
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: 'He ran fast.', sentenceZh: '他跑得很快。' }),
      makeRow({ sentence: 'She walked.',  sentenceZh: '她走路。' }),
    ]);
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then
    expect(mockSetSentenceZh).toHaveBeenCalledTimes(2);
    expect(mockSetSentenceZh).toHaveBeenCalledWith('He ran fast.', '他跑得很快。');
    expect(mockSetSentenceZh).toHaveBeenCalledWith('She walked.',  '她走路。');
    expect(result.savedToCache).toBe(2);
    expect(result.filledFromCache).toBe(0);
  });

  it('should call flush after processing', () => {
    // Given
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: 'He ran fast.', sentenceZh: '他跑得很快。' }),
    ]);
    // When
    syncSentenceCacheWithCsv(csvPath);
    // Then
    expect(mockFlush).toHaveBeenCalledTimes(1);
  });
});

describe('syncSentenceCacheWithCsv — cache → CSV (empty sentenceZh + cache hit)', () => {
  it('should fill context_sentence_zh from cache when empty', () => {
    // Given
    mockGetSentenceZh.mockImplementation((en: string) =>
      en === 'He ran fast.' ? '他跑得很快。' : null,
    );
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ lemma: 'run', sentence: 'He ran fast.', sentenceZh: '' }),
    ]);
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then: CSV updated with filled value
    expect(result.filledFromCache).toBe(1);
    expect(result.savedToCache).toBe(0);
    const rows = readCsv(csvPath);
    expect(rows[0][7]).toBe('他跑得很快。'); // index 7 = context_sentence_zh
  });

  it('should NOT overwrite non-empty context_sentence_zh', () => {
    // Given: row already has sentenceZh
    mockGetSentenceZh.mockReturnValue('快取翻譯');
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: 'He ran fast.', sentenceZh: '已有翻譯' }),
    ]);
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then: existing value preserved, saved to cache
    expect(mockSetSentenceZh).toHaveBeenCalledWith('He ran fast.', '已有翻譯');
    expect(result.savedToCache).toBe(1);
    expect(result.filledFromCache).toBe(0);
  });

  it('should count as noMatch when cache returns null for empty row', () => {
    // Given: cache miss
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: 'Unknown sentence.', sentenceZh: '' }),
    ]);
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then
    expect(result.noMatch).toBe(1);
    expect(result.filledFromCache).toBe(0);
  });
});

describe('syncSentenceCacheWithCsv — mixed rows', () => {
  it('should handle CSV with both filled and empty sentenceZh rows', () => {
    // Given: row1 has translation (→ cache), row2 gets filled from cache, row3 no match
    mockGetSentenceZh.mockImplementation((en: string) =>
      en === 'She walked.' ? '她走路。' : null,
    );
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: 'He ran fast.', sentenceZh: '他跑得很快。' }), // → cache
      makeRow({ sentence: 'She walked.',  sentenceZh: '' }),              // cache → CSV
      makeRow({ sentence: 'They slept.',  sentenceZh: '' }),              // no match
    ]);
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then
    expect(result.savedToCache).toBe(1);
    expect(result.filledFromCache).toBe(1);
    expect(result.noMatch).toBe(1);
    expect(mockSetSentenceZh).toHaveBeenCalledWith('He ran fast.', '他跑得很快。');
  });

  it('should NOT write CSV when no rows were filled from cache', () => {
    // Given: all rows have existing sentenceZh (no CSV modification needed)
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: 'He ran.', sentenceZh: '他跑。' }),
    ]);
    const mtimeBefore = fs.statSync(csvPath).mtimeMs;
    // When
    syncSentenceCacheWithCsv(csvPath);
    const mtimeAfter = fs.statSync(csvPath).mtimeMs;
    // Then: file not rewritten (mtime unchanged)
    expect(mtimeAfter).toBe(mtimeBefore);
  });
});

describe('syncSentenceCacheWithCsv — edge cases', () => {
  it('should return zero counts for empty CSV (header only)', () => {
    // Given
    const csvPath = path.join(tmpDir, 'empty.csv');
    fs.writeFileSync(csvPath, HEADERS, 'utf-8');
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then
    expect(result.savedToCache).toBe(0);
    expect(result.filledFromCache).toBe(0);
    expect(result.noMatch).toBe(0);
  });

  it('should count as noMatch when context_sentence is empty', () => {
    // Given
    const csvPath = writeCsv(tmpDir, 'test.csv', [
      makeRow({ sentence: '', sentenceZh: '' }),
    ]);
    // When
    const result = syncSentenceCacheWithCsv(csvPath);
    // Then
    expect(result.noMatch).toBe(1);
    expect(mockSetSentenceZh).not.toHaveBeenCalled();
    expect(mockGetSentenceZh).not.toHaveBeenCalled();
  });
});
