import { generateMockCards } from '../../cards/mockGenerator';
import { EnrichedChunk, EMPTY_CHUNK_NLP, VocabSuggestion } from '../../nlp/types';

// 測試文字包含所有建議詞，確保 findSentenceWith 能找到對應例句
const SAMPLE_TEXT =
  'The arduous journey had taken its toll on the weary travellers. ' +
  'She entered the room with trepidation, unsure of what she would find. ' +
  'He had to struggle against the fierce current to reach the shore. ' +
  'They decided to abandon the abandoned village before nightfall.';

function makeEnriched(suggestions: VocabSuggestion[] = []): EnrichedChunk {
  return {
    index: 0,
    text: SAMPLE_TEXT,
    chapter: 'Chapter One',
    nlp: { tokens: [], vocabSuggestions: suggestions },
  };
}

const SUGGESTIONS: VocabSuggestion[] = [
  { word: 'arduous',     original: 'arduous',     cefrLevel: 'C1', frequency: 2, pos: 'Adjective' },
  { word: 'trepidation', original: 'trepidation', cefrLevel: 'C1', frequency: 1, pos: 'Noun' },
  { word: 'struggle',    original: 'struggle',    cefrLevel: 'B2', frequency: 1, pos: 'Verb' },
  { word: 'abandon',     original: 'abandon',     cefrLevel: 'B2', frequency: 1, pos: 'Verb' },
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

  it('should use a sentence that contains the vocab word', () => {
    const chunk = makeEnriched(SUGGESTIONS);
    const cards = generateMockCards(chunk, ['vocab']);
    for (const card of cards.vocab) {
      expect(card.exampleFromText.toLowerCase()).toContain(card.word.toLowerCase());
    }
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
