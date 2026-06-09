import * as fs from 'fs';
import * as path from 'path';
import { getWordCache } from './wordCache';
import { batchTranslate, DeepLConfig } from '../cards/deeplTranslator';

const CEFR_PATH = path.join(__dirname, '../data/cefr-wordlist.json');
const MW_API    = 'https://www.dictionaryapi.com/api/v3/references/learners/json';

interface MWEntry {
  meta?: { id?: string };
  fl?: string;
  shortdef?: string[];
}

const isUsable = (def: string) =>
  def.length >= 10 && !/^(see|compare|synonym of)/i.test(def.trim());

export interface PrefetchProgress {
  word: string;
  source: 'dict' | 'cached' | 'MW' | 'no-def' | 'error' | 'no-key';
}

export interface PrefetchResult {
  totalCount:   number;
  fetchedCount: number;
  skippedCount: number;
  failedCount:  number;
}

/**
 * 批次預查 CEFR 字庫的 MW 英文定義，結果存入 word-cache.json。
 * 已有快取的詞自動跳過，可中斷後重跑。
 * @param onProgress 進度回呼
 * @param _words 覆寫詞列表（測試用，省略時從內建 CEFR 字庫讀取）
 */
export async function prefetchCefrToWordCache(
  onProgress?: (done: number, total: number, meta: PrefetchProgress) => void,
  _words?: string[],
): Promise<PrefetchResult> {
  const cefrWords = _words ?? Object.keys(
    JSON.parse(fs.readFileSync(CEFR_PATH, 'utf-8')) as Record<string, string>,
  );

  const wc      = getWordCache();
  const mwKey   = process.env.MW_API_KEY;
  let fetchedCount = 0;
  let skippedCount = 0;
  let failedCount  = 0;

  for (let i = 0; i < cefrWords.length; i++) {
    const word = cefrWords[i];

    // dict 條目優先等級最高，永遠跳過
    const hit = wc.get(word, null);
    if (hit?.tier === 'dict') {
      skippedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'dict' });
      continue;
    }
    // 已有 POS-specific cache 條目 → 跳過（已正確取得）
    // 注意：只有 base key（word）而無 POS key 時仍繼續抓取（用於資料修復後重建）
    if (wc.hasPosCache(word)) {
      skippedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'cached' });
      continue;
    }

    if (!mwKey) {
      failedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'no-key' });
      continue;
    }

    try {
      const res = await fetch(
        `${MW_API}/${encodeURIComponent(word)}?key=${encodeURIComponent(mwKey)}`,
        { signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) {
        process.stderr.write(`\n[MW] HTTP ${res.status} "${word}"\n`);
        failedCount++;
        onProgress?.(i + 1, cefrWords.length, { word, source: 'error' });
        continue;
      }

      const raw = await res.json() as (MWEntry | string)[];
      const entries = raw.filter(
        (e): e is MWEntry => typeof e === 'object' && Array.isArray(e.shortdef) && e.shortdef.length > 0,
      );

      if (entries.length === 0) {
        failedCount++;
        onProgress?.(i + 1, cefrWords.length, { word, source: 'no-def' });
        continue;
      }

      // 每個 POS 只取第一筆 entry（MW 回傳複合詞時會有多筆同 POS，後者蓋前者）
      // meta.id 格式為 "word:N"（多音字）或 "word"；剝除 :N 後比對目標詞，過濾非本詞條目
      let firstFormatted: string | null = null;
      const storedPos = new Set<string>();
      for (const entry of entries) {
        const headId = (entry.meta?.id ?? '').replace(/:\d+$/, '').toLowerCase();
        if (headId && headId !== word.toLowerCase()) continue;
        if (!entry.fl || storedPos.has(entry.fl)) continue;
        const def = entry.shortdef?.find(isUsable);
        if (!def) continue;
        storedPos.add(entry.fl);
        const formatted = `(${entry.fl}) ${def}`;
        wc.setCache(word, entry.fl, formatted, 'MW');
        if (!firstFormatted) firstFormatted = formatted;
      }

      if (!firstFormatted) {
        failedCount++;
        onProgress?.(i + 1, cefrWords.length, { word, source: 'no-def' });
        continue;
      }

      // 額外存一筆無 POS key（word），讓 get(word, null) 可命中
      wc.setCache(word, null, firstFormatted, 'MW');

      fetchedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'MW' });
    } catch (e) {
      process.stderr.write(`\n[prefetch-cefr] "${word}" 錯誤：${(e as Error).message}\n`);
      failedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'error' });
    }
  }

  wc.flush();
  return { totalCount: cefrWords.length, fetchedCount, skippedCount, failedCount };
}

// ── CEFR 字庫中文批次預查 ─────────────────────────────────────────────────────

export interface PrefetchZhProgress {
  word: string;
  source: 'cached' | 'deepl' | 'no-en' | 'error';
}

export interface PrefetchZhResult {
  totalCount:   number;
  fetchedCount: number;
  skippedCount: number;
  noEnCount:    number;
  failedCount:  number;
}

const DEEPL_BATCH = 50;
const INTER_BATCH_DELAY_MS = 500;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 批次預查 CEFR 字庫的中文定義，結果存入 word-cache-zh.json。
 * 每個 POS 條目（word:noun / word:verb 等）各存一筆，並衍生一筆無 POS 的預設鍵（名詞優先）。
 * 已有中文快取的條目自動跳過，可中斷後重跑。
 * @param deeplConfig 翻譯設定（provider 決定 source 欄位）
 * @param onProgress 進度回呼
 * @param _words 覆寫詞列表（測試用）
 */
