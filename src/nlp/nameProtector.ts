import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nlp = require('compromise') as (text: string) => {
  people: () => { out: (fmt: 'array') => string[] };
  match: (pattern: string) => { out: (fmt: 'array') => string[] };
};

// 常見非人名的詞（語法必要詞、代名詞、限定詞、宗教/軍事頭銜），以小寫儲存，比對時統一轉小寫
export const NAME_SKIP = new Set([
  // 感嘆詞 / 語氣詞
  'i', 'oh', 'ah', 'yes', 'no', 'ok',
  // 敬稱縮寫
  'mr', 'mrs', 'ms', 'dr', 'st',
  // 宗教頭銜（讓翻譯後端正確翻譯為神父／院長等）
  'father', 'abbot', 'brother', 'sister', 'friar', 'monk', 'nun',
  'bishop', 'archbishop', 'cardinal', 'pope', 'deacon', 'priest', 'pastor',
  'saint', 'god', 'lord',
  // 軍事／封建頭銜
  'sir', 'lady', 'king', 'queen', 'prince', 'princess',
  'duke', 'duchess', 'baron', 'earl', 'count', 'countess',
  'captain', 'general', 'sergeant', 'lieutenant', 'colonel',
  'knight', 'master', 'elder', 'ranger',
  // 指示詞 / 限定詞
  'the', 'this', 'that', 'these', 'those', 'there', 'here',
  // 人稱代名詞（主格、受格、所有格、反身）
  'he', 'she', 'they', 'we', 'you', 'it',
  'him', 'her', 'them', 'us', 'me',
  'his', 'my', 'your', 'our', 'their', 'its',
  'himself', 'herself', 'themselves', 'ourselves', 'yourself', 'itself',
  // 關係代名詞 / 疑問詞
  'who', 'whom', 'whose', 'what', 'which',
]);

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 從句子集合建立專有名詞集：compromise NER + mid-sentence 大寫詞雙重偵測
export function buildProperNounSet(sentences: string[]): Set<string> {
  const names = new Set<string>();
  for (const sentence of sentences) {
    const doc = nlp(sentence);
    const detected: string[] = [
      ...doc.people().out('array'),
      ...doc.match('#ProperNoun').out('array'),
    ];
    for (const phrase of detected) {
      for (const word of phrase.split(/\s+/)) {
        const clean = word.replace(/[^a-zA-Z'-]/g, '');
        if (clean.length > 1 && !NAME_SKIP.has(clean.toLowerCase())) names.add(clean);
      }
    }
    // mid-sentence 大寫詞（從索引 1 起，跳過句首）
    const tokens = sentence.split(/\s+/);
    for (let i = 1; i < tokens.length; i++) {
      const clean = tokens[i].replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
      if (clean.length > 1 && /^[A-Z]/.test(clean) && !NAME_SKIP.has(clean.toLowerCase())) {
        names.add(clean);
      }
    }
  }
  return names;
}

// 將句子中的專有名詞替換為 __PERSON_N__ 佔位符，回傳還原表
export function protectNames(
  sentence: string,
  properNouns: Set<string>,
): { text: string; restoreMap: Array<[string, string]> } {
  if (properNouns.size === 0) return { text: sentence, restoreMap: [] };
  const sorted = Array.from(properNouns).sort((a, b) => b.length - a.length);
  const restoreMap: Array<[string, string]> = [];
  let text = sentence;
  let idx = 0;
  for (const name of sorted) {
    const placeholder = `__PERSON_${idx}__`;
    const replaced = text.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, 'g'), placeholder);
    if (replaced !== text) {
      text = replaced;
      restoreMap.push([placeholder, name]);
      idx++;
    }
  }
  return { text, restoreMap };
}

/**
 * 翻譯後將 __PERSON_N__ 還原。
 * translationMap 為 `loadNamesFile` 回傳的映射表：
 *   - 有中文值（非空）→ 還原為中文音譯
 *   - 無中文值（空字串）→ 還原為英文原名
 */
export function restoreNames(
  translated: string,
  restoreMap: Array<[string, string]>,
  translationMap?: Map<string, string>,
): string {
  let result = translated;
  for (const [placeholder, original] of restoreMap) {
    const zh = translationMap?.get(original);
    const replacement = (zh && zh.length > 0) ? zh : original;
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), replacement);
  }
  return result;
}

// ── 人名檔 I/O ───────────────────────────────────────────────────────────────

const FILE_HEADER = [
  '# 初學者模式偵測到的人名與專有名詞',
  '# 格式一：只保護（翻譯後保留英文原名）',
  '#   Elbryan',
  '# 格式二：指定中文音譯（翻譯後替換為中文）',
  '#   Markwart: 馬克瓦特',
  '# 可自行新增、刪除或修改，每行一個名詞',
  '#',
].join('\n');

/**
 * 儲存人名檔。若檔案已存在，保留現有條目（含中文 mapping），只補入新增名詞。
 * 回傳實際寫入的名詞總數。
 */
export function saveNamesFile(names: Set<string>, filePath: string): number {
  const existing = fs.existsSync(filePath) ? loadNamesFile(filePath) : new Map<string, string>();
  for (const name of names) {
    if (!existing.has(name)) existing.set(name, '');
  }
  const sorted = Array.from(existing.entries()).sort(([a], [b]) => a.localeCompare(b));
  const lines = sorted.map(([en, zh]) => zh ? `${en}: ${zh}` : en);
  fs.writeFileSync(filePath, FILE_HEADER + '\n' + lines.join('\n') + '\n', 'utf-8');
  return existing.size;
}

/**
 * 讀取人名檔，回傳 Map<英文名, 中文音譯（空字串代表無映射）>。
 * 支援舊格式（每行只有英文名）與新格式（`英文名: 中文音譯`）。
 */
export function loadNamesFile(filePath: string): Map<string, string> {
  const map = new Map<string, string>();
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const en = trimmed.slice(0, colonIdx).trim();
      const zh = trimmed.slice(colonIdx + 1).trim();
      if (en) map.set(en, zh);
    } else {
      map.set(trimmed, '');
    }
  }
  return map;
}
