import * as fs from 'fs';
import { TranslatorConfig, batchTranslate } from '../cards/translator';
import { buildProperNounSet, protectNames, restoreNames } from '../nlp/nameProtector';
import { getWordCache, DefinitionLayerCache } from '../nlp/wordCache';
import { applyNormalization } from '../nlp/tokenNormalizer';
import { batchWsd, WsdRequest } from './wsdClient';
import { getWsdShortdefsDb, hashShortdefs, ShortdefEntry } from '../nlp/wsdShortdefsDb';
import { getWordDefDb } from '../nlp/wordDefDb';

const MW_API   = 'https://www.dictionaryapi.com/api/v3/references/learners/json';
const DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const DEEPL_FREE_LIMIT = 500_000;
const DEEPL_PRO_PRICE_PER_MILLION = 25;
const DEEPL_BATCH_SIZE = 50;

// ── 翻譯來源優先序 ────────────────────────────────────────────────────────────

// 越高優先序越不應被低品質來源覆蓋
// cache(1) < deepl/azure/google/claude(2) < csv(3)
const SOURCE_PRIORITY: Record<string, number> = {
  '': 0, 'cache': 1, 'deepl': 2, 'google': 2, 'azure': 2, 'claude': 2, 'chatgpt': 2, 'csv': 3,
};

// 回傳 true 表示可以用 cache 覆蓋（空 or cache 來源）
function canFillFromCache(currentSource: string): boolean {
  return (SOURCE_PRIORITY[currentSource.toLowerCase()] ?? 0) <= 1;
}

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
  meta?: { id?: string };  // MW entry id，如 "against" / "back:1"（用於過濾非查詢詞的 entry）
  fl?: string;             // functional label（詞性），如 "noun" / "verb"
  shortdef?: string[];     // 簡短定義列表
}

