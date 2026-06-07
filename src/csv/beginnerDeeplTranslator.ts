import * as fs from 'fs';
import { DeepLConfig, batchTranslate } from '../cards/deeplTranslator';

const MW_API   = 'https://www.dictionaryapi.com/api/v3/references/learners/json';
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

// CSV POS → 字典 API 詞性字串（小寫）
function normalizePOS(pos: string): string | null {
  const map: Record<string, string> = {
    noun: 'noun', verb: 'verb', adjective: 'adjective', adverb: 'adverb',
    pronoun: 'pronoun', preposition: 'preposition', conjunction: 'conjunction',
    interjection: 'interjection', gerund: 'verb', participle: 'verb',
  };
  return map[pos.toLowerCase()] ?? null;
}

// ── Merriam-Webster Collegiate API ───────────────────────────────────────────

interface MWEntry {
  fl?: string;        // functional label（詞性），如 "noun" / "verb"
  shortdef?: string[]; // 簡短定義列表
}

// 排除交叉參照類短句（MW shortdef 通常已乾淨，但保留保護）
const isUsableMW = (def: string) =>
  def.length >= 10 && !/^(see|compare|synonym of)/i.test(def.trim());

async function fetchDefinitionFromMW(
  word: string,
  targetPOS: string | null,
  apiKey: string,
): Promise<string | null> {
  const res = await fetch(
    `${MW_API}/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) {
    process.stderr.write(`[MW] HTTP ${res.status} "${word}" — key 可能對應錯誤的 MW 字典類型\n`);
    return null;
  }
  const raw = await res.json() as (MWEntry | string)[];

  // MW 找不到詞時回傳建議字串陣列，過濾掉
  const entries = raw.filter((e): e is MWEntry => typeof e === 'object' && Array.isArray(e.shortdef) && e.shortdef.length > 0);
  if (entries.length === 0) return null;

  // 優先找符合 POS 的 entry
  if (targetPOS) {
    const match = entries.find(e => e.fl === targetPOS);
    const def = match?.shortdef?.find(isUsableMW);
    if (def) return `(${match!.fl}) ${def}`;
  }

  // Fallback 到第一筆 entry 的第一個可用定義
  for (const entry of entries) {
    const def = entry.shortdef?.find(isUsableMW);
    if (def) return `(${entry.fl ?? 'unknown'}) ${def}`;
  }
  return null;
}

// ── Free Dictionary API（fallback）────────────────────────────────────────────

interface FreeDictEntry {
  meanings: Array<{ partOfSpeech: string; definitions: Array<{ definition: string }> }>;
}

const isUsableFree = (def: string) =>
  def.length >= 10 &&
  !/^(See|Compare|Alternative|Synonym|Archaic)/i.test(def.trim()) &&
  !/\((verb|noun|adjective|adverb|pronoun)\)/i.test(def);

async function fetchDefinitionFromFreeDict(
  word: string,
  targetPOS: string | null,
): Promise<string | null> {
  const res = await fetch(`${DICT_API}/${encodeURIComponent(word)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const data = await res.json() as FreeDictEntry[];

  if (targetPOS) {
    for (const entry of data) {
      for (const meaning of entry.meanings) {
        if (meaning.partOfSpeech === targetPOS) {
          const def = meaning.definitions.find(d => isUsableFree(d.definition))?.definition ?? null;
          if (def) return `(${meaning.partOfSpeech}) ${def}`;
        }
      }
    }
  }
  for (const entry of data) {
    for (const meaning of entry.meanings) {
      const def = meaning.definitions.find(d => isUsableFree(d.definition))?.definition ?? null;
      if (def) return `(${meaning.partOfSpeech}) ${def}`;
    }
  }
  return null;
}

// ── 對外介面：MW 優先，失敗則 fallback Free Dictionary ─────────────────────────

export type DictSource = 'MW' | 'free' | 'fallback';

async function fetchEnglishDefinition(
  word: string,
  pos?: string,
): Promise<{ def: string; source: DictSource }> {
  const targetPOS = pos ? normalizePOS(pos) : null;
  const mwKey = process.env.MW_API_KEY;

  if (mwKey) {
    try {
      const def = await fetchDefinitionFromMW(word, targetPOS, mwKey);
      if (def) return { def, source: 'MW' };
    } catch { /* fallthrough to free dict */ }
  }

  try {
    const def = await fetchDefinitionFromFreeDict(word, targetPOS);
    if (def) return { def, source: 'free' };
  } catch { /* fallthrough to word itself */ }

  return { def: word, source: 'fallback' };
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

export function estimateBeginnerTranslate(
  csvPaths: string[],
  options?: { force?: boolean },
): BeginnerTranslateEstimate {
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
      if (options?.force || !get('definition_zh').trim()) {
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
  onProgress?: (
    current: number,
    total: number,
    phase: 'dict' | 'deepl' | 'write',
    meta?: { source?: DictSource; word?: string },
  ) => void,
  options?: { force?: boolean },
): Promise<TranslateResult> {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { translatedCount: 0, skippedCount: 0, outputPath: csvPath };

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  // 解析所有資料列
  const rows = lines.slice(1).map(l => parseRow(l));

  // 找出需要翻譯的列索引（force 模式對全部列重新翻譯）
  const needTranslation = rows
    .map((cols, i) => ({ i, cols }))
    .filter(({ cols }) => options?.force || !get(cols, 'definition_zh').trim());

  const skippedCount = rows.length - needTranslation.length;
  if (needTranslation.length === 0) {
    return { translatedCount: 0, skippedCount, outputPath: csvPath };
  }

  // Phase 1：抓英文字典定義（失敗則用詞彙本身）
  const lemmas = needTranslation.map(({ cols }) => get(cols, 'lemma'));
  const posList = needTranslation.map(({ cols }) => get(cols, 'pos'));
  const englishDefs: string[] = [];
  for (let i = 0; i < lemmas.length; i++) {
    const { def, source } = await fetchEnglishDefinition(lemmas[i], posList[i]);
    englishDefs.push(def);
    onProgress?.(i + 1, lemmas.length, 'dict', { source, word: lemmas[i] });
  }

  // Phase 2：DeepL 批次翻譯
  // 交錯排列 [def1, sent1, def2, sent2, …]，讓定義與對應例句相鄰
  // DeepL 批次模式會以同批次的文字互為上下文；相鄰排列讓 DeepL
  // 在翻譯 def_i 時能參考 sent_i 的語境，選出正確詞義。
  const sentences = needTranslation.map(({ cols }) => get(cols, 'context_sentence'));
  const allTexts = englishDefs.flatMap((def, i) => [def, sentences[i]]);
  onProgress?.(0, allTexts.length, 'deepl');
  const allTranslated = await batchTranslateChunked(allTexts, config, (done, total) => {
    onProgress?.(done, total, 'deepl');
  });

  if (allTranslated.length !== allTexts.length) {
    throw new Error(
      `DeepL 回傳數量不符：送出 ${allTexts.length} 筆，收到 ${allTranslated.length} 筆，無法繼續對齊寫入。`,
    );
  }

  // 偶數索引 = 定義，奇數索引 = 例句
  const defZh = allTranslated.filter((_, i) => i % 2 === 0);
  const sentZh = allTranslated.filter((_, i) => i % 2 === 1);

  // Phase 3：填回資料列
  onProgress?.(0, 1, 'write');
  const defZhColIdx = idx['definition_zh'];
  const sentZhColIdx = idx['context_sentence_zh'];

  needTranslation.forEach(({ i }, j) => {
    while (rows[i].length <= Math.max(defZhColIdx ?? 0, sentZhColIdx ?? 0)) {
      rows[i].push('');
    }
    if (defZhColIdx !== undefined) rows[i][defZhColIdx] = defZh[j] ?? '';
    if (sentZhColIdx !== undefined && (options?.force || !rows[i][sentZhColIdx]?.trim())) {
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
