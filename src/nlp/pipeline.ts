import { Chunk } from '../cards/types';
import { EnrichedChunk, ChunkNLP, EMPTY_CHUNK_NLP } from './types';
import { cleanText } from './textCleaner';
import { tokenize } from './tokenizer';
import { lemmatize } from './lemmatizer';
import { analyzeFrequency } from './freqAnalyzer';
import { generateVocabSuggestions } from './cefrLookup';
import { STOP_WORDS } from './stopWords';

export function processChunk(chunk: Chunk): ChunkNLP {
  try {
    const cleaned = cleanText(chunk.text);
    if (!cleaned.trim()) return EMPTY_CHUNK_NLP;

    const rawTokens = tokenize(cleaned);
    const tokens = lemmatize(rawTokens);
    const freqMap = analyzeFrequency(tokens, STOP_WORDS);
    const vocabSuggestions = generateVocabSuggestions(freqMap);

    return { tokens, vocabSuggestions };
  } catch {
    return EMPTY_CHUNK_NLP;
  }
}

export function runNlpPipeline(chunks: Chunk[]): EnrichedChunk[] {
  return chunks.map(chunk => ({
    ...chunk,
    nlp: processChunk(chunk),
  }));
}
