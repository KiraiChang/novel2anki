import * as fs from 'fs';
import * as path from 'path';
import { resolveDataPath } from './dataPath';

/**
 * 載入 JSON 格式的正規化對照表（{ "yer": "your", "'tis": "it is" }）。
 * key / value 統一以原始大小寫儲存；套用時以 case-insensitive regex 比對。
 */
export function loadNormalizeFile(filePath: string): Map<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, string>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/**
 * 讀取內建古語/方言對照表（archaic-en.json）。
 * 查找順序：$WORD_CACHE_PATH/archaic-en.json → src/data/archaic-en.json
 */
export function loadArchaicMap(): Map<string, string> {
  const filePath = resolveDataPath('archaic-en.json');
  return loadNormalizeFile(filePath);
}

/**
 * 在指定目錄找 *-normalize.json（取第一個命中）。
 * slug 已知時優先比對 {slug}-normalize.json，避免多書共用目錄時誤讀。
 */
export function findNormalizeFile(dir: string, slug?: string): string | null {
  try {
    const files = fs.readdirSync(dir);
    if (slug) {
      const exact = `${slug}-normalize.json`;
      if (files.includes(exact)) return path.join(dir, exact);
    }
    const found = files.find(f => f.endsWith('-normalize.json'));
    return found ? path.join(dir, found) : null;
  } catch {
    return null;
  }
}

/**
 * 從 CSV 檔名推導 slug（the-demon-awakens-beginner-words-part-01.csv → the-demon-awakens）。
 * 找不到 beginner-words 模式時回傳 null。
 */
export function slugFromCsvPath(csvPath: string): string | null {
  const base = path.basename(csvPath, '.csv');
  const m = base.match(/^(.+?)-beginner-words/);
  return m ? m[1] : null;
}

/**
 * 對句子套用正規化替換：
 * - 以非字母邊界（(?<![a-zA-Z]) / (?![a-zA-Z])）比對，可處理 'tis（開頭有 '）
 * - case-insensitive；替換值保持小寫（tokenize 後統一處理大小寫）
 */
export function applyNormalization(text: string, map: Map<string, string>): string {
  let result = text;
  for (const [from, to] of map) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?<![a-zA-Z])${escaped}(?![a-zA-Z])`, 'gi');
    result = result.replace(pattern, to);
  }
  return result;
}

export interface NormalizeFileResult {
  outputPath: string;
  /** 命中內建古語表、自動寫入的條目 */
  matched: Array<{ from: string; to: string; count: number }>;
  /** UNKNOWN 高頻詞（未在古語表中，供人工判斷） */
  suggestions: Array<{ lemma: string; count: number }>;
}

/**
 * 依據本次掃描的 UNKNOWN 詞彙，對照 archaic map 產生/更新 {slug}-normalize.json。
 * - 已存在的條目保留（不覆蓋人工修改）
 * - 新命中古語表的詞自動補入
 * - 回傳命中清單與高頻未命中建議清單（頻率 >= minSuggestionFreq）
 */
export function exportNormalizeFile(
  unknownWords: Map<string, number>,
  archaicMap: Map<string, string>,
  outputPath: string,
  minSuggestionFreq = 3,
): NormalizeFileResult {
  // 讀取現有設定（保留人工修改）
  const existing = loadNormalizeFile(outputPath);

  const matched: NormalizeFileResult['matched'] = [];
  const suggestions: NormalizeFileResult['suggestions'] = [];

  for (const [lemma, count] of unknownWords) {
    const canonical = lemma.toLowerCase();
    if (archaicMap.has(canonical)) {
      matched.push({ from: canonical, to: archaicMap.get(canonical)!, count });
      if (!existing.has(canonical)) {
        existing.set(canonical, archaicMap.get(canonical)!);
      }
    } else if (count >= minSuggestionFreq) {
      suggestions.push({ lemma, count });
    }
  }

  // 依 key 排序寫出，保持 JSON 易讀
  const sorted = Object.fromEntries(
    [...existing.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(sorted, null, 2), 'utf-8');

  matched.sort((a, b) => b.count - a.count);
  suggestions.sort((a, b) => b.count - a.count);

  return { outputPath, matched, suggestions };
}
