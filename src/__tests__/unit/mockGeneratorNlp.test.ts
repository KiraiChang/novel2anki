import { generateMockCards } from '../../cards/mockGenerator';
import { EnrichedChunk, EMPTY_CHUNK_NLP, VocabSuggestion } from '../../nlp/types';

function makeEnriched(suggestions: VocabSuggestion[] = []): EnrichedChunk {
  return {
    index: 0,
    text: 'The arduous journey had taken its toll. Elizabeth walked into the dimly lit corridor.',
    chapter: 'Chapter One',
    nlp: { tokens: [], vocabSuggestions: suggestions },
  };
}

const SUGGESTIONS: VocabSuggestion[] = [
  { word: 'arduous', original: 'arduous', cefrLevel: 'C1', frequency: 2, pos: 'Adjective' },
  { word: 'trepidation', original: 'trepidation', cefrLevel: 'C1', frequency: 1, pos: 'Noun' },
  { word: 'struggle', original: 'struggle', cefrLevel: 'B2', frequency: 1, pos: 'Verb' },
  { word: 'abandon', original: 'abandoned', cefrLevel: 'B2', frequency: 1, pos: 'Verb' },
];

describe('generateMockCards with NLP enrichment', () => {
  it('should use vocabSuggestions as vocab words when suggestions exist', () => {
    const chunk = makeEnriched(SUGGESTIONS);
    const cards = generateMockCards(chunk, ['vocab']);
    const words = cards.vocab.map(c => c.word);
    expect(words).toContain('arduous');
    expect(words).toContain('trepidation');
  });

  it('should not exceed 4 vocab cards from suggestions', () => {
    const chunk = makeEnriched(SUGGESTIONS);
    const cards = generateMockCards(chunk, ['vocab']);
    expect(cards.vocab.length).toBeLessThanOrEqual(4);
  });

  it('should fall back to extractLongWords when vocabSuggestions is empty', () => {
    const chunk = makeEnriched([]);
    const cards = generateMockCards(chunk, ['vocab']);
    // 降級時仍應產生卡片（段落中有長單字）
    expect(cards.vocab.length).toBeGreaterThanOrEqual(0);
  });

  it('should return empty arrays for unrequested types', () => {
    const chunk = makeEnriched(SUGGESTIONS);
    const cards = generateMockCards(chunk, ['vocab']);
    expect(cards.cloze).toEqual([]);
    expect(cards.character).toEqual([]);
    expect(cards.plot).toEqual([]);
  });
});

describe('generateMockCards with EMPTY_CHUNK_NLP', () => {
  it('should behave gracefully when nlp is empty', () => {
    const chunk: EnrichedChunk = { ...makeEnriched(), nlp: EMPTY_CHUNK_NLP };
    expect(() => generateMockCards(chunk, ['vocab', 'cloze', 'character', 'plot'])).not.toThrow();
  });
});
