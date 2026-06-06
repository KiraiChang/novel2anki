import { TokenInfo } from './types';

const CONTENT_POS = new Set(['Noun', 'Verb', 'Adjective', 'Adverb', 'Plural', 'Singular', 'Infinitive', 'PastTense', 'Gerund']);

export interface FreqEntry {
  count: number;
  pos: string;
  original: string;
}

export function analyzeFrequency(
  tokens: TokenInfo[],
  stopWords: Set<string>
): Map<string, FreqEntry> {
  const freq = new Map<string, FreqEntry>();

  for (const token of tokens) {
    const lemma = token.lemma;

    if (lemma.length < 4) continue;
    if (stopWords.has(lemma)) continue;
    if (!CONTENT_POS.has(token.pos)) continue;
    if (!/^[a-z]+$/.test(lemma)) continue; // 只保留純字母

    const existing = freq.get(lemma);
    if (existing) {
      existing.count++;
    } else {
      freq.set(lemma, { count: 1, pos: token.pos, original: token.original });
    }
  }

  return freq;
}
