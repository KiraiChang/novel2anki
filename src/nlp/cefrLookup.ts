import cefrData from '../data/cefr-wordlist.json';
import { CefrLevel, VocabSuggestion } from './types';
import { FreqEntry } from './freqAnalyzer';

// 模組載入時一次性建立查詢 Map（O(1) 查詢）
const CEFR_MAP: Map<string, CefrLevel> = new Map(
  Object.entries(cefrData as Record<string, string>) as [string, CefrLevel][]
);

export function lookupCefrLevel(lemma: string): CefrLevel | undefined {
  return CEFR_MAP.get(lemma.toLowerCase());
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
