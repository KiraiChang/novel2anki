import { lookupCefrLevel, generateVocabSuggestions } from '../../../nlp/cefrLookup';
import { FreqEntry } from '../../../nlp/freqAnalyzer';

describe('lookupCefrLevel', () => {
  it('should return correct CEFR level for a known B2 word', () => {
    expect(lookupCefrLevel('abandon')).toBe('B2');
  });

  it('should return correct CEFR level for a C1 word', () => {
    expect(lookupCefrLevel('meticulous')).toBe('C1');
  });

  it('should return undefined for an unknown word', () => {
    expect(lookupCefrLevel('xyzzyfoobarbaz')).toBeUndefined();
  });

  it('should be case-insensitive', () => {
    expect(lookupCefrLevel('Abandon')).toBe('B2');
    expect(lookupCefrLevel('ABANDON')).toBe('B2');
  });
});

describe('generateVocabSuggestions', () => {
  function makeFreqMap(entries: Array<[string, Partial<FreqEntry>]>): Map<string, FreqEntry> {
    return new Map(entries.map(([word, e]) => [
      word, { count: e.count ?? 1, pos: e.pos ?? 'Noun', original: e.original ?? word }
    ]));
  }

  it('should include B1, B2, C1, C2 words', () => {
    const map = makeFreqMap([
      ['struggle', { count: 3 }],   // B2
      ['trepidation', { count: 1 }], // C1
    ]);
    const result = generateVocabSuggestions(map);
    const levels = result.map(s => s.cefrLevel);
    expect(levels).toContain('B2');
    expect(levels).toContain('C1');
  });

  it('should exclude A1 and A2 words', () => {
    const map = makeFreqMap([
      ['house', {}],   // A1
      ['happy', {}],   // A2
      ['abandon', {}], // B2 — 應保留
    ]);
    const result = generateVocabSuggestions(map);
    expect(result.some(s => s.word === 'house')).toBe(false);
    expect(result.some(s => s.word === 'happy')).toBe(false);
    expect(result.some(s => s.word === 'abandon')).toBe(true);
  });

  it('should exclude words with no CEFR entry', () => {
    const map = makeFreqMap([['xyzzy', {}]]);
    expect(generateVocabSuggestions(map)).toHaveLength(0);
  });

  it('should sort by frequency descending', () => {
    const map = makeFreqMap([
      ['struggle', { count: 1 }],
      ['abandon', { count: 5 }],
      ['meticulous', { count: 3 }],
    ]);
    const result = generateVocabSuggestions(map);
    expect(result[0].frequency).toBeGreaterThanOrEqual(result[1].frequency);
  });

  it('should cap results at maxCount', () => {
    const entries: Array<[string, Partial<FreqEntry>]> = [
      ['abandon', {}], ['meticulous', {}], ['trepidation', {}],
      ['arduous', {}], ['volatile', {}],
    ];
    const map = makeFreqMap(entries);
    expect(generateVocabSuggestions(map, 2)).toHaveLength(2);
  });

  it('should return empty array when freqMap is empty', () => {
    expect(generateVocabSuggestions(new Map())).toEqual([]);
  });
});
