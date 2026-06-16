jest.mock('../../nlp/wordDefDb', () => {
  const mockGet = jest.fn();
  const mockSet = jest.fn();
  return {
    getWordDefDb: jest.fn(() => ({ get: mockGet, set: mockSet })),
    __mockGet: mockGet,
    __mockSet: mockSet,
  };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { syncCsvToWordDefDb, syncWordDefDbToCsv } from '../../csv/wordDefDbSync';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __mockGet, __mockSet } = require('../../nlp/wordDefDb');

const mockGet: jest.Mock = __mockGet;
const mockSet: jest.Mock = __mockSet;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worddefdbsync-test-'));
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── helpers ───────────────────────────────────────────────────────────────────

const HEADERS = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","context_sentence","context_sentence_zh","definition_zh","definition_zh_source","definition_en_source","word_zh","word_zh_source","ai_hint"';

function makeRow(fields: {
  lemma?: string; pos?: string; defEn?: string; defZh?: string; defZhSource?: string;
}): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    esc(fields.lemma       ?? ''),
    esc(fields.pos         ?? ''),
    esc('B1'), esc('10'), esc('100'),
    esc(fields.defEn       ?? ''),
    esc('example sentence'), esc(''),
    esc(fields.defZh       ?? ''),
    esc(fields.defZhSource ?? ''),
    esc(''), esc(''), esc(''), esc(''),
  ].join(',');
}

function writeCsv(filename: string, rows: string[]): string {
  const csvPath = path.join(tmpDir, filename);
  fs.writeFileSync(csvPath, [HEADERS, ...rows].join('\n'), 'utf-8');
  return csvPath;
}

// ── syncCsvToWordDefDb ────────────────────────────────────────────────────────

describe('syncCsvToWordDefDb()', () => {
  it('definition_zh 非空時呼叫 db.set 並傳入 source', () => {
    mockSet.mockReturnValue(true);
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: 'a financial institution', defZh: '銀行', defZhSource: 'deepl' }),
    ]);
    syncCsvToWordDefDb(csvPath);
    expect(mockSet).toHaveBeenCalledWith('bank', 'noun', 'a financial institution', '銀行', 'deepl');
  });

  it('definition_zh 為空時不寫入 SQLite（saved=0, skipped=1）', () => {
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: 'a financial institution', defZh: '' }),
    ]);
    const result = syncCsvToWordDefDb(csvPath);
    expect(mockSet).not.toHaveBeenCalled();
    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('definition_en 為空時跳過', () => {
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: '', defZh: '銀行' }),
    ]);
    const result = syncCsvToWordDefDb(csvPath);
    expect(mockSet).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('db.set 回傳 false（key 已存在）時計入 skipped', () => {
    mockSet.mockReturnValue(false);
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'run', pos: 'verb', defEn: 'to move fast', defZh: '奔跑', defZhSource: 'deepl' }),
    ]);
    const result = syncCsvToWordDefDb(csvPath);
    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('definition_zh_source 欄缺失時傳空字串', () => {
    mockSet.mockReturnValue(true);
    // 使用無 source 欄的 header
    const noSrcHeaders = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","context_sentence","context_sentence_zh","definition_zh"';
    const csvPath = path.join(tmpDir, 'no-src.csv');
    fs.writeFileSync(csvPath, [noSrcHeaders, '"bank","noun","B1","10","100","a financial institution","ex","","銀行"'].join('\n'), 'utf-8');
    syncCsvToWordDefDb(csvPath);
    expect(mockSet).toHaveBeenCalledWith('bank', 'noun', 'a financial institution', '銀行', '');
  });

  it('多 row 各自正確計數', () => {
    mockSet.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank',  pos: 'noun', defEn: 'a financial institution', defZh: '銀行',  defZhSource: 'deepl' }),
      makeRow({ lemma: 'river', pos: 'noun', defEn: 'a large stream',          defZh: '河流',  defZhSource: 'deepl' }),
    ]);
    const result = syncCsvToWordDefDb(csvPath);
    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(1);
  });
});

// ── syncWordDefDbToCsv ────────────────────────────────────────────────────────

describe('syncWordDefDbToCsv()', () => {
  it('definition_zh 空白且 db 有 zh 時補填 zh 與 source', () => {
    mockGet.mockReturnValue({ en: 'a financial institution', zh: '銀行', source: 'deepl' });
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: 'a financial institution', defZh: '', defZhSource: '' }),
    ]);
    const result = syncWordDefDbToCsv(csvPath);
    expect(result.filled).toBe(1);
    const content = fs.readFileSync(csvPath, 'utf-8');
    expect(content).toContain('銀行');
    expect(content).toContain('deepl');
  });

  it('definition_zh 已有值時不覆寫', () => {
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: 'a financial institution', defZh: '銀行' }),
    ]);
    const result = syncWordDefDbToCsv(csvPath);
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.unchanged).toBe(1);
  });

  it('db.get 回傳 null 時計入 noMatch', () => {
    mockGet.mockReturnValue(null);
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'ghost', pos: 'noun', defEn: 'a spirit', defZh: '' }),
    ]);
    const result = syncWordDefDbToCsv(csvPath);
    expect(result.noMatch).toBe(1);
    expect(result.filled).toBe(0);
  });

  it('db.get 回傳 zh 為空時計入 noMatch（不補填）', () => {
    mockGet.mockReturnValue({ en: 'a spirit', zh: '', source: '' });
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'ghost', pos: 'noun', defEn: 'a spirit', defZh: '' }),
    ]);
    const result = syncWordDefDbToCsv(csvPath);
    expect(result.noMatch).toBe(1);
    expect(result.filled).toBe(0);
  });

  it('definition_en 為空的 row 不呼叫 db.get', () => {
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: '', defZh: '' }),
    ]);
    const result = syncWordDefDbToCsv(csvPath);
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.unchanged).toBe(1);
  });

  it('無任何補填時不改寫檔案', () => {
    const csvPath = writeCsv('test.csv', [
      makeRow({ lemma: 'bank', pos: 'noun', defEn: 'a financial institution', defZh: '銀行' }),
    ]);
    const beforeMtime = fs.statSync(csvPath).mtimeMs;
    syncWordDefDbToCsv(csvPath);
    expect(fs.statSync(csvPath).mtimeMs).toBe(beforeMtime);
  });
});
