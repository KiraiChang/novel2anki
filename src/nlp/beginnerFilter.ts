import { GlobalFreqEntry, GlobalFreqMap } from './types';
import { STOP_WORDS } from './stopWords';

const CONTENT_POS = new Set([
  'Noun', 'Verb', 'Adjective', 'Adverb',
  'Plural', 'Singular', 'Infinitive', 'PastTense', 'Gerund',
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
    } else if (!CONTENT_POS.has(entry.pos)) {
      reason = 'content-pos';
    }

    if (reason) {
      rejected.push({ lemma: entry.lemma, reason });
    } else {
      kept.push(entry);
    }
  }

  return { kept, rejected };
}
