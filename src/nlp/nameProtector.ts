import * as fs from 'fs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nlp = require('compromise') as (text: string) => {
  people: () => { out: (fmt: 'array') => string[] };
  match: (pattern: string) => { out: (fmt: 'array') => string[] };
};

// 常見非人名的大寫詞（語法必要或句首大寫，排除在保護範圍外）
export const NAME_SKIP = new Set([
  'I', 'Oh', 'Ah', 'Yes', 'No', 'Ok', 'OK', 'God', 'Lord', 'Sir', 'Lady',
  'Mr', 'Mrs', 'Ms', 'Dr', 'The', 'This', 'That', 'These', 'Those',
  'There', 'Here', 'My', 'Your', 'His', 'Her', 'Our', 'Their', 'Its',
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
        if (clean.length > 1 && !NAME_SKIP.has(clean)) names.add(clean);
      }
    }
    // mid-sentence 大寫詞（從索引 1 起，跳過句首）
    const tokens = sentence.split(/\s+/);
    for (let i = 1; i < tokens.length; i++) {
      const clean = tokens[i].replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
      if (clean.length > 1 && /^[A-Z]/.test(clean) && !NAME_SKIP.has(clean)) {
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

// 翻譯後將 __PERSON_N__ 還原為原始人名
export function restoreNames(
  translated: string,
  restoreMap: Array<[string, string]>,
): string {
  let result = translated;
  for (const [placeholder, original] of restoreMap) {
    result = result.replace(new RegExp(escapeRegex(placeholder), 'g'), original);
  }
  return result;
}

// ── 人名檔 I/O ───────────────────────────────────────────────────────────────

const FILE_HEADER = [
  '# 初學者模式偵測到的人名與專有名詞',
  '# 可自行新增、刪除或修改，每行一個名詞',
  '# 翻譯時這些詞彙將以佔位符保護，不會被 DeepL 翻譯',
  '#',
].join('\n');

export function saveNamesFile(names: Set<string>, filePath: string): void {
  const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));
  const content = FILE_HEADER + '\n' + sorted.join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function loadNamesFile(filePath: string): Set<string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) names.add(trimmed);
  }
  return names;
}
