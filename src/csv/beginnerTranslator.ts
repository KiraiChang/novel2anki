import * as fs from 'fs';
import { TranslatorConfig, batchTranslate } from '../cards/translator';
import { buildProperNounSet, protectNames, restoreNames } from '../nlp/nameProtector';
import { getWordCache, DefinitionLayerCache } from '../nlp/wordCache';

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

// ── 對外介面：word-dict → word-cache → MW → Free Dictionary ────────────────────

export type DictSource = 'MW' | 'free' | 'fallback' | 'cached' | 'dict';

async function fetchEnglishDefinition(
  word: string,
  pos?: string,
): Promise<{ def: string; source: DictSource }> {
  // Layer 2 & 3：個人單字庫 / 自動快取（命中即回傳，不打 API）
  const hit = getWordCache().get(word, pos);
  if (hit) return { def: hit.def, source: hit.tier === 'dict' ? 'dict' : 'cached' };

  const targetPOS = pos ? normalizePOS(pos) : null;
  const mwKey = process.env.MW_API_KEY;

  if (mwKey) {
    try {
      const def = await fetchDefinitionFromMW(word, targetPOS, mwKey);
      if (def) {
        getWordCache().setCache(word, pos, def, 'MW');
        return { def, source: 'MW' };
      }
    } catch { /* fallthrough to free dict */ }
  }

  try {
    const def = await fetchDefinitionFromFreeDict(word, targetPOS);
    if (def) {
      getWordCache().setCache(word, pos, def, 'free');
      return { def, source: 'free' };
    }
  } catch { /* fallthrough to word itself */ }

  getWordCache().setCache(word, pos, word, 'fallback');
  return { def: word, source: 'fallback' };
}

// ── 批次翻譯工具 ─────────────────────────────────────────────────────────────

async function batchTranslateChunked(
  texts: string[],
  config: TranslatorConfig,
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

export function estimateMWFetch(
  csvPaths: string[],
  options?: { force?: boolean },
): { unfetchedCount: number } {
  let unfetchedCount = 0;
  for (const csvPath of csvPaths) {
    let content: string;
    try { content = fs.readFileSync(csvPath, 'utf-8'); } catch { continue; }
    const lines = splitLines(content);
    if (lines.length < 2) continue;
    const headers = parseRow(lines[0]);
    const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const defEn = cols[idx['definition_en']] ?? '';
      if (options?.force || !defEn.trim()) unfetchedCount++;
    }
  }
  return { unfetchedCount };
}

export interface MWFetchResult {
  fetchedCount: number;
  skippedCount: number;
  outputPath: string;
}

