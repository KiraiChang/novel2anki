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
