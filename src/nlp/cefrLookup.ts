import * as fs from 'fs';
import { resolveDataPath } from './dataPath';
import { CefrLevel, VocabSuggestion } from './types';
import { FreqEntry } from './freqAnalyzer';

// 模組載入時一次性建立查詢 Map（O(1) 查詢）
let _cefrMap: Map<string, CefrLevel> | null = null;

function getCefrMap(): Map<string, CefrLevel> {
  if (!_cefrMap) {
    const filePath = resolveDataPath('cefr-wordlist.json');
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, string>;
    _cefrMap = new Map(Object.entries(raw) as [string, CefrLevel][]);
  }
  return _cefrMap;
}

// 衍生詞回退：若 lemma 本身查無結果，嘗試剝除常見後綴找基底詞
// 例：tightly→tight, blackness→black, movement→move, awaken→wake
const SUFFIXES: Array<[RegExp, string]> = [
  [/lly$/, 'l'],         // fully→full, dully→dull
  [/ly$/, ''],           // quickly→quick, tightly→tight
  [/ness$/, ''],         // blackness→black, darkness→dark
  [/ment$/, 'e'],        // movement→move, arrangement→arrange (try with e)
  [/ment$/, ''],         // movement→mov... fallback
  [/ation$/, 'e'],       // creation→create, formation→forme（試）
  [/ation$/, ''],        // relation→relat → probably won't match
  [/tion$/, ''],         // action→act, reaction→react
  [/tion$/, 'te'],       // addition→addite（fallback，通常沒用）
  [/ing$/, 'e'],         // caring→care, making→make
  [/ing$/, ''],          // knowing→know, burning→burn
  [/en$/, 'e'],          // widen→wide, darken→dark（try keeping e）
  [/en$/, ''],           // awaken→awak... fallback
  [/ful$/, ''],          // powerful→power, hopeful→hope
  [/less$/, ''],         // hopeless→hope, careless→care
  [/ous$/, 'e'],         // nervous→nerve（試）
  [/ous$/, ''],          // dangerous→danger, joyous→joy
  [/ish$/, ''],          // childish→child, foolish→fool
  [/ive$/, 'e'],         // creative→create, active→act（試）
  [/ive$/, ''],          // active→act
  [/er$/, 'e'],          // later→late, wider→wide（試）
  [/er$/, ''],           // runner→run, fighter→fight
  [/est$/, ''],          // greatest→great（最高級，lemmatizer 通常已處理）
  [/ened$/, ''],         // happened... 很少用
  [/ward$/, ''],         // outward→out, forward→for（通常無意義）
];

export function lookupCefrLevel(lemma: string): CefrLevel | undefined {
  const map = getCefrMap();
  const word = lemma.toLowerCase();
  const direct = map.get(word);
  if (direct) return direct;

  // 衍生詞回退：剝除後綴後查詢
  for (const [suffix, replacement] of SUFFIXES) {
    if (!suffix.test(word)) continue;
    const base = word.replace(suffix, replacement);
    if (base.length < 3) continue;
    const found = map.get(base);
    if (found) return found;
  }
  return undefined;
}

const LEARNING_LEVELS: Set<CefrLevel> = new Set(['B1', 'B2', 'C1', 'C2']);

export function generateVocabSuggestions(
  freqMap: Map<string, FreqEntry>,
  maxCount = 10
): VocabSuggestion[] {
  const suggestions: VocabSuggestion[] = [];

  for (const [lemma, entry] of freqMap) {
    const cefrLevel = lookupCefrLevel(lemma);
    if (!cefrLevel || !LEARNING_LEVELS.has(cefrLevel)) continue;

    suggestions.push({
      word: lemma,
      original: entry.original,
      cefrLevel,
      frequency: entry.count,
      pos: entry.pos,
    });
  }

  // 詞頻降序排列，相同詞頻時 C1/C2 優先（較有學習價值）
  const levelOrder: Record<CefrLevel, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };
  suggestions.sort((a, b) =>
    b.frequency !== a.frequency
      ? b.frequency - a.frequency
      : levelOrder[b.cefrLevel] - levelOrder[a.cefrLevel]
  );

  return suggestions.slice(0, maxCount);
}
