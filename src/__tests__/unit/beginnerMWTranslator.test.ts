import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('../../nlp/wordCache');

import { getWordCache } from '../../nlp/wordCache';
import { fetchBeginnerWordsMW, updateWordDictFromCsv } from '../../csv/beginnerDeeplTranslator';

// ── 共用 mock 設定 ────────────────────────────────────────────────────────────

const mockCache = {
  get: jest.fn(),
  setCache: jest.fn(),
  setDict: jest.fn(),
  flush: jest.fn(),
  dictSize: 0,
  cacheSize: 0,
};

let tmpDir: string;
const origMwKey = process.env.MW_API_KEY;
const origFetch  = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  (getWordCache as jest.Mock).mockReturnValue(mockCache);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mwtest-'));
  delete process.env.MW_API_KEY;
  global.fetch = jest.fn();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origMwKey === undefined) delete process.env.MW_API_KEY;
  else process.env.MW_API_KEY = origMwKey;
  global.fetch = origFetch;
});

function writeCsv(name: string, lines: string[]): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, lines.join('\n'), 'utf-8');
  return p;
}

// ── updateWordDictFromCsv ─────────────────────────────────────────────────────

describe('updateWordDictFromCsv', () => {
  it('should call setDict for each row with non-empty definition_en', async () => {
    // Given
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,definition_en',
      'run,verb,(verb) to sprint',
      'bear,noun,(noun) a large mammal',
    ]);
    // When
    await updateWordDictFromCsv(csvPath);
    // Then
    expect(mockCache.setDict).toHaveBeenCalledWith('run', 'verb', '(verb) to sprint');
    expect(mockCache.setDict).toHaveBeenCalledWith('bear', 'noun', '(noun) a large mammal');
    expect(mockCache.setDict).toHaveBeenCalledTimes(2);
  });

  it('should skip rows where definition_en is empty', async () => {
    // Given
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,definition_en',
      'run,verb,(verb) to sprint',
      'abandon,verb,',
    ]);
    // When
    const result = await updateWordDictFromCsv(csvPath);
    // Then
    expect(mockCache.setDict).toHaveBeenCalledTimes(1);
    expect(result.updatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('should skip rows with empty lemma', async () => {
    // Given
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,definition_en',
      ',verb,(verb) some def',
      'run,verb,(verb) to sprint',
    ]);
    // When
    const result = await updateWordDictFromCsv(csvPath);
    // Then
    expect(result.updatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('should call flush() exactly once after processing all rows', async () => {
    // Given
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,definition_en',
      'run,verb,(verb) to sprint',
      'bear,noun,(noun) a large mammal',
    ]);
    // When
    await updateWordDictFromCsv(csvPath);
    // Then: flush 在所有 setDict 完成後統一寫盤，而非逐筆寫
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });
});

// ── fetchBeginnerWordsMW ──────────────────────────────────────────────────────

describe('fetchBeginnerWordsMW', () => {
  it('should fill definition_en with cached value and skip MW call when word-cache hit', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,cefr_level,coverage_rank,global_frequency,definition_en,context_sentence,context_sentence_zh,definition_zh',
      'run,verb,B2,1,100,,He runs every day.,,',
    ]);
    // When
    const result = await fetchBeginnerWordsMW(csvPath);
    // Then
    const content = fs.readFileSync(csvPath, 'utf-8');
    expect(content).toContain('(verb) to sprint');
    expect(result.fetchedCount).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fill definition_en with dict value when word-dict hit', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) curated definition', tier: 'dict' });
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,cefr_level,coverage_rank,global_frequency,definition_en,context_sentence,context_sentence_zh,definition_zh',
      'run,verb,B2,1,100,,He runs every day.,,',
    ]);
    // When
    await fetchBeginnerWordsMW(csvPath);
    // Then
    const content = fs.readFileSync(csvPath, 'utf-8');
    expect(content).toContain('(verb) curated definition');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should skip rows where definition_en is already filled', async () => {
    // Given: definition_en 已有值，不應重查
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,cefr_level,coverage_rank,global_frequency,definition_en,context_sentence,context_sentence_zh,definition_zh',
      'run,verb,B2,1,100,(verb) already filled,He runs every day.,,',
    ]);
    // When
    const result = await fetchBeginnerWordsMW(csvPath);
    // Then
    expect(result.fetchedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(mockCache.get).not.toHaveBeenCalled();
  });

  it('should insert definition_en column when old CSV format lacks it', async () => {
    // Given: 舊格式 CSV 無 definition_en 欄
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    const csvPath = writeCsv('old-words.csv', [
      'lemma,pos,cefr_level,coverage_rank,global_frequency,context_sentence,context_sentence_zh,definition_zh',
      'run,verb,B2,1,100,He runs every day.,,',
    ]);
    // When
    await fetchBeginnerWordsMW(csvPath);
    // Then: 欄位已插入，值已填入
    const content = fs.readFileSync(csvPath, 'utf-8');
    expect(content).toContain('definition_en');
    expect(content).toContain('(verb) to sprint');
  });

  it('should call MW API and cache result when cache misses and MW_API_KEY is set', async () => {
    // Given
    mockCache.get.mockReturnValue(null);
    process.env.MW_API_KEY = 'test-key';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ fl: 'verb', shortdef: ['to move swiftly on foot'] }],
    });
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,cefr_level,coverage_rank,global_frequency,definition_en,context_sentence,context_sentence_zh,definition_zh',
      'run,verb,B2,1,100,,He runs every day.,,',
    ]);
    // When
    await fetchBeginnerWordsMW(csvPath);
    // Then: MW 被呼叫，結果被快取
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('run'),
      expect.anything(),
    );
    expect(mockCache.setCache).toHaveBeenCalledWith(
      'run', 'verb', expect.stringContaining('to move swiftly'), 'MW',
    );
  });

  it('should call flush() after processing all rows', async () => {
    // Given
    mockCache.get.mockReturnValue({ def: '(verb) to sprint', tier: 'cache' });
    const csvPath = writeCsv('words.csv', [
      'lemma,pos,cefr_level,coverage_rank,global_frequency,definition_en,context_sentence,context_sentence_zh,definition_zh',
      'run,verb,B2,1,100,,He runs every day.,,',
    ]);
    // When
    await fetchBeginnerWordsMW(csvPath);
    // Then
    expect(mockCache.flush).toHaveBeenCalledTimes(1);
  });
});
