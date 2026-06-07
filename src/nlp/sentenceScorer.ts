import { GlobalFreqEntry } from './types';

export interface ScoredSentence {
  sentence: string;
  score: number;
  chunkIndex: number;
  chapter?: string;
  id: string;
}

function scoreSentence(sentence: string, targetLemma: string, targetOriginal: string): number {
  let score = 0;

  // Length: 30-100 chars is ideal for a learning card
  const len = sentence.length;
  if (len >= 30 && len <= 100) score += 5;
  else if (len >= 15 && len <= 200) score += 3;
  else score += 1;

  // Target word not at the very start or end (richer context when it's in the middle)
  const lower = sentence.toLowerCase();
  const wordPos = lower.indexOf(targetLemma) !== -1
    ? lower.indexOf(targetLemma)
    : lower.indexOf(targetOriginal.toLowerCase());
  if (wordPos > 0) {
    const relPos = wordPos / sentence.length;
    if (relPos > 0.1 && relPos < 0.85) score += 2;
  }

  // Complete sentence (starts with capital, ends with terminal punctuation)
  if (/^[A-Z]/.test(sentence) && /[.!?]$/.test(sentence)) score += 2;

  // Too many quotation marks = dialogue without context, harder for beginners
  const quoteCount = (sentence.match(/"/g) ?? []).length;
  if (quoteCount > 2) score -= 2;

  return score;
}

export function selectBestSentence(entry: GlobalFreqEntry): ScoredSentence {
  if (entry.occurrences.length === 0) {
    return { sentence: '', score: 0, chunkIndex: 0, id: '' };
  }

  let best: ScoredSentence = {
    sentence: entry.occurrences[0].sentence,
    score: -Infinity,
    chunkIndex: entry.occurrences[0].chunkIndex,
    chapter: entry.occurrences[0].chapter,
    id: entry.occurrences[0].id,
  };

  for (const occ of entry.occurrences) {
    const score = scoreSentence(occ.sentence, entry.lemma, entry.original);
    if (score > best.score) {
      best = {
        sentence: occ.sentence,
        score,
        chunkIndex: occ.chunkIndex,
        chapter: occ.chapter,
        id: occ.id,
      };
    }
  }

  return best;
}