/** MW meta.id 可能帶 ":N" 同形詞後綴，只比較冒號前的部分 */
function isSameWord(metaId: string | undefined, word: string): boolean {
  if (!metaId) return true; // 無 id 欄位時保守接受
  return metaId.toLowerCase().split(':')[0] === word.toLowerCase();
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

  // MW 找不到詞時回傳建議字串陣列；meta.id 不符的 entry 屬於其他詞，一併過濾
  const entries = raw.filter((e): e is MWEntry =>
    typeof e === 'object' &&
    Array.isArray(e.shortdef) &&
    e.shortdef.length > 0 &&
    isSameWord(e.meta?.id, word),
  );
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

/**
 * 取得 MW API 回傳的所有可用 (fl, shortdef) 配對（供 WSD 使用）。
 * POS 匹配的 entry 排前面，但不過濾掉其他 entry，讓 WSD 有更多候選詞義。
 * 回傳 null 表示 MW 無此詞或網路失敗。
 */
async function fetchAllShortdefsFromMW(
  word: string,
  targetPOS: string | null,
  apiKey: string,
): Promise<Array<{ fl: string; shortdef: string }> | null> {
  const res = await fetch(
    `${MW_API}/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return null;
  const raw = await res.json() as (MWEntry | string)[];
  // meta.id 不符的 entry 屬於其他詞（MW 同一回應可能混入多詞），過濾掉
  const entries = raw.filter((e): e is MWEntry =>
    typeof e === 'object' &&
    Array.isArray(e.shortdef) &&
    e.shortdef.length > 0 &&
    isSameWord(e.meta?.id, word),
  );
  if (entries.length === 0) return null;

  // POS 匹配的 entry 排前面
  const ordered = targetPOS
    ? [...entries.filter(e => e.fl === targetPOS), ...entries.filter(e => e.fl !== targetPOS)]
    : entries;

  const results: Array<{ fl: string; shortdef: string }> = [];
  for (const entry of ordered) {
    for (const def of entry.shortdef ?? []) {
      if (isUsableMW(def)) results.push({ fl: entry.fl ?? 'unknown', shortdef: def });
    }
  }
  return results.length > 0 ? results : null;
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
  wsdCount?: number; // WSD 改變了詞義選擇的筆數（--wsd 模式才有值）
}

export async function fetchBeginnerWordsMW(
  csvPath: string,
  onProgress?: (current: number, total: number, meta?: { source?: DictSource; word?: string }) => void,
  options?: { force?: boolean; wsd?: boolean },
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

  // 若 CSV 沒有 definition_en_source 欄，插入於 definition_en 之後
  if (idx['definition_en_source'] === undefined) {
    const insertAt = idx['definition_en'] + 1;
    headers.splice(insertAt, 0, 'definition_en_source');
    for (const key of Object.keys(idx)) {
      if (idx[key] >= insertAt) idx[key]++;
    }
    idx['definition_en_source'] = insertAt;
    for (const row of rows) row.splice(insertAt, 0, '');
  }

  const defEnColIdx    = idx['definition_en'];
  const defEnSrcColIdx = idx['definition_en_source'];
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  // WSD 模式也處理已有 definition_en（但尚未消歧）的行
  const needFetch = rows
    .map((cols, i) => ({ i, cols }))
    .filter(({ cols }) => {
      if (options?.force) return true;
      const defEn = get(cols, 'definition_en').trim();
      if (!defEn) return true;
      if (options?.wsd) {
        // WSD 模式：跳過已做過消歧的行（source = 'mw+wsd'）
        const src = get(cols, 'definition_en_source').trim();
        return src !== 'mw+wsd';
      }
      return false;
    });

  const skippedCount = rows.length - needFetch.length;

  if (!options?.wsd) {
    // ── 標準路徑（不含 WSD）────────────────────────────────────────────────────
    for (let j = 0; j < needFetch.length; j++) {
      const { i, cols } = needFetch[j];
      const lemma = get(cols, 'lemma');
      const pos   = get(cols, 'pos');
      const { def, source } = await fetchEnglishDefinition(lemma, pos);
      const srcStr = source === 'MW' ? 'mw' : source === 'cached' ? 'cache' : source;
      while (rows[i].length <= Math.max(defEnColIdx, defEnSrcColIdx)) rows[i].push('');
      rows[i][defEnColIdx]    = def;
      rows[i][defEnSrcColIdx] = srcStr;
      onProgress?.(j + 1, needFetch.length, { source, word: lemma });
    }
  } else {
    // ── WSD 路徑（兩階段：MW 取全部 shortdefs → 批次推論）────────────────────
    const mwKey = process.env.MW_API_KEY;
    const wordCache = getWordCache();

    // (rowIdx, 候選詞義列表, context sentence)
    type WsdItem = { rowIdx: number; lemma: string; pos: string; sentence: string; candidates: ShortdefEntry[] };
    const wsdPending: WsdItem[] = [];
    const shortdefsDb = getWsdShortdefsDb();

    // POS 匹配的 entry 排前面（讀取 SQLite 後套用，讓跨書複用同一份原始資料）
    const applyPosOrder = (entries: ShortdefEntry[], targetPOS: string | null): ShortdefEntry[] =>
      targetPOS
        ? [...entries.filter(e => e.fl === targetPOS), ...entries.filter(e => e.fl !== targetPOS)]
        : entries;

    // Phase 1：為每個詞取全部 shortdefs（SQLite → MW API → fallback）
    for (let j = 0; j < needFetch.length; j++) {
      const { i, cols } = needFetch[j];
      const lemma    = get(cols, 'lemma');
      const pos      = get(cols, 'pos');
      const sentence = get(cols, 'context_sentence').trim();
      const targetPOS = pos ? normalizePOS(pos) : null;

      onProgress?.(j + 1, needFetch.length, { word: lemma });

      // 無語境句子：直接走單一定義路徑（WSD 無意義）
      if (!sentence) {
        const { def, source } = await fetchEnglishDefinition(lemma, pos);
        const srcStr = source === 'MW' ? 'mw' : source === 'cached' ? 'cache' : source;
        while (rows[i].length <= Math.max(defEnColIdx, defEnSrcColIdx)) rows[i].push('');
        rows[i][defEnColIdx]    = def;
        rows[i][defEnSrcColIdx] = srcStr;
        continue;
      }

      // 先查 SQLite shortdefs 快取（跨書共用，不打 MW API）
      let rawEntries = shortdefsDb.get(lemma);

      // SQLite 未命中且有 MW key：查 MW 並寫入 SQLite
      if (!rawEntries && mwKey) {
        try {
          // targetPOS=null 取回 MW 原始全部 entry，排序留給 applyPosOrder
          rawEntries = await fetchAllShortdefsFromMW(lemma, null, mwKey);
          if (rawEntries) shortdefsDb.set(lemma, rawEntries);
        } catch { /* fallthrough */ }
      }

      // 套用 POS 排序
      const candidates = rawEntries ? applyPosOrder(rawEntries, targetPOS) : null;

      // 無結果或只有一個候選：直接用 fetchEnglishDefinition
      if (!candidates || candidates.length <= 1) {
        const def = candidates?.[0] ? `(${candidates[0].fl}) ${candidates[0].shortdef}` : null;
        if (def) {
          wordCache.setCache(lemma, pos, def, 'MW');
          while (rows[i].length <= Math.max(defEnColIdx, defEnSrcColIdx)) rows[i].push('');
          rows[i][defEnColIdx]    = def;
          rows[i][defEnSrcColIdx] = 'mw';
        } else {
          const { def: d, source } = await fetchEnglishDefinition(lemma, pos);
          const srcStr = source === 'MW' ? 'mw' : source === 'cached' ? 'cache' : source;
          while (rows[i].length <= Math.max(defEnColIdx, defEnSrcColIdx)) rows[i].push('');
          rows[i][defEnColIdx]    = d;
          rows[i][defEnSrcColIdx] = srcStr;
        }
        continue;
      }

      // 多候選：先查 WSD 快取（以 hash 做 MW 版本失效偵測）
      const candidatesHash = hashShortdefs(candidates);
      const cachedWsd = wordCache.getWsd(lemma, pos, sentence, candidatesHash);
      if (cachedWsd) {
        const chosen = candidates[cachedWsd.chosenIndex] ?? candidates[0];
        const def = `(${chosen.fl}) ${chosen.shortdef}`;
        while (rows[i].length <= Math.max(defEnColIdx, defEnSrcColIdx)) rows[i].push('');
        rows[i][defEnColIdx]    = def;
        rows[i][defEnSrcColIdx] = 'cache';
        continue;
      }

      wsdPending.push({ rowIdx: i, lemma, pos, sentence, candidates });
    }

    // Phase 2：批次 WSD 推論
    if (wsdPending.length > 0) {
      const wsdRequests: WsdRequest[] = wsdPending.map(item => ({
        word: item.lemma,
        shortdefs: item.candidates.map(c => c.shortdef),
        sentence: item.sentence,
      }));

      const wsdResults = await batchWsd(wsdRequests);
      const wsdMap = new Map(wsdResults.map(r => [r.word, r]));

      let wsdChanged = 0;
      for (const item of wsdPending) {
        const result    = wsdMap.get(item.lemma);
        const chosenIdx = result?.chosenIndex ?? 0;
        const score     = result?.score ?? 0;
        const chosen    = item.candidates[chosenIdx] ?? item.candidates[0];
        const def = `(${chosen.fl}) ${chosen.shortdef}`;
        const src = chosenIdx !== 0 ? 'mw+wsd' : 'mw';
        if (chosenIdx !== 0) wsdChanged++;

        wordCache.setCache(item.lemma, item.pos, def, 'MW');
        // score === 0 代表 Python fallback，不快取，讓下次重跑時重新消歧
        if (score > 0) {
          wordCache.setWsd(item.lemma, item.pos, item.sentence, chosenIdx, score, hashShortdefs(item.candidates));
        }

        while (rows[item.rowIdx].length <= Math.max(defEnColIdx, defEnSrcColIdx)) rows[item.rowIdx].push('');
        rows[item.rowIdx][defEnColIdx]    = def;
        rows[item.rowIdx][defEnSrcColIdx] = src;
      }

      const result: MWFetchResult = {
        fetchedCount: needFetch.length,
        skippedCount,
        outputPath: csvPath,
        wsdCount: wsdChanged,
      };
      wordCache.flush();
      const headerLine = headers.map(escapeField).join(',');
      const dataLines  = rows.map(cols => {
        while (cols.length < headers.length) cols.push('');
        return cols.map(escapeField).join(',');
      });
      fs.writeFileSync(csvPath, [headerLine, ...dataLines].join('\n'), 'utf-8');
      return result;
    }
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
      if (options?.force || !get('definition_en').trim() || !get('definition_zh').trim() || !get('context_sentence_zh').trim() || !get('word_zh').trim()) {
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
  options?: { force?: boolean; prebuiltNames?: Map<string, string>; normalizeMap?: Map<string, string> },
): Promise<TranslateResult> {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { translatedCount: 0, skippedCount: 0, outputPath: csvPath };

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  // 解析所有資料列
  const rows = lines.slice(1).map(l => parseRow(l));

  // 自動插入缺少的欄（舊 CSV 向後相容）
  for (const [srcCol, afterCol] of [
    ['context_sentence_zh_source', 'context_sentence_zh'],
    ['definition_zh_source',       'definition_zh'       ],
    ['word_zh',                    'definition_zh_source'],
    ['word_zh_source',             'word_zh'             ],
  ] as [string, string][]) {
    if (idx[srcCol] === undefined) {
      const insertAt = (idx[afterCol] ?? headers.length - 1) + 1;
      headers.splice(insertAt, 0, srcCol);
      for (const key of Object.keys(idx)) {
        if ((idx as Record<string, number>)[key] >= insertAt) (idx as Record<string, number>)[key]++;
      }
      (idx as Record<string, number>)[srcCol] = insertAt;
      for (const row of rows) row.splice(insertAt, 0, '');
    }
  }

  // 找出需要處理的列索引（force 模式對全部列重新翻譯）
  // 條件：definition_en、definition_zh、context_sentence_zh、word_zh 任一為空，均需處理；四者皆有才跳過
  const needTranslation = rows
    .map((cols, i) => ({ i, cols }))
    .filter(({ cols }) =>
      options?.force ||
      !get(cols, 'definition_en').trim() ||
      !get(cols, 'definition_zh').trim() ||
      !get(cols, 'context_sentence_zh').trim() ||
      !get(cols, 'word_zh').trim(),
    );

  const skippedCount = rows.length - needTranslation.length;
  if (needTranslation.length === 0) {
    return { translatedCount: 0, skippedCount, outputPath: csvPath };
  }

  // Phase 1：取英文字典定義（若 CSV 已有 definition_en 則直接使用，跳過 MW 呼叫）
  const lemmas = needTranslation.map(({ cols }) => get(cols, 'lemma'));
  const posList = needTranslation.map(({ cols }) => get(cols, 'pos'));
  const englishDefs: string[] = [];
  const englishDefSources: string[] = [];  // '' = 已在 CSV 不需回寫；否則為 API 來源
  for (let i = 0; i < lemmas.length; i++) {
    const cached = get(needTranslation[i].cols, 'definition_en');
    if (cached?.trim()) {
      englishDefs.push(cached.trim());
      englishDefSources.push('');
      onProgress?.(i + 1, lemmas.length, 'dict', { source: 'cached', word: lemmas[i] });
    } else {
      const { def, source } = await fetchEnglishDefinition(lemmas[i], posList[i]);
      englishDefs.push(def);
      englishDefSources.push(source);
      onProgress?.(i + 1, lemmas.length, 'dict', { source, word: lemmas[i] });
    }
  }

  // Phase 2.5 準備：分兩組——快取命中直接用，快取未中才批次送翻譯 API
  const wc              = getWordCache();
  const wordZhColIdx    = (idx as Record<string, number>)['word_zh'];
  const wordZhSrcColIdx = (idx as Record<string, number>)['word_zh_source'];
  const wordZhFromCache: Array<{ j: number; zh: string; src: string }> = [];
  const wordZhBatch:     Array<{ j: number; lemma: string }>            = [];
  for (let j = 0; j < needTranslation.length; j++) {
    const { cols } = needTranslation[j];
    if (options?.force || !get(cols, 'word_zh').trim()) {
      const lemma = lemmas[j];
      const pos   = posList[j] || null;
      if (!options?.force) {
        const cached = wc.getWordZh(lemma, pos);
        if (cached) {
          wordZhFromCache.push({ j, zh: cached, src: wc.getWordZhSource(lemma, pos) || 'cache' });
          continue;
        }
      }
      wordZhBatch.push({ j, lemma });
    }
  }

  // Phase 2：DeepL 批次翻譯
  // 交錯排列 [def1, sent1, def2, sent2, …]，讓定義與對應例句相鄰
  // DeepL 批次模式會以同批次的文字互為上下文；相鄰排列讓 DeepL
  // 在翻譯 def_i 時能參考 sent_i 的語境，選出正確詞義。
  const sentences = needTranslation.map(({ cols }) => get(cols, 'context_sentence'));

  // 正規化：在 NER 保護前先還原古語/方言詞（context_sentence 欄保留原文不變）
  const normalizeMap = options?.normalizeMap;
  const sentencesForTranslation = normalizeMap
    ? sentences.map(s => applyNormalization(s, normalizeMap))
    : sentences;

  // NER 人名保護：優先使用預建人名表（--beginner 階段產生），否則從本批句子動態偵測
  const namesMap = options?.prebuiltNames;
  const properNouns = namesMap
    ? new Set(namesMap.keys())
    : buildProperNounSet(sentencesForTranslation);
  const nameMaps = sentencesForTranslation.map(s => protectNames(s, properNouns));
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

  // Phase 2.5：翻譯 lemma 取得 word_zh（單字直接中文對應）
  const wordZhTranslated: string[] = wordZhBatch.length > 0
    ? await batchTranslateChunked(wordZhBatch.map(b => b.lemma), config)
    : [];

  // 偶數索引 = 定義，奇數索引 = 例句（翻譯後還原人名佔位符）
  const defZh = allTranslated.filter((_, i) => i % 2 === 0);
  const sentZh = allTranslated
    .filter((_, i) => i % 2 === 1)
    .map((t, i) => restoreNames(t, nameMaps[i].restoreMap, namesMap));

  // Phase 3：填回資料列
  onProgress?.(0, 1, 'write');
  const defEnColIdx     = (idx as Record<string, number>)['definition_en'];
  const defEnSrcColIdx  = (idx as Record<string, number>)['definition_en_source'];
  const defZhColIdx     = (idx as Record<string, number>)['definition_zh'];
  const sentZhColIdx    = (idx as Record<string, number>)['context_sentence_zh'];
  const defZhSrcColIdx  = (idx as Record<string, number>)['definition_zh_source'];
  const sentZhSrcColIdx = (idx as Record<string, number>)['context_sentence_zh_source'];
  const provider        = config.provider;

  needTranslation.forEach(({ i }, j) => {
    const maxIdx = Math.max(
      defEnColIdx ?? 0, defEnSrcColIdx ?? 0,
      defZhColIdx ?? 0, sentZhColIdx ?? 0,
      defZhSrcColIdx ?? 0, sentZhSrcColIdx ?? 0,
      wordZhColIdx ?? 0, wordZhSrcColIdx ?? 0,
    );
    while (rows[i].length <= maxIdx) rows[i].push('');

    if (defEnColIdx !== undefined) {
      const src = englishDefSources[j];
      if (src) {  // 非空 = 本次從 API 取得，需回寫（空字串 = 原本已在 CSV，不覆寫）
        rows[i][defEnColIdx] = englishDefs[j];
        if (defEnSrcColIdx !== undefined) {
          rows[i][defEnSrcColIdx] = src === 'MW' ? 'mw' : src === 'cached' ? 'cache' : src;
        }
      }
    }
    if (defZhColIdx !== undefined && (options?.force || !rows[i][defZhColIdx]?.trim())) {
      rows[i][defZhColIdx] = defZh[j] ?? '';
      if (defZhSrcColIdx !== undefined) rows[i][defZhSrcColIdx] = provider;
    }
    if (sentZhColIdx !== undefined && (options?.force || !rows[i][sentZhColIdx]?.trim())) {
      rows[i][sentZhColIdx] = sentZh[j] ?? '';
      if (sentZhSrcColIdx !== undefined) rows[i][sentZhSrcColIdx] = provider;
    }
  });

  // word_zh 寫回 CSV（快取命中）
  for (const { j, zh, src } of wordZhFromCache) {
    const { i } = needTranslation[j];
    if (wordZhColIdx !== undefined && (options?.force || !rows[i][wordZhColIdx]?.trim())) {
      while (rows[i].length <= Math.max(wordZhColIdx, wordZhSrcColIdx ?? 0)) rows[i].push('');
      rows[i][wordZhColIdx] = zh;
      if (wordZhSrcColIdx !== undefined) rows[i][wordZhSrcColIdx] = src;
    }
  }

  // word_zh 寫回 CSV + 存入 cache（API 翻譯結果；setWordZhIfEmpty：已有則略過）
  for (let bIdx = 0; bIdx < wordZhBatch.length; bIdx++) {
    const { j } = wordZhBatch[bIdx];
    const { i, cols } = needTranslation[j];
    const wordZh = wordZhTranslated[bIdx] ?? '';
    if (!wordZh) continue;
    if (wordZhColIdx !== undefined && (options?.force || !rows[i][wordZhColIdx]?.trim())) {
      while (rows[i].length <= Math.max(wordZhColIdx, wordZhSrcColIdx ?? 0)) rows[i].push('');
      rows[i][wordZhColIdx] = wordZh;
      if (wordZhSrcColIdx !== undefined) rows[i][wordZhSrcColIdx] = provider;
    }
    wc.setWordZhIfEmpty(get(cols, 'lemma'), get(cols, 'pos') || null, wordZh, provider);
  }

  // 例句翻譯存入 sentence cache
  needTranslation.forEach(({ }, j) => {
    const enSent = sentences[j];
    const zhSent = sentZh[j];
    if (enSent && zhSent) wc.setSentenceZh(enSent, zhSent, config.provider);
  });

  // 同步寫入 word-def.db（definition_en 與 definition_zh 皆非空才寫）
  // fallback source（無真實字典定義，以單詞本身補位）時不寫入，避免儲存無意義的鍵值
  if (defEnColIdx !== undefined && defZhColIdx !== undefined) {
    const wordDefDb = getWordDefDb();
    const srcColIdx = defZhSrcColIdx;
    needTranslation.forEach(({ i, cols }, j) => {
      if (englishDefSources[j] === 'fallback') return;
      const lemma = get(cols, 'lemma').trim();
      const pos   = get(cols, 'pos').trim();
      const en    = (rows[i][defEnColIdx] ?? '').trim();
      const zh    = (rows[i][defZhColIdx] ?? '').trim();
      const src   = srcColIdx !== undefined ? (rows[i][srcColIdx] ?? '').trim() : provider;
      if (lemma && pos && en && zh) wordDefDb.set(lemma, pos, en, zh, src);
    });
  }

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

  const sentEnColIdx    = idx['context_sentence'];
  const sentZhColIdx    = idx['context_sentence_zh'];
  const sentZhSrcColIdx = idx['context_sentence_zh_source'];
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
    const enSent   = get(rows[i], 'context_sentence').trim();
    const zhSent   = sentZhColIdx !== undefined ? get(rows[i], 'context_sentence_zh').trim() : '';
    const zhSrc    = sentZhSrcColIdx !== undefined ? get(rows[i], 'context_sentence_zh_source').trim() : '';

    if (zhSent) {
      // CSV → cache：依 source 優先序決定是否覆蓋（setSentenceZh 內部判斷）
      if (wc.setSentenceZh(enSent, zhSent, zhSrc || '')) {
        savedToCache++;
        onProgress?.(i + 1, rows.length, 'saved');
      } else {
        skippedCache++;
        onProgress?.(i + 1, rows.length, 'skip');
      }
    } else if (enSent) {
      // cache → CSV：嘗試從快取補填，但 source 優先序較高時不覆蓋
      if (sentZhSrcColIdx !== undefined && !canFillFromCache(zhSrc)) {
        noMatch++;
        onProgress?.(i + 1, rows.length, 'skip');
        continue;
      }
      const cached = wc.getSentenceZh(enSent);
      if (cached && sentZhColIdx !== undefined) {
        while (rows[i].length <= Math.max(sentZhColIdx, sentZhSrcColIdx ?? 0)) rows[i].push('');
        rows[i][sentZhColIdx] = cached;
        if (sentZhSrcColIdx !== undefined) rows[i][sentZhSrcColIdx] = wc.getSentenceZhSource(enSent) || 'cache';
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
 * 雙向同步詞彙定義（definition_zh 與 definition_en，支援 domain / book 分層快取）：
 *
 * CSV → cache（欄位不為空）：
 *   - zh：book / domain cache setIfEmpty；global cache CEFR 已知才寫入
 *   - en：book / domain en cache setEnIfEmpty；global word-cache.json CEFR 已知且無現有條目才寫入
 *   - 兩者均僅對 CEFR UNKNOWN 詞寫入 domain/book，與 global 互補不重疊
 *
 * cache → CSV（欄位為空）：
 *   - 查詢順序：book → domain → global（zh 查 getChinese，en 查 get()/getEn()）
 *   - global 永遠作最終 fallback
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

  const defZhColIdx     = idx['definition_zh'];
  const defZhSrcColIdx  = idx['definition_zh_source'];
  const defEnColIdx     = idx['definition_en'];
  const defEnSrcColIdx  = idx['definition_en_source'];
  const wrdZhColIdx     = idx['word_zh'];
  const wrdZhSrcColIdx  = idx['word_zh_source'];
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
    const defEn     = defEnColIdx    !== undefined ? get(rows[i], 'definition_en').trim()        : '';
    const defEnSrc  = defEnSrcColIdx !== undefined ? get(rows[i], 'definition_en_source').trim() : '';
    const cefrLevel  = get(rows[i], 'cefr_level').trim();
    const defZhSrc   = defZhSrcColIdx !== undefined ? get(rows[i], 'definition_zh_source').trim() : '';

    if (!lemma) {
      noMatch++;
      onProgress?.(i + 1, rows.length, 'skip');
      continue;
    }

    const cefrKnown = cefrLevel && cefrLevel !== 'UNKNOWN';
    let wroteAny    = false;
    let filledAny   = false;
    let zhBlocked   = false;  // zh 被 source 優先序攔截，不計入 skippedCache

    // ── zh：CSV → cache ──────────────────────────────────────────────────────
    if (defZh) {
      const zhSource = defZhSrc || 'csv';
      if (!cefrKnown) {
        if (bookCache)   wroteAny = bookCache.setIfEmpty(lemma, pos, defZh, zhSource)   || wroteAny;
        if (domainCache) wroteAny = domainCache.setIfEmpty(lemma, pos, defZh, zhSource) || wroteAny;
      }
      if (cefrKnown && !wc.getChinese(lemma, pos)) {
        wc.setChinese(lemma, pos, defZh, zhSource);
        wroteAny = true;
      }
    } else {
      // ── zh：cache → CSV，source 優先序保護 ────────────────────────────────
      if (defZhSrcColIdx !== undefined && !canFillFromCache(defZhSrc)) {
        zhBlocked = true;  // source 較高（deepl/csv 等），跳過不覆蓋
      } else {
        let cached: string | null = null;
        let cachedSrc: string | null = null;
        if (bookCache && !cached) {
          cached = bookCache.get(lemma, pos);
          if (cached) cachedSrc = bookCache.getSource(lemma, pos);
        }
        if (domainCache && !cached) {
          cached = domainCache.get(lemma, pos);
          if (cached) cachedSrc = domainCache.getSource(lemma, pos);
        }
        if (!cached) {
          cached = wc.getChinese(lemma, pos);
          if (cached) cachedSrc = wc.getChineseSource(lemma, pos);
        }

        if (cached) {
          const maxIdx = Math.max(defZhColIdx, defZhSrcColIdx ?? 0);
          while (rows[i].length <= maxIdx) rows[i].push('');
          rows[i][defZhColIdx] = cached;
          if (defZhSrcColIdx !== undefined) rows[i][defZhSrcColIdx] = cachedSrc || 'cache';
          filledAny = true;
          csvDirty  = true;
        }
      }
    }

    // ── en：CSV → cache ──────────────────────────────────────────────────────
    if (defEn && defEnColIdx !== undefined) {
      const enSource = defEnSrc || 'csv';
      if (!cefrKnown) {
        if (bookCache)   wroteAny = bookCache.setEnIfEmpty(lemma, pos, defEn, enSource)   || wroteAny;
        if (domainCache) wroteAny = domainCache.setEnIfEmpty(lemma, pos, defEn, enSource) || wroteAny;
      }
      if (cefrKnown && !wc.get(lemma, pos)) {
        wc.setCache(lemma, pos, defEn, enSource);
        wroteAny = true;
      }
    } else if (defEnColIdx !== undefined) {
      // ── en：cache → CSV ────────────────────────────────────────────────────
      let cachedEn: string | null = null;
      let cachedEnSrc: string | null = null;
      if (bookCache) {
        cachedEn    = bookCache.getEn(lemma, pos);
        if (cachedEn) cachedEnSrc = bookCache.getEnSource(lemma, pos);
      }
      if (!cachedEn && domainCache) {
        cachedEn    = domainCache.getEn(lemma, pos);
        if (cachedEn) cachedEnSrc = domainCache.getEnSource(lemma, pos);
      }
      if (!cachedEn) {
        cachedEn    = wc.get(lemma, pos)?.def ?? null;
        if (cachedEn) cachedEnSrc = wc.getEnSource(lemma, pos);
      }

      if (cachedEn) {
        const maxIdx = Math.max(defEnColIdx, defEnSrcColIdx ?? 0);
        while (rows[i].length <= maxIdx) rows[i].push('');
        rows[i][defEnColIdx] = cachedEn;
        if (defEnSrcColIdx !== undefined) rows[i][defEnSrcColIdx] = cachedEnSrc || 'cache';
        filledAny = true;
        csvDirty  = true;
      }
    }

    // ── word_zh：CSV → cache / cache → CSV（global only，無 domain/book 分層）──
    const wordZhVal    = wrdZhColIdx    !== undefined ? get(rows[i], 'word_zh').trim()        : '';
    const wordZhSrcVal = wrdZhSrcColIdx !== undefined ? get(rows[i], 'word_zh_source').trim() : '';
    if (wordZhVal && wrdZhColIdx !== undefined) {
      if (cefrKnown && !wc.getWordZh(lemma, pos)) {
        wc.setWordZhIfEmpty(lemma, pos, wordZhVal, wordZhSrcVal || 'csv');
        wroteAny = true;
      }
    } else if (wrdZhColIdx !== undefined && !wordZhVal) {
      if (!(wrdZhSrcColIdx !== undefined && !canFillFromCache(wordZhSrcVal))) {
        const cachedWordZh = wc.getWordZh(lemma, pos);
        if (cachedWordZh) {
          const maxIdx = Math.max(wrdZhColIdx, wrdZhSrcColIdx ?? 0);
          while (rows[i].length <= maxIdx) rows[i].push('');
          rows[i][wrdZhColIdx] = cachedWordZh;
          if (wrdZhSrcColIdx !== undefined) rows[i][wrdZhSrcColIdx] = wc.getWordZhSource(lemma, pos) || 'cache';
          filledAny = true;
          csvDirty  = true;
        }
      }
    }

    // ── counters ─────────────────────────────────────────────────────────────
    if (wroteAny) {
      savedToCache++;
      onProgress?.(i + 1, rows.length, 'saved');
    } else if (filledAny) {
      filledFromCache++;
      onProgress?.(i + 1, rows.length, 'filled');
    } else if ((defZh || defEn || wordZhVal) && !zhBlocked) {
      // zh/en/word_zh 有值但快取已存在（setIfEmpty 略過）
      skippedCache++;
      onProgress?.(i + 1, rows.length, 'skip');
    } else {
      // 空值、快取無命中，或 zh 被 source 優先序攔截
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
  domainCache?.flush();
  bookCache?.flush();
  return { savedToCache, skippedCache, filledFromCache, noMatch, outputPath: csvPath };
}

// ── pushCsvToCache：強制將 CSV 所有值蓋入快取（CSV 優先，不檢查既有值）─────────

export interface PushCacheResult {
  pushed:  number;  // 至少一欄寫入快取的列數
  skipped: number;  // 所有翻譯欄皆為空的列數
  noMatch: number;  // 無 lemma 的列數
  outputPath: string;
}

/**
 * 強制將 beginner words CSV 的 definition_zh / definition_en / word_zh 覆寫入快取。
 * 僅單向（CSV → cache），不從 cache 補填 CSV。
 * CEFR 已知詞 → global；UNKNOWN → domain / book（若有設定）。
 */
export function pushCsvToCache(
  csvPath: string,
  onProgress?: (current: number, total: number) => void,
  config?: FillDefZhConfig,
): PushCacheResult {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) {
    return { pushed: 0, skipped: 0, noMatch: 0, outputPath: csvPath };
  }

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
  const rows = lines.slice(1).map(l => parseRow(l));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  const defZhColIdx    = idx['definition_zh'];
  const defZhSrcColIdx = idx['definition_zh_source'];
  const defEnColIdx    = idx['definition_en'];
  const defEnSrcColIdx = idx['definition_en_source'];
  const wrdZhColIdx    = idx['word_zh'];
  const wrdZhSrcColIdx = idx['word_zh_source'];

  if (defZhColIdx === undefined) {
    return { pushed: 0, skipped: 0, noMatch: rows.length, outputPath: csvPath };
  }

  const wc = getWordCache();
  const domainCache = config?.domain ? new DefinitionLayerCache(wc.cacheDir, 'domain', config.domain) : null;
  const bookCache   = config?.book   ? new DefinitionLayerCache(wc.cacheDir, 'book',   config.book)   : null;

  let pushed  = 0;
  let skipped = 0;
  let noMatch = 0;

  for (let i = 0; i < rows.length; i++) {
    const lemma     = get(rows[i], 'lemma').trim();
    const pos       = get(rows[i], 'pos').trim() || null;
    const defZh     = get(rows[i], 'definition_zh').trim();
    const defZhSrc  = defZhSrcColIdx !== undefined ? get(rows[i], 'definition_zh_source').trim() : '';
    const defEn     = defEnColIdx    !== undefined ? get(rows[i], 'definition_en').trim()        : '';
    const defEnSrc  = defEnSrcColIdx !== undefined ? get(rows[i], 'definition_en_source').trim() : '';
    const wordZhVal = wrdZhColIdx    !== undefined ? get(rows[i], 'word_zh').trim()              : '';
    const wordZhSrc = wrdZhSrcColIdx !== undefined ? get(rows[i], 'word_zh_source').trim()       : '';
    const cefrLevel = get(rows[i], 'cefr_level').trim();

    if (!lemma) { noMatch++; onProgress?.(i + 1, rows.length); continue; }

    const cefrKnown = cefrLevel && cefrLevel !== 'UNKNOWN';
    let wrote = false;

    if (defZh) {
      const zhSrc = defZhSrc || 'csv';
      if (cefrKnown) {
        wc.setChinese(lemma, pos, defZh, zhSrc);
        wrote = true;
      } else {
        if (bookCache)   { bookCache.set(lemma, pos, defZh, zhSrc);   wrote = true; }
        if (domainCache) { domainCache.set(lemma, pos, defZh, zhSrc); wrote = true; }
      }
    }

    if (defEn && defEnColIdx !== undefined) {
      const enSrc = defEnSrc || 'csv';
      if (cefrKnown) {
        wc.setCache(lemma, pos, defEn, enSrc);
        wrote = true;
      } else {
        if (bookCache)   { bookCache.setEn(lemma, pos, defEn, enSrc);   wrote = true; }
        if (domainCache) { domainCache.setEn(lemma, pos, defEn, enSrc); wrote = true; }
      }
    }

    if (wordZhVal && wrdZhColIdx !== undefined) {
      wc.setWordZh(lemma, pos, wordZhVal, wordZhSrc || 'csv');
      wrote = true;
    }

    if (wrote) pushed++; else skipped++;
    onProgress?.(i + 1, rows.length);
  }

  wc.flush();
  domainCache?.flush();
  bookCache?.flush();
  return { pushed, skipped, noMatch, outputPath: csvPath };
}

// ── pushSentCacheFromCsv：強制將 CSV 例句翻譯蓋入 sentence-cache（單向）────────

export interface PushSentCacheResult {
  pushed:  number;  // 值有變動、實際寫入快取的列數
  same:    number;  // 快取已有相同值、略過的列數
  empty:   number;  // context_sentence_zh 為空的列數
  noSent:  number;  // context_sentence 也為空的列數
  outputPath: string;
}

/**
 * 強制將 beginner words CSV 的 context_sentence_zh 覆寫入 sentence-cache.json，
 * 不做優先序保護（CSV 內容一律勝出）。僅單向（CSV → cache），不補填 CSV。
 */
export function pushSentCacheFromCsv(
  csvPath: string,
  onProgress?: (current: number, total: number) => void,
): PushSentCacheResult {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) {
    return { pushed: 0, same: 0, empty: 0, noSent: 0, outputPath: csvPath };
  }

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i])) as Record<string, number>;
  const rows = lines.slice(1).map(l => parseRow(l));
  const get = (cols: string[], col: string) => cols[idx[col]] ?? '';

  const sentEnColIdx    = idx['context_sentence'];
  const sentZhColIdx    = idx['context_sentence_zh'];
  const sentZhSrcColIdx = idx['context_sentence_zh_source'];

  if (sentEnColIdx === undefined || sentZhColIdx === undefined) {
    return { pushed: 0, same: 0, empty: rows.length, noSent: 0, outputPath: csvPath };
  }

  const wc = getWordCache();
  let pushed = 0;
  let same   = 0;
  let empty  = 0;
  let noSent = 0;

  for (let i = 0; i < rows.length; i++) {
    const enSent = get(rows[i], 'context_sentence').trim();
    const zhSent = get(rows[i], 'context_sentence_zh').trim();
    const zhSrc  = sentZhSrcColIdx !== undefined ? get(rows[i], 'context_sentence_zh_source').trim() : '';

    if (!enSent) { noSent++; onProgress?.(i + 1, rows.length); continue; }
    if (!zhSent) { empty++;  onProgress?.(i + 1, rows.length); continue; }

    const changed = wc.setSentenceZhForce(enSent, zhSent, zhSrc || 'csv');
    if (changed) pushed++; else same++;
    onProgress?.(i + 1, rows.length);
  }

  wc.flush();
  return { pushed, same, empty, noSent, outputPath: csvPath };
}