export async function prefetchCefrZhToWordCache(
  deeplConfig: DeepLConfig,
  onProgress?: (done: number, total: number, meta: PrefetchZhProgress) => void,
  _words?: string[],
): Promise<PrefetchZhResult> {
  const cefrWords = _words ?? Object.keys(
    JSON.parse(fs.readFileSync(CEFR_PATH, 'utf-8')) as Record<string, string>,
  );

  const wc       = getWordCache();
  const provider = deeplConfig.provider;
  let fetchedCount = 0;
  let skippedCount = 0;
  let noEnCount    = 0;
  let failedCount  = 0;

  // 每個需翻譯的 POS 條目為一筆 pending item
  const pending: Array<{ word: string; pos: string | null; enDef: string; wordIdx: number }> = [];
  // 需要在翻譯後衍生預設（無 POS）鍵的詞
  const wordsNeedingDefault = new Set<string>();

  for (let i = 0; i < cefrWords.length; i++) {
    const word       = cefrWords[i];
    const allEntries = wc.getAllCacheEntriesForWord(word);
    const posEntries = allEntries.filter(e => e.pos !== null);

    if (allEntries.length === 0) {
      noEnCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'no-en' });
      continue;
    }

    if (posEntries.length === 0) {
      // 舊格式：僅有無 POS 條目，沿用舊邏輯
      if (wc.hasChinese(word, null)) {
        skippedCount++;
        onProgress?.(i + 1, cefrWords.length, { word, source: 'cached' });
      } else {
        pending.push({ word, pos: null, enDef: allEntries[0].def, wordIdx: i });
      }
      continue;
    }

    const untranslatedPos = posEntries.filter(e => !wc.hasChinese(word, e.pos));
    const needDefault     = !wc.hasChinese(word, null);

    if (untranslatedPos.length === 0 && !needDefault) {
      skippedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'cached' });
      continue;
    }

    // 已有無 POS 基底翻譯（舊格式 migration 或衍生鍵）→ 複製至缺失的 POS 鍵，不重新呼叫 API
    const baseZh = wc.getChinese(word, null);
    if (baseZh && untranslatedPos.length > 0) {
      for (const e of untranslatedPos) {
        wc.setChinese(word, e.pos, baseZh, 'legacy:copied');
      }
      skippedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'cached' });
      continue;
    }

    for (const e of untranslatedPos) {
      pending.push({ word, pos: e.pos, enDef: e.def, wordIdx: i });
    }
    if (needDefault) wordsNeedingDefault.add(word);
  }

  // 本次翻譯結果的本地暫存（避免衍生預設鍵時需重查 mock）
  const localZh = new Map<string, string>(); // `word\0pos` → zh

  const wordsFetched = new Set<string>();
  const wordsFailed  = new Set<string>();

  // 分批翻譯
  for (let b = 0; b < pending.length; b += DEEPL_BATCH) {
    if (b > 0) await sleep(INTER_BATCH_DELAY_MS);
    const chunk = pending.slice(b, b + DEEPL_BATCH);
    try {
      const translated = await batchTranslate(chunk.map(c => c.enDef), deeplConfig);
      for (let j = 0; j < chunk.length; j++) {
        const { word, pos, wordIdx } = chunk[j];
        const zh = translated[j] ?? '';
        wc.setChinese(word, pos, zh, provider);
        localZh.set(`${word}\0${pos ?? ''}`, zh);
        if (!wordsFetched.has(word)) {
          wordsFetched.add(word);
          fetchedCount++;
          onProgress?.(wordIdx + 1, cefrWords.length, { word, source: 'deepl' });
        }
      }
    } catch (e) {
      const msg = (e as Error).message;
      process.stderr.write(`\n[prefetch-cefr-zh] 批次翻譯錯誤：${msg}\n`);
      for (const { word, wordIdx } of chunk) {
        if (!wordsFailed.has(word) && !wordsFetched.has(word)) {
          wordsFailed.add(word);
          failedCount++;
          onProgress?.(wordIdx + 1, cefrWords.length, { word, source: 'error' });
        }
      }
      // 速率限制（429）→ 停止剩餘批次，已譯資料由 flush() 寫盤
      if (msg.includes('429')) break;
    }
  }

  // 衍生預設（無 POS）鍵：名詞優先，否則取第一個 POS
  for (const word of wordsNeedingDefault) {
    if (wc.hasChinese(word, null)) continue;
    const posEntries = wc.getAllCacheEntriesForWord(word).filter(e => e.pos !== null);
    const chosenPos  = (posEntries.find(e => e.pos === 'noun') ?? posEntries[0])?.pos ?? null;
    if (!chosenPos) continue;
    const zh = localZh.get(`${word}\0${chosenPos}`)
      ?? (wc.hasChinese(word, chosenPos) ? wc.getChinese(word, chosenPos) : null);
    if (zh) wc.setChinese(word, null, zh, `${provider}:derived`);
  }

  wc.flush();
  return { totalCount: cefrWords.length, fetchedCount, skippedCount, noEnCount, failedCount };
}