export async function fetchBeginnerWordsMW(
  csvPath: string,
  onProgress?: (current: number, total: number, meta?: { source?: DictSource; word?: string }) => void,
  options?: { force?: boolean },
): Promise<MWFetchResult> {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { fetchedCount: 0, skippedCount: 0, outputPath: csvPath };

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
  const rows = lines.slice(1).map(l => parseRow(l));

  // 若 CSV 沒有 definition_en 欄（舊格式），插入於 context_sentence 之前
  if (idx['definition_en'] === undefined) {
    const insertAt = idx['context_sentence'] ?? headers.length;
    headers.splice(insertAt, 0, 'definition_en');
    for (const key of Object.keys(idx)) {
      if (idx[key] >= insertAt) idx[key]++;
    }
    idx['definition_en'] = insertAt;
    for (const row of rows) row.splice(insertAt, 0, '');
  }

  const defEnColIdx = idx['definition_en'];
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  const needFetch = rows
    .map((cols, i) => ({ i, cols }))
    .filter(({ cols }) => options?.force || !get(cols, 'definition_en').trim());

  const skippedCount = rows.length - needFetch.length;

  for (let j = 0; j < needFetch.length; j++) {
    const { i, cols } = needFetch[j];
    const lemma = get(cols, 'lemma');
    const pos   = get(cols, 'pos');
    const { def, source } = await fetchEnglishDefinition(lemma, pos);
    while (rows[i].length <= defEnColIdx) rows[i].push('');
    rows[i][defEnColIdx] = def;
    onProgress?.(j + 1, needFetch.length, { source, word: lemma });
  }

  const headerLine = headers.map(escapeField).join(',');
  const dataLines  = rows.map(cols => {
    while (cols.length < headers.length) cols.push('');
    return cols.map(escapeField).join(',');
  });
  fs.writeFileSync(csvPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
  getWordCache().flush();

  return { fetchedCount: needFetch.length, skippedCount, outputPath: csvPath };
}

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
    `初學者翻譯預估`,
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
  config: TranslatorConfig,
  onProgress?: (
    current: number,
    total: number,
    phase: 'dict' | 'translate' | 'write',
    meta?: { source?: DictSource; word?: string },
  ) => void,
  options?: { force?: boolean; prebuiltNames?: Set<string> },
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
  // 條件：definition_zh 或 context_sentence_zh 任一為空，均需翻譯
  const needTranslation = rows
    .map((cols, i) => ({ i, cols }))
    .filter(({ cols }) =>
      options?.force ||
      !get(cols, 'definition_zh').trim() ||
      !get(cols, 'context_sentence_zh').trim(),
    );

  const skippedCount = rows.length - needTranslation.length;
  if (needTranslation.length === 0) {
    return { translatedCount: 0, skippedCount, outputPath: csvPath };
  }

  // Phase 1：取英文字典定義（若 CSV 已有 definition_en 則直接使用，跳過 MW 呼叫）
  const lemmas = needTranslation.map(({ cols }) => get(cols, 'lemma'));
  const posList = needTranslation.map(({ cols }) => get(cols, 'pos'));
  const englishDefs: string[] = [];
  for (let i = 0; i < lemmas.length; i++) {
    const cached = get(needTranslation[i].cols, 'definition_en');
    if (cached?.trim()) {
      englishDefs.push(cached.trim());
      onProgress?.(i + 1, lemmas.length, 'dict', { source: 'cached', word: lemmas[i] });
    } else {
      const { def, source } = await fetchEnglishDefinition(lemmas[i], posList[i]);
      englishDefs.push(def);
      onProgress?.(i + 1, lemmas.length, 'dict', { source, word: lemmas[i] });
    }
  }

  // Phase 2：DeepL 批次翻譯
  // 交錯排列 [def1, sent1, def2, sent2, …]，讓定義與對應例句相鄰
  // DeepL 批次模式會以同批次的文字互為上下文；相鄰排列讓 DeepL
  // 在翻譯 def_i 時能參考 sent_i 的語境，選出正確詞義。
  const sentences = needTranslation.map(({ cols }) => get(cols, 'context_sentence'));

  // NER 人名保護：優先使用預建人名表（--beginner 階段產生），否則從本批句子動態偵測
  const properNouns = options?.prebuiltNames ?? buildProperNounSet(sentences);
  const nameMaps = sentences.map(s => protectNames(s, properNouns));
  const protectedSentences = nameMaps.map(m => m.text);

  const allTexts = englishDefs.flatMap((def, i) => [def, protectedSentences[i]]);
  onProgress?.(0, allTexts.length, 'translate');
  const allTranslated = await batchTranslateChunked(allTexts, config, (done, total) => {
    onProgress?.(done, total, 'translate');
  });

  if (allTranslated.length !== allTexts.length) {
    throw new Error(
      `DeepL 回傳數量不符：送出 ${allTexts.length} 筆，收到 ${allTranslated.length} 筆，無法繼續對齊寫入。`,
    );
  }

  // 偶數索引 = 定義，奇數索引 = 例句（翻譯後還原人名佔位符）
  const defZh = allTranslated.filter((_, i) => i % 2 === 0);
  const sentZh = allTranslated
    .filter((_, i) => i % 2 === 1)
    .map((t, i) => restoreNames(t, nameMaps[i].restoreMap));

  // Phase 3：填回資料列
  onProgress?.(0, 1, 'write');
  const defZhColIdx = idx['definition_zh'];
  const sentZhColIdx = idx['context_sentence_zh'];

  needTranslation.forEach(({ i }, j) => {
    while (rows[i].length <= Math.max(defZhColIdx ?? 0, sentZhColIdx ?? 0)) {
      rows[i].push('');
    }
    if (defZhColIdx !== undefined && (options?.force || !rows[i][defZhColIdx]?.trim())) {
      rows[i][defZhColIdx] = defZh[j] ?? '';
    }
    if (sentZhColIdx !== undefined && (options?.force || !rows[i][sentZhColIdx]?.trim())) {
      rows[i][sentZhColIdx] = sentZh[j] ?? '';
    }
  });

  // 例句翻譯存入 sentence cache
  const wc = getWordCache();
  needTranslation.forEach(({ }, j) => {
    const enSent = sentences[j];
    const zhSent = sentZh[j];
    if (enSent && zhSent) wc.setSentenceZh(enSent, zhSent);
  });

  // 寫回檔案
  const headerLine = headers.map(escapeField).join(',');
  const dataLines = rows.map(cols => cols.map(escapeField).join(','));
  fs.writeFileSync(csvPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
  wc.flush();
  onProgress?.(1, 1, 'write');

  return { translatedCount: needTranslation.length, skippedCount, outputPath: csvPath };
}

// ── 個人單字庫升級 ────────────────────────────────────────────────────────────

export interface UpdateDictResult {
  updatedCount: number;
  skippedCount: number;
}

/**
 * 將 CSV 中已填寫的 definition_en 升級到個人單字庫（word-dict.json）。
 * 未來所有書遇到相同 word:pos 時，將優先使用此精選定義，不再查 MW。
 */
export async function updateWordDictFromCsv(
  csvPath: string,
  onProgress?: (current: number, total: number, word?: string) => void,
): Promise<UpdateDictResult> {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { updatedCount: 0, skippedCount: 0 };

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
  const rows = lines.slice(1).map(l => parseRow(l));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  const cache = getWordCache();
  let updatedCount = 0;
  let skippedCount = 0;

  rows.forEach((cols, i) => {
    const lemma = get(cols, 'lemma').trim();
    const pos   = get(cols, 'pos').trim();
    const defEn = get(cols, 'definition_en').trim();
    if (!lemma || !defEn) { skippedCount++; return; }
    cache.setDict(lemma, pos || undefined, defEn);
    updatedCount++;
    onProgress?.(i + 1, rows.length, lemma);
  });

  cache.flush();
  return { updatedCount, skippedCount };
}

// ── 例句快取雙向同步 ───────────────────────────────────────────────────────────

export interface SyncSentenceResult {
  savedToCache:    number;  // CSV → sentence-cache（非空且快取尚無才存入）
  skippedCache:    number;  // CSV → sentence-cache（快取已有，略過不覆寫）
  filledFromCache: number;  // sentence-cache → CSV（空例句翻譯從快取補填）
  noMatch:         number;  // 空且快取也找不到
  outputPath:      string;
}

/**
 * 雙向同步例句翻譯：
 * - context_sentence_zh 不為空 → 快取尚無才寫入 sentence-cache.json；已有則略過
 * - context_sentence_zh 為空   → 從 sentence-cache.json 補填
 * 若有任何 CSV 更新，自動寫回檔案。
 */
export function syncSentenceCacheWithCsv(
  csvPath: string,
  onProgress?: (current: number, total: number, action: 'saved' | 'filled' | 'skip') => void,
): SyncSentenceResult {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) {
    return { savedToCache: 0, skippedCache: 0, filledFromCache: 0, noMatch: 0, outputPath: csvPath };
  }

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
  const rows = lines.slice(1).map(l => parseRow(l));

  const sentEnColIdx  = idx['context_sentence'];
  const sentZhColIdx  = idx['context_sentence_zh'];
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  if (sentEnColIdx === undefined) {
    return { savedToCache: 0, skippedCache: 0, filledFromCache: 0, noMatch: rows.length, outputPath: csvPath };
  }

  const wc = getWordCache();
  let savedToCache    = 0;
  let skippedCache    = 0;
  let filledFromCache = 0;
  let noMatch         = 0;
  let csvDirty        = false;

  for (let i = 0; i < rows.length; i++) {
    const enSent = get(rows[i], 'context_sentence').trim();
    const zhSent = sentZhColIdx !== undefined ? get(rows[i], 'context_sentence_zh').trim() : '';

    if (zhSent) {
      // CSV → cache：快取尚無才存入，已有則略過
      if (!wc.getSentenceZh(enSent)) {
        wc.setSentenceZh(enSent, zhSent);
        savedToCache++;
        onProgress?.(i + 1, rows.length, 'saved');
      } else {
        skippedCache++;
        onProgress?.(i + 1, rows.length, 'skip');
      }
    } else if (enSent) {
      // cache → CSV：嘗試從快取補填
      const cached = wc.getSentenceZh(enSent);
      if (cached && sentZhColIdx !== undefined) {
        while (rows[i].length <= sentZhColIdx) rows[i].push('');
        rows[i][sentZhColIdx] = cached;
        filledFromCache++;
        csvDirty = true;
        onProgress?.(i + 1, rows.length, 'filled');
      } else {
        noMatch++;
        onProgress?.(i + 1, rows.length, 'skip');
      }
    } else {
      noMatch++;
      onProgress?.(i + 1, rows.length, 'skip');
    }
  }

  if (csvDirty) {
    const headerLine = headers.map(escapeField).join(',');
    const dataLines  = rows.map(cols => cols.map(escapeField).join(','));
    fs.writeFileSync(csvPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
  }

  wc.flush();
  return { savedToCache, skippedCache, filledFromCache, noMatch, outputPath: csvPath };
}

// ── 定義翻譯快取雙向同步 ──────────────────────────────────────────────────────

export interface SyncDefinitionResult {
  savedToCache:    number;  // CSV → word-cache-zh（非空且快取尚無才存入）
  skippedCache:    number;  // CSV → word-cache-zh（快取已有，略過不覆寫）
  filledFromCache: number;  // word-cache-zh → CSV（空 definition_zh 從快取補填）
  noMatch:         number;  // 空且快取也找不到
  outputPath:      string;
}

/** 傳入 --fill-def-zh 的 domain / book 設定 */
export interface FillDefZhConfig {
  domain?: string;
  book?: string;
}

/**
 * 雙向同步詞彙中文定義（支援 domain / book 分層快取）：
 *
 * CSV → cache（definition_zh 不為空）：
 *   - book / domain cache：有指定時，key 尚無值才寫入（setIfEmpty）
 *   - global cache：CEFR level 已知（非 UNKNOWN）且 key 尚無值才寫入
 *
 * cache → CSV（definition_zh 為空）：
 *   - 查詢順序：book → domain → global
 *   - 有指定 book/domain 時，仍以 global 作為最終 fallback
 *
 * 若有任何 CSV 更新，自動寫回檔案。
 */
export function syncDefinitionCacheWithCsv(
  csvPath: string,
  onProgress?: (current: number, total: number, action: 'saved' | 'filled' | 'skip') => void,
  config?: FillDefZhConfig,
): SyncDefinitionResult {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) {
    return { savedToCache: 0, skippedCache: 0, filledFromCache: 0, noMatch: 0, outputPath: csvPath };
  }

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
  const rows = lines.slice(1).map(l => parseRow(l));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  const defZhColIdx = idx['definition_zh'];
  if (defZhColIdx === undefined) {
    return { savedToCache: 0, skippedCache: 0, filledFromCache: 0, noMatch: rows.length, outputPath: csvPath };
  }

  const wc = getWordCache();
  const domainCache = config?.domain ? new DefinitionLayerCache(wc.cacheDir, 'domain', config.domain) : null;
  const bookCache   = config?.book   ? new DefinitionLayerCache(wc.cacheDir, 'book',   config.book)   : null;

  let savedToCache    = 0;
  let skippedCache    = 0;
  let filledFromCache = 0;
  let noMatch         = 0;
  let csvDirty        = false;

  for (let i = 0; i < rows.length; i++) {
    const lemma     = get(rows[i], 'lemma').trim();
    const pos       = get(rows[i], 'pos').trim() || null;
    const defZh     = get(rows[i], 'definition_zh').trim();
    const cefrLevel = get(rows[i], 'cefr_level').trim();

    if (!lemma) {
      noMatch++;
      onProgress?.(i + 1, rows.length, 'skip');
      continue;
    }

    if (defZh) {
      // CSV → cache
      let wroteAny = false;

      if (bookCache)   wroteAny = bookCache.setIfEmpty(lemma, pos, defZh)   || wroteAny;
      if (domainCache) wroteAny = domainCache.setIfEmpty(lemma, pos, defZh) || wroteAny;

      // global：只有 CEFR 有 level 的詞才寫入
      const cefrKnown = cefrLevel && cefrLevel !== 'UNKNOWN';
      if (cefrKnown && !wc.getChinese(lemma, pos)) {
        wc.setChinese(lemma, pos, defZh, 'csv');
        wroteAny = true;
      }

      if (wroteAny) {
        savedToCache++;
        onProgress?.(i + 1, rows.length, 'saved');
      } else {
        skippedCache++;
        onProgress?.(i + 1, rows.length, 'skip');
      }
    } else {
      // cache → CSV：book → domain → global
      let cached: string | null = null;
      if (bookCache)   cached ??= bookCache.get(lemma, pos);
      if (domainCache) cached ??= domainCache.get(lemma, pos);
      cached ??= wc.getChinese(lemma, pos);

      if (cached) {
        while (rows[i].length <= defZhColIdx) rows[i].push('');
        rows[i][defZhColIdx] = cached;
        filledFromCache++;
        csvDirty = true;
        onProgress?.(i + 1, rows.length, 'filled');
      } else {
        noMatch++;
        onProgress?.(i + 1, rows.length, 'skip');
      }
    }
  }

  if (csvDirty) {
    const headerLine = headers.map(escapeField).join(',');
    const dataLines  = rows.map(cols => cols.map(escapeField).join(','));
    fs.writeFileSync(csvPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
  }

  wc.flush();
  domainCache?.flush();
  bookCache?.flush();
  return { savedToCache, skippedCache, filledFromCache, noMatch, outputPath: csvPath };
}
