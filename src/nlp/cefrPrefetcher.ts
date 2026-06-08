import * as fs from 'fs';
import * as path from 'path';
import { getWordCache } from './wordCache';

const CEFR_PATH = path.join(__dirname, '../data/cefr-wordlist.json');
const MW_API    = 'https://www.dictionaryapi.com/api/v3/references/learners/json';

interface MWEntry {
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

    // 已有任何快取（dict 或 cache，含 POS-agnostic key）→ 跳過
    const hit = wc.get(word, null);
    if (hit) {
      skippedCount++;
      onProgress?.(i + 1, cefrWords.length, {
        word,
        source: hit.tier === 'dict' ? 'dict' : 'cached',
      });
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

      // 每個 POS entry 各存一筆（run:verb, run:noun, …）
      let firstFormatted: string | null = null;
      for (const entry of entries) {
        const def = entry.shortdef?.find(isUsable);
        if (!def || !entry.fl) continue;
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
    } catch {
      failedCount++;
      onProgress?.(i + 1, cefrWords.length, { word, source: 'error' });
    }
  }

  wc.flush();
  return { totalCount: cefrWords.length, fetchedCount, skippedCount, failedCount };
}
