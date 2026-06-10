import { GlobalFreqEntry, GlobalFreqMap } from './types';
import { STOP_WORDS } from './stopWords';

const CONTENT_POS = new Set([
  'Noun', 'Verb', 'Adjective', 'Adverb',
  'Plural', 'Singular', 'Infinitive', 'PastTense', 'Gerund',
]);

// 語意介系詞白名單：這些介系詞帶有明確方位/關係語意，初學者值得學習。
// stopWords 已排除 about/into/over/around/through/within/without/during/despite/toward/upon 等，
// 此處只列出 stopWords 未涵蓋、需主動保留的語意介系詞。
const SEMANTIC_PREPOSITIONS = new Set([
  'against', 'amid', 'amidst', 'beneath', 'beyond',
  'beside', 'besides', 'except', 'unlike', 'via',
  'across', 'along', 'among', 'amongst', 'opposite',
  'underneath', 'versus',
]);

export interface FilterOptions {
  includeA1?: boolean;
  minFreq?: number;
}

export interface FilterResult {
  kept: GlobalFreqEntry[];
  rejected: Array<{ lemma: string; reason: string }>;
}

export function applyBeginnerFilters(
  freqMap: GlobalFreqMap,
  options: FilterOptions = {}
): FilterResult {
  const { includeA1 = false, minFreq = 2 } = options;
  const kept: GlobalFreqEntry[] = [];
  const rejected: Array<{ lemma: string; reason: string }> = [];

  for (const entry of freqMap.values()) {
    let reason: string | null = null;

    // Proper-noun detection: capitalized in >70% of mid-sentence occurrences
    const midSentenceOccurrences = entry.occurrences.filter(o => o.tokenIndex > 0).length;
    const isProperNoun = midSentenceOccurrences >= 3
      && (entry.midSentenceCapitalCount / midSentenceOccurrences) > 0.7;

    if (entry.lemma.length < 3) {
      reason = 'too-short';
    } else if (!/^[a-z]+$/.test(entry.lemma)) {
      reason = 'alpha-only';
    } else if (STOP_WORDS.has(entry.lemma)) {
      reason = 'not-stopword';
    } else if (!includeA1 && entry.cefrLevel === 'A1') {
      reason = 'not-A1';
    } else if (entry.globalCount < minFreq) {
      reason = 'not-hapax';
    } else if (!CONTENT_POS.has(entry.pos) &&
               !(entry.pos === 'Preposition' && SEMANTIC_PREPOSITIONS.has(entry.lemma))) {
      reason = 'content-pos';
    } else if (isProperNoun) {
      reason = 'proper-noun';
    }

    if (reason) {
      rejected.push({ lemma: entry.lemma, reason });
    } else {
      kept.push(entry);
    }
  }

  return { kept, rejected };
}
