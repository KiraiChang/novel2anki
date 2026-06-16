jest.mock('../../nlp/wordCache');
jest.mock('../../cards/translator');
jest.mock('../../nlp/nameProtector');
jest.mock('../../nlp/wordDefDb', () => {
  const mockSet = jest.fn().mockReturnValue(true);
  return { getWordDefDb: jest.fn(() => ({ set: mockSet })), __mockSet: mockSet };
});

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { translateBeginnerWordsCsv } from '../../csv/beginnerTranslator';
import { getWordCache } from '../../nlp/wordCache';
import { batchTranslate } from '../../cards/translator';
import { buildProperNounSet, protectNames, restoreNames } from '../../nlp/nameProtector';

// ── mock 設定 ─────────────────────────────────────────────────────────────────

const mockWc = {
  get: jest.fn(),
  setCache: jest.fn(),
  setSentenceZh: jest.fn(),
  getWordZh: jest.fn().mockReturnValue(null),
  getWordZhSource: jest.fn().mockReturnValue(null),
  setWordZhIfEmpty: jest.fn().mockReturnValue(true),
  flush: jest.fn(),
};

(getWordCache as jest.Mock).mockReturnValue(mockWc);
(batchTranslate as jest.Mock).mockResolvedValue([]);
(buildProperNounSet as jest.Mock).mockReturnValue(new Set<string>());
(protectNames as jest.Mock).mockImplementation((s: string) => ({ text: s, restoreMap: [] }));
(restoreNames as jest.Mock).mockImplementation((s: string) => s);

// ── 工具函式 ──────────────────────────────────────────────────────────────────

const OLD_HEADERS = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","context_sentence","context_sentence_zh","definition_zh"';
const NEW_HEADERS = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","context_sentence","context_sentence_zh","context_sentence_zh_source","definition_zh","definition_zh_source"';

function writeOldCsv(dir: string, name: string, rows: string[]): string {
  const csvPath = path.join(dir, name);
  fs.writeFileSync(csvPath, [OLD_HEADERS, ...rows].join('\n'), 'utf-8');
  return csvPath;
}

function writeNewCsv(dir: string, name: string, rows: string[]): string {
  const csvPath = path.join(dir, name);
  fs.writeFileSync(csvPath, [NEW_HEADERS, ...rows].join('\n'), 'utf-8');
  return csvPath;
}

const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

function oldRow(lemma: string, pos: string, defEn: string, sentence: string, sentZh: string, defZh: string): string {
  return ['lemma', 'pos', 'B1', '1', '100', defEn, sentence, sentZh, defZh].map(esc).join(',').replace(esc('lemma'), esc(lemma)).replace(esc('pos'), esc(pos));
}

function newRow(lemma: string, pos: string, defEn: string, sentence: string, sentZh: string, sentZhSrc: string, defZh: string, defZhSrc: string): string {
  return [lemma, pos, 'B1', '1', '100', defEn, sentence, sentZh, sentZhSrc, defZh, defZhSrc].map(esc).join(',');
}

function readCsvRows(csvPath: string): string[][] {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  const headers = lines[0].split(',').map(f => f.replace(/^"|"$/g, ''));
  return lines.slice(1).map(l => l.split(',').map(f => f.replace(/^"|"$/g, '')));
}

function readHeaders(csvPath: string): string[] {
  const first = fs.readFileSync(csvPath, 'utf-8').trim().split('\n')[0];
  return first.split(',').map(f => f.replace(/^"|"$/g, ''));
}

const CONFIG = { provider: 'deepl' as const, apiKey: 'test' };

// ── テスト ────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trans-src-test-'));
  jest.clearAllMocks();
  (getWordCache as jest.Mock).mockReturnValue(mockWc);
  (buildProperNounSet as jest.Mock).mockReturnValue(new Set<string>());
  (protectNames as jest.Mock).mockImplementation((s: string) => ({ text: s, restoreMap: [] }));
  (restoreNames as jest.Mock).mockImplementation((s: string) => s);
  mockWc.get.mockReturnValue(null);
  mockWc.getWordZh.mockReturnValue(null);
  mockWc.getWordZhSource.mockReturnValue(null);
  mockWc.setWordZhIfEmpty.mockReturnValue(true);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

// ── source 欄自動插入（舊格式 CSV） ───────────────────────────────────────────

