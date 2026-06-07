import { Chunk } from '../cards/types';
import { GlobalFreqEntry, GlobalFreqMap, WordOccurrence } from './types';
import { cleanText } from './textCleaner';
import { tokenize } from './tokenizer';
import { lemmatize } from './lemmatizer';
import { lookupCefrLevel } from './cefrLookup';

function extractSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= 15 && s.length <= 400);
}

export interface GlobalFreqResult {
  freqMap: GlobalFreqMap;
  totalTokens: number;
}

export function buildGlobalFreqMap(
  chunks: Chunk[],
  onProgress?: (current: number, total: number) => void
): GlobalFreqResult {
  const freqMap: GlobalFreqMap = new Map();
  let totalTokens = 0;

  for (const chunk of chunks) {
    onProgress?.(chunk.index + 1, chunks.length);
    const cleaned = cleanText(chunk.text);
    if (!cleaned.trim()) continue;

    const sentences = extractSentences(cleaned);

    for (let sentIdx = 0; sentIdx < sentences.length; sentIdx++) {
      const sentence = sentences[sentIdx];
      const rawTokens = tokenize(sentence);
      const tokens = lemmatize(rawTokens);

      for (let tokIdx = 0; tokIdx < tokens.length; tokIdx++) {
        const token = tokens[tokIdx];
        const lemma = token.lemma;

        if (lemma.length < 3) continue;
        if (!/^[a-z]+$/.test(lemma)) continue;

        totalTokens++;

        const id = `chunk${String(chunk.index).padStart(3, '0')}_sent${sentIdx}_tok${tokIdx}`;
        const cefrLevel = lookupCefrLevel(lemma) ?? 'UNKNOWN';

        const occurrence: WordOccurrence = {
          id,
          chunkIndex: chunk.index,
          chapter: chunk.chapter,
          sentence,
          sentenceIndex: sentIdx,
          tokenIndex: tokIdx,
        };

        // Mid-sentence capitalization is a reliable proper-noun signal
        const isMidSentenceCapital = tokIdx > 0 && /^[A-Z]/.test(token.original);

        const existing = freqMap.get(lemma);
        if (existing) {
          existing.globalCount++;
          existing.occurrences.push(occurrence);
          if (isMidSentenceCapital) existing.midSentenceCapitalCount++;
        } else {
          freqMap.set(lemma, {
            lemma,
            original: token.original,
            pos: token.pos,
            cefrLevel,
            globalCount: 1,
            occurrences: [occurrence],
            midSentenceCapitalCount: isMidSentenceCapital ? 1 : 0,
          });
        }
      }
    }
  }

  return { freqMap, totalTokens };
}
