export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface TokenInfo {
  original: string;
  normal: string;
  lemma: string;
  pos: string;
}

export interface VocabSuggestion {
  word: string;
  original: string;
  cefrLevel: CefrLevel;
  frequency: number;
  pos: string;
}

export interface ChunkNLP {
  tokens: TokenInfo[];
  vocabSuggestions: VocabSuggestion[];
}

export interface EnrichedChunk {
  index: number;
  text: string;
  chapter?: string;
  nlp: ChunkNLP;
}

export const EMPTY_CHUNK_NLP: ChunkNLP = { tokens: [], vocabSuggestions: [] };

export interface WordOccurrence {
  id: string;           // "chunk042_sent3_tok7"
  chunkIndex: number;
  chapter?: string;
  sentence: string;
  sentenceIndex: number;
  tokenIndex: number;
}

export interface GlobalFreqEntry {
  lemma: string;
  original: string;     // most common surface form
  pos: string;
  cefrLevel: CefrLevel | 'UNKNOWN';
  globalCount: number;
  occurrences: WordOccurrence[];
  midSentenceCapitalCount: number; // times the word appeared capitalized at tokenIndex > 0
}

export type GlobalFreqMap = Map<string, GlobalFreqEntry>;

export interface WordToken {
  id: string;               // occurrence ID of best sentence
  lemma: string;
  original: string;
  pos: string;
  cefrLevel: CefrLevel | 'UNKNOWN';
  globalFrequency: number;
  coverageRank: number;     // 1 = most frequent
  bestSentence: string;
  bestSentenceScore: number;
  sourceChunkIndex: number;
  sourceChapter?: string;
  definition_zh: string;    // empty initially, filled after translation
}