describe('translateBeginnerWordsCsv — source column auto-insert', () => {
  it('should insert definition_zh_source and context_sentence_zh_source when missing', async () => {
    // Given: 舊格式 CSV（無 source 欄）
    (batchTranslate as jest.Mock).mockResolvedValue(['定義', '例句中文']);
    const csvPath = writeOldCsv(tmpDir, 'words.csv', [
      oldRow('run', 'Verb', '(verb) to sprint', 'He runs.', '', ''),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    // Then: source 欄已被插入
    const headers = readHeaders(csvPath);
    expect(headers).toContain('definition_zh_source');
    expect(headers).toContain('context_sentence_zh_source');
  });

  it('should NOT duplicate source columns when CSV already has them', async () => {
    // Given: 新格式 CSV（有 source 欄）
    (batchTranslate as jest.Mock).mockResolvedValue(['定義', '例句中文']);
    const csvPath = writeNewCsv(tmpDir, 'words.csv', [
      newRow('run', 'Verb', '(verb) to sprint', 'He runs.', '', '', '', ''),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    // Then: 不重複插入
    const headers = readHeaders(csvPath);
    const defSrcCount = headers.filter(h => h === 'definition_zh_source').length;
    const sentSrcCount = headers.filter(h => h === 'context_sentence_zh_source').length;
    expect(defSrcCount).toBe(1);
    expect(sentSrcCount).toBe(1);
  });
});

// ── source 欄寫入（翻譯後） ────────────────────────────────────────────────────

describe('translateBeginnerWordsCsv — source written after translation', () => {
  it('should write provider name to definition_zh_source after translation', async () => {
    // Given
    (batchTranslate as jest.Mock).mockResolvedValue(['定義中文', '例句中文']);
    const csvPath = writeNewCsv(tmpDir, 'words.csv', [
      newRow('run', 'Verb', '(verb) to sprint', 'He runs.', '', '', '', ''),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    // Then
    const rows = readCsvRows(csvPath);
    const headers = readHeaders(csvPath);
    const defSrcIdx = headers.indexOf('definition_zh_source');
    expect(rows[0][defSrcIdx]).toBe('deepl');
  });

  it('should write provider name to context_sentence_zh_source after translation', async () => {
    // Given
    (batchTranslate as jest.Mock).mockResolvedValue(['定義中文', '例句中文']);
    const csvPath = writeNewCsv(tmpDir, 'words.csv', [
      newRow('run', 'Verb', '(verb) to sprint', 'He runs.', '', '', '', ''),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    // Then
    const rows = readCsvRows(csvPath);
    const headers = readHeaders(csvPath);
    const sentSrcIdx = headers.indexOf('context_sentence_zh_source');
    expect(rows[0][sentSrcIdx]).toBe('deepl');
  });

  it('should write "azure" as source when provider is azure', async () => {
    // Given
    (batchTranslate as jest.Mock).mockResolvedValue(['定義中文', '例句中文']);
    const csvPath = writeNewCsv(tmpDir, 'words.csv', [
      newRow('run', 'Verb', '(verb) to sprint', 'He runs.', '', '', '', ''),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, { provider: 'azure', apiKey: 'test', region: 'eastasia' });
    // Then
    const rows = readCsvRows(csvPath);
    const headers = readHeaders(csvPath);
    const defSrcIdx = headers.indexOf('definition_zh_source');
    expect(rows[0][defSrcIdx]).toBe('azure');
  });

  it('should NOT overwrite existing definition_zh when not force mode', async () => {
    // Given: definition_zh 已有值，不翻譯此行
    const csvPath = writeNewCsv(tmpDir, 'words.csv', [
      newRow('run', 'Verb', '(verb) to sprint', 'He runs.', '他跑。', 'deepl', '奔跑', 'deepl'),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    // Then: 已完整翻譯，跳過（translatedCount = 0）
    const rows = readCsvRows(csvPath);
    const headers = readHeaders(csvPath);
    const defZhIdx = headers.indexOf('definition_zh');
    const defSrcIdx = headers.indexOf('definition_zh_source');
    expect(rows[0][defZhIdx]).toBe('奔跑');
    expect(rows[0][defSrcIdx]).toBe('deepl'); // source 不被清除
  });

  it('should write source even when using old CSV format (auto-inserted columns)', async () => {
    // Given: 舊格式
    (batchTranslate as jest.Mock).mockResolvedValue(['定義中文', '例句中文']);
    const csvPath = writeOldCsv(tmpDir, 'words.csv', [
      oldRow('run', 'Verb', '(verb) to sprint', 'He runs.', '', ''),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    // Then
    const headers = readHeaders(csvPath);
    const rows = readCsvRows(csvPath);
    const defSrcIdx = headers.indexOf('definition_zh_source');
    const sentSrcIdx = headers.indexOf('context_sentence_zh_source');
    expect(rows[0][defSrcIdx]).toBe('deepl');
    expect(rows[0][sentSrcIdx]).toBe('deepl');
  });
});

// ── word-def.db 同步 ─────────────────────────────────────────────────────────

// 完整 14 欄標頭（含 word_zh / word_zh_source），與 beginnerExporter 保持一致
const FULL_HEADERS = '"lemma","pos","cefr_level","coverage_rank","global_frequency","definition_en","definition_en_source","context_sentence","context_sentence_zh","context_sentence_zh_source","definition_zh","definition_zh_source","word_zh","word_zh_source"';

function fullRow(fields: {
  lemma: string; pos: string; defEn?: string; defEnSrc?: string;
  sentence?: string; sentZh?: string; sentZhSrc?: string;
  defZh?: string; defZhSrc?: string; wordZh?: string; wordZhSrc?: string;
}): string {
  return [
    fields.lemma, fields.pos, 'B1', '1', '100',
    fields.defEn ?? '', fields.defEnSrc ?? '',
    fields.sentence ?? '', fields.sentZh ?? '', fields.sentZhSrc ?? '',
    fields.defZh ?? '', fields.defZhSrc ?? '',
    fields.wordZh ?? '', fields.wordZhSrc ?? '',
  ].map(v => `"${v.replace(/"/g, '""')}"`).join(',');
}

function writeFullCsv(dir: string, name: string, rows: string[]): string {
  const csvPath = path.join(dir, name);
  fs.writeFileSync(csvPath, [FULL_HEADERS, ...rows].join('\n'), 'utf-8');
  return csvPath;
}

describe('translateBeginnerWordsCsv — word-def.db sync', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { __mockSet } = require('../../nlp/wordDefDb');
  const mockWordDefSet: jest.Mock = __mockSet;

  beforeEach(() => mockWordDefSet.mockClear());

  it('翻譯完成後 db.set 以 lemma/pos/defEn/defZh/source 被呼叫', async () => {
    // Phase 2（def + sent）= 2 筆；Phase 2.5（word_zh）= 1 筆
    (batchTranslate as jest.Mock)
      .mockResolvedValueOnce(['中文定義', '例句中文'])
      .mockResolvedValueOnce(['銀行']);
    const csvPath = writeFullCsv(tmpDir, 'words.csv', [
      fullRow({ lemma: 'bank', pos: 'Noun', defEn: 'a financial institution', sentence: 'She went to the bank.' }),
    ]);
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    expect(mockWordDefSet).toHaveBeenCalledWith(
      'bank', 'Noun', 'a financial institution', '中文定義', 'deepl',
    );
  });

  it('Phase 1 無字典結果退回 fallback（單詞本身）時，不呼叫 db.set', async () => {
    // mock fetch 失敗封鎖 Free Dictionary → fallback: def = 'ghost'（單詞本身）
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network error'));
    (batchTranslate as jest.Mock)
      .mockResolvedValueOnce(['中文定義', '例句中文'])
      .mockResolvedValueOnce(['鬼魂']);
    const csvPath = writeFullCsv(tmpDir, 'words.csv', [
      fullRow({ lemma: 'ghost', pos: 'Noun', defEn: '', sentence: 'The ghost appeared.' }),
    ]);
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    expect(mockWordDefSet).not.toHaveBeenCalled();
  });

  it('翻譯結果 definition_zh 為空字串時不呼叫 db.set', async () => {
    // Phase 2：defZh = '' → db.set 不應被呼叫
    (batchTranslate as jest.Mock)
      .mockResolvedValueOnce(['', '例句中文'])
      .mockResolvedValueOnce(['奔跑']);
    const csvPath = writeFullCsv(tmpDir, 'words.csv', [
      fullRow({ lemma: 'run', pos: 'Verb', defEn: 'to move fast', sentence: 'He runs fast.' }),
    ]);
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    expect(mockWordDefSet).not.toHaveBeenCalled();
  });

  it('CSV 四欄皆已填入時跳過翻譯，不呼叫 db.set', async () => {
    (batchTranslate as jest.Mock).mockResolvedValue([]);
    const csvPath = writeFullCsv(tmpDir, 'words.csv', [
      fullRow({
        lemma: 'run', pos: 'Verb',
        defEn: 'to move fast', defEnSrc: 'mw',
        sentence: 'He runs fast.', sentZh: '他快速跑。', sentZhSrc: 'deepl',
        defZh: '奔跑', defZhSrc: 'deepl',
        wordZh: '跑', wordZhSrc: 'deepl',
      }),
    ]);
    await translateBeginnerWordsCsv(csvPath, CONFIG);
    expect(mockWordDefSet).not.toHaveBeenCalled();
  });
});

// ── force 模式下 source 更新 ──────────────────────────────────────────────────

describe('translateBeginnerWordsCsv — force mode source update', () => {
  it('should overwrite source when force mode and row already has translation', async () => {
    // Given: 已有 cache 翻譯，force 模式重新翻譯
    (batchTranslate as jest.Mock).mockResolvedValue(['新定義', '新例句']);
    const csvPath = writeNewCsv(tmpDir, 'words.csv', [
      newRow('run', 'Verb', '(verb) to sprint', 'He runs.', '舊例句', 'cache', '舊定義', 'cache'),
    ]);
    // When
    await translateBeginnerWordsCsv(csvPath, CONFIG, undefined, { force: true });
    // Then: source 更新為 deepl
    const rows = readCsvRows(csvPath);
    const headers = readHeaders(csvPath);
    const defSrcIdx = headers.indexOf('definition_zh_source');
    const sentSrcIdx = headers.indexOf('context_sentence_zh_source');
    expect(rows[0][defSrcIdx]).toBe('deepl');
    expect(rows[0][sentSrcIdx]).toBe('deepl');
  });
});
