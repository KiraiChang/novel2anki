jest.mock('../../nlp/wordCache');
jest.mock('../../cards/translator');
jest.mock('../../nlp/nameProtector');

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
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
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
