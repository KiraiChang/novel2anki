jest.mock('../../nlp/wordCache');

import { fillVocabTranslationsFromCache } from '../../cards/translationFiller';
import { getWordCache } from '../../nlp/wordCache';
import { GeneratedCards } from '../../cards/types';

const mockGetChinese    = jest.fn<string | null, [string, string | null]>();
const mockGetSentenceZh = jest.fn<string | null, [string]>();
(getWordCache as jest.Mock).mockReturnValue({
  getChinese:    mockGetChinese,
  getSentenceZh: mockGetSentenceZh,
});

function makeCards(overrides: Partial<GeneratedCards> = {}): GeneratedCards {
  return { vocab: [], cloze: [], character: [], plot: [], ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSentenceZh.mockReturnValue(null); // 預設不命中
});

// ── fillVocabTranslationsFromCache ────────────────────────────────────────────

describe('fillVocabTranslationsFromCache', () => {
  it('should fill empty definition_zh from cache', () => {
    // Given
    mockGetChinese.mockReturnValue('（名詞）書籍的章節');
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'chapter', definition_zh: '', exampleFromText: 'He opened the chapter.' }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].definition_zh).toBe('（名詞）書籍的章節');
    expect(mockGetChinese).toHaveBeenCalledWith('chapter', null);
  });

  it('should NOT overwrite non-empty definition_zh', () => {
    // Given
    mockGetChinese.mockReturnValue('快取翻譯');
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'run', definition_zh: 'AI已填入的翻譯', exampleFromText: 'He ran fast.' }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].definition_zh).toBe('AI已填入的翻譯');
    expect(mockGetChinese).not.toHaveBeenCalled();
  });

  it('should leave definition_zh empty when cache has no entry', () => {
    // Given
    mockGetChinese.mockReturnValue(null);
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'unknown', definition_zh: '', exampleFromText: 'It was unknown.' }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].definition_zh).toBe('');
  });

  it('should fill multiple cards independently', () => {
    // Given: chapter 有快取，run 沒有
    mockGetChinese.mockImplementation((word: string) =>
      word === 'chapter' ? '（名詞）章節' : null,
    );
    const cards = makeCards({
      vocab: [
        { type: 'vocab', word: 'chapter', definition_zh: '', exampleFromText: 'ex1' },
        { type: 'vocab', word: 'run',     definition_zh: '', exampleFromText: 'ex2' },
      ],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].definition_zh).toBe('（名詞）章節');
    expect(cards.vocab[1].definition_zh).toBe('');
  });

  it('should not call getChinese when all definitions are filled', () => {
    // Given
    const cards = makeCards({
      vocab: [
        { type: 'vocab', word: 'chapter', definition_zh: '章節', exampleFromText: 'ex1' },
        { type: 'vocab', word: 'run',     definition_zh: '奔跑', exampleFromText: 'ex2' },
      ],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then: getChinese never called
    expect(mockGetChinese).not.toHaveBeenCalled();
  });

  it('should handle empty vocab array without error', () => {
    // Given
    const cards = makeCards({ vocab: [] });
    // When / Then: no throw
    expect(() => fillVocabTranslationsFromCache(cards)).not.toThrow();
    expect(mockGetChinese).not.toHaveBeenCalled();
  });
});

// ── fillVocabTranslationsFromCache — exampleZh ────────────────────────────────

describe('fillVocabTranslationsFromCache — exampleZh', () => {
  it('should fill missing exampleZh from sentence cache', () => {
    // Given
    mockGetSentenceZh.mockReturnValue('他跑得很快。');
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'run', definition_zh: '跑', exampleFromText: 'He ran fast.' }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].exampleZh).toBe('他跑得很快。');
    expect(mockGetSentenceZh).toHaveBeenCalledWith('He ran fast.');
  });

  it('should NOT overwrite existing exampleZh', () => {
    // Given
    mockGetSentenceZh.mockReturnValue('快取例句翻譯');
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'run', definition_zh: '跑', exampleFromText: 'He ran fast.', exampleZh: '已有翻譯' }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].exampleZh).toBe('已有翻譯');
    expect(mockGetSentenceZh).not.toHaveBeenCalled();
  });

  it('should leave exampleZh unset when sentence cache has no entry', () => {
    // Given: getSentenceZh returns null
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'run', definition_zh: '跑', exampleFromText: 'He ran fast.' }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(cards.vocab[0].exampleZh).toBeUndefined();
  });

  it('should pass the exact exampleFromText as the lookup key', () => {
    // Given
    const sentence = 'The chapter began with a dark mystery.';
    mockGetSentenceZh.mockReturnValue('這章以黑暗謎團開始。');
    const cards = makeCards({
      vocab: [{ type: 'vocab', word: 'chapter', definition_zh: '章節', exampleFromText: sentence }],
    });
    // When
    fillVocabTranslationsFromCache(cards);
    // Then
    expect(mockGetSentenceZh).toHaveBeenCalledWith(sentence);
  });
});
