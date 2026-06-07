import * as fs from 'fs';
import { DeepLConfig, batchTranslate } from '../cards/deeplTranslator';

const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DEEPL_FREE_LIMIT = 500_000;
const DEEPL_PRO_PRICE_PER_MILLION = 25;
const DEEPL_BATCH_SIZE = 50;

// ── CSV 解析工具 ─────────────────────────────────────────────────────────────

function escapeField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

function splitLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') { current += '""'; i++; }
      else { inQuotes = !inQuotes; current += ch; }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      if (current.length > 0) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// ── 字典 API ─────────────────────────────────────────────────────────────────

interface DictEntry {
  meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }> }>;
}

async function fetchEnglishDefinition(word: string): Promise<string | null> {
  try {
    const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as DictEntry[];
    const meaning = data[0]?.meanings[0];
    if (!meaning) return null;
    const def = meaning.definitions[0]?.definition ?? null;
    return def ? `(${meaning.partOfSpeech}) ${def}` : null;
  } catch {
    return null;
  }
}

// ── 批次翻譯工具 ─────────────────────────────────────────────────────────────

async function batchTranslateChunked(
  texts: string[],
  config: DeepLConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < texts.length; i += DEEPL_BATCH_SIZE) {
    const chunk = texts.slice(i, i + DEEPL_BATCH_SIZE);
    const translated = await batchTranslate(chunk, config);
    results.push(...translated);
    onProgress?.(Math.min(i + DEEPL_BATCH_SIZE, texts.length), texts.length);
  }
  return results;
}

// ── 公開 API ─────────────────────────────────────────────────────────────────

export interface BeginnerTranslateEstimate {
  untranslatedCount: number;
  sentenceChars: number;
  defCharsEstimate: number;
  totalCharsEstimate: number;
}

export function estimateBeginnerTranslate(csvPaths: string[]): BeginnerTranslateEstimate {
  let untranslatedCount = 0;
  let sentenceChars = 0;

  for (const csvPath of csvPaths) {
    let content: string;
    try { content = fs.readFileSync(csvPath, 'utf-8'); } catch { continue; }
    const lines = splitLines(content);
    if (lines.length < 2) continue;

    const headers = parseRow(lines[0]);
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const get = (col: string) => cols[idx[col]] ?? '';
      if (!get('definition_zh').trim()) {
        untranslatedCount++;
        sentenceChars += get('context_sentence').length;
      }
    }
  }

  const defCharsEstimate = untranslatedCount * 100;
  const totalCharsEstimate = sentenceChars + defCharsEstimate;
  return { untranslatedCount, sentenceChars, defCharsEstimate, totalCharsEstimate };
}

export function formatBeginnerTranslateEstimate(est: BeginnerTranslateEstimate): string {
  const { untranslatedCount, sentenceChars, defCharsEstimate, totalCharsEstimate } = est;
  const withinFree = totalCharsEstimate <= DEEPL_FREE_LIMIT;
  const overLimit = Math.max(0, totalCharsEstimate - DEEPL_FREE_LIMIT);
  const costUSD = (overLimit / 1_000_000) * DEEPL_PRO_PRICE_PER_MILLION;

  const sep = '─'.repeat(44);
  const rows = [
    `DeepL 初學者翻譯預估`,
    sep,
    `未翻譯詞彙：  ${untranslatedCount.toLocaleString()} 個`,
    `例句字元：    ${sentenceChars.toLocaleString()} 字元`,
    `定義字元預估：~${defCharsEstimate.toLocaleString()} 字元（每詞平均 100 字元）`,
    `總計預估：    ~${totalCharsEstimate.toLocaleString()} 字元`,
    withinFree
      ? `費用預估：    免費額度內（月用量 ≤ 500,000 字元）`
      : `費用預估：    約 US$${costUSD.toFixed(2)}（超出免費額度 ${overLimit.toLocaleString()} 字元）`,
    sep,
  ];
  return rows.join('\n');
}

export interface TranslateResult {
  translatedCount: number;
  skippedCount: number;
  outputPath: string;
}

export async function translateBeginnerWordsCsv(
  csvPath: string,
  config: DeepLConfig,
  onProgress?: (current: number, total: number, phase: 'dict' | 'deepl' | 'write') => void,
): Promise<TranslateResult> {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { translatedCount: 0, skippedCount: 0, outputPath: csvPath };

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  // 解析所有資料列
  const rows = lines.slice(1).map(l => parseRow(l));

  // 找出需要翻譯的列索引
  const needTranslation = rows
    .map((cols, i) => ({ i, cols }))
    .filter(({ cols }) => !get(cols, 'definition_zh').trim());

  const skippedCount = rows.length - needTranslation.length;
  if (needTranslation.length === 0) {
    return { translatedCount: 0, skippedCount, outputPath: csvPath };
  }

  // Phase 1：抓英文字典定義（並行，失敗則用詞彙本身）
  const lemmas = needTranslation.map(({ cols }) => get(cols, 'lemma'));
  const englishDefs: string[] = [];
  for (let i = 0; i < lemmas.length; i++) {
    onProgress?.(i + 1, lemmas.length, 'dict');
    const def = await fetchEnglishDefinition(lemmas[i]);
    englishDefs.push(def ?? lemmas[i]);
  }

  // Phase 2：DeepL 批次翻譯（定義 + 例句合在一個請求序列）
  const sentences = needTranslation.map(({ cols }) => get(cols, 'context_sentence'));
  const allTexts = [...englishDefs, ...sentences];
  onProgress?.(0, allTexts.length, 'deepl');
  const allTranslated = await batchTranslateChunked(allTexts, config, (done, total) => {
    onProgress?.(done, total, 'deepl');
  });

  const defZh = allTranslated.slice(0, englishDefs.length);
  const sentZh = allTranslated.slice(englishDefs.length);

  // Phase 3：填回資料列
  onProgress?.(0, 1, 'write');
  const defZhColIdx = idx['definition_zh'];
  const sentZhColIdx = idx['context_sentence_zh'];

  needTranslation.forEach(({ i }, j) => {
    while (rows[i].length <= Math.max(defZhColIdx ?? 0, sentZhColIdx ?? 0)) {
      rows[i].push('');
    }
    if (defZhColIdx !== undefined) rows[i][defZhColIdx] = defZh[j] ?? '';
    if (sentZhColIdx !== undefined && !rows[i][sentZhColIdx]?.trim()) {
      rows[i][sentZhColIdx] = sentZh[j] ?? '';
    }
  });

  // 寫回檔案
  const headerLine = headers.map(escapeField).join(',');
  const dataLines = rows.map(cols => cols.map(escapeField).join(','));
  fs.writeFileSync(csvPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
  onProgress?.(1, 1, 'write');

  return { translatedCount: needTranslation.length, skippedCount, outputPath: csvPath };
}
