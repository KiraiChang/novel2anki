import { applyBeginnerFilters } from '../../nlp/beginnerFilter';
import { GlobalFreqEntry, GlobalFreqMap } from '../../nlp/types';

// ── 測試輔助 ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<GlobalFreqEntry> & { lemma: string }): GlobalFreqEntry {
  return {
    original: overrides.lemma,
    pos: 'Noun',
    cefrLevel: 'B1',
    globalCount: 3,
    occurrences: [
      { id: 'c0_s0_t1', chunkIndex: 0, sentence: 'A test sentence.', sentenceIndex: 0, tokenIndex: 1 },
      { id: 'c0_s1_t1', chunkIndex: 0, sentence: 'Another sentence.', sentenceIndex: 1, tokenIndex: 1 },
      { id: 'c0_s2_t1', chunkIndex: 0, sentence: 'Third sentence.', sentenceIndex: 2, tokenIndex: 1 },
    ],
    midSentenceCapitalCount: 0,
    ...overrides,
  };
}

function makeMap(entries: GlobalFreqEntry[]): GlobalFreqMap {
  const map: GlobalFreqMap = new Map();
  for (const e of entries) map.set(e.lemma, e);
  return map;
}

// ── content-pos 基本行為 ───────────────────────────────────────────────────────

describe('content-pos filter — normal POS', () => {
  it('should keep a Noun entry', () => {
    const { kept } = applyBeginnerFilters(makeMap([makeEntry({ lemma: 'shadow', pos: 'Noun' })]));
    expect(kept.map(e => e.lemma)).toContain('shadow');
  });

  it('should keep a Verb entry', () => {
    const { kept } = applyBeginnerFilters(makeMap([makeEntry({ lemma: 'squeeze', pos: 'Verb' })]));
    expect(kept.map(e => e.lemma)).toContain('squeeze');
  });

  it('should reject Conjunction with reason content-pos', () => {
    const { rejected } = applyBeginnerFilters(makeMap([makeEntry({ lemma: 'whereas', pos: 'Conjunction' })]));
    expect(rejected.find(r => r.lemma === 'whereas')?.reason).toBe('content-pos');
  });
});

// ── semantic preposition whitelist ────────────────────────────────────────────

describe('semantic preposition whitelist — against (original issue)', () => {
  it('should keep "against" (Preposition) instead of rejecting with content-pos', () => {
    const { kept } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'against', pos: 'Preposition' }),
    ]));
    expect(kept.map(e => e.lemma)).toContain('against');
  });

  it('should NOT assign content-pos reason to "against"', () => {
    const { rejected } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'against', pos: 'Preposition' }),
    ]));
    expect(rejected.find(r => r.lemma === 'against')).toBeUndefined();
  });
});

describe('semantic preposition whitelist — other whitelisted prepositions', () => {
  const cases = [
    'amid', 'amidst', 'beneath', 'beyond',
    'beside', 'besides', 'except', 'unlike',
    'via', 'across', 'along', 'among', 'amongst',
    'opposite', 'underneath', 'versus',
  ];

  for (const word of cases) {
    it(`should keep "${word}" (Preposition)`, () => {
      const { kept } = applyBeginnerFilters(makeMap([
        makeEntry({ lemma: word, pos: 'Preposition' }),
      ]));
      expect(kept.map(e => e.lemma)).toContain(word);
    });
  }
});

describe('semantic preposition whitelist — non-whitelisted prepositions', () => {
  it('should reject a generic unlisted preposition with content-pos', () => {
    // 'per' 是介系詞但不在白名單
    const { rejected } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'per', pos: 'Preposition' }),
    ]));
    expect(rejected.find(r => r.lemma === 'per')?.reason).toBe('content-pos');
  });
});

// ── stopWords 先於 content-pos 攔截 ──────────────────────────────────────────

describe('stop words still filtered before content-pos', () => {
  it('should reject "without" with not-stopword (not content-pos)', () => {
    // 'without' 在 stopWords 裡，應走 not-stopword 而非 content-pos
    const { rejected } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'without', pos: 'Preposition' }),
    ]));
    expect(rejected.find(r => r.lemma === 'without')?.reason).toBe('not-stopword');
  });

  it('should reject "around" with not-stopword (not content-pos)', () => {
    const { rejected } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'around', pos: 'Preposition' }),
    ]));
    expect(rejected.find(r => r.lemma === 'around')?.reason).toBe('not-stopword');
  });
});

// ── 其他過濾規則不受影響 ───────────────────────────────────────────────────────

describe('other filter rules unaffected by preposition whitelist', () => {
  it('should reject a whitelisted preposition with A1 level (not-A1)', () => {
    const { rejected } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'against', pos: 'Preposition', cefrLevel: 'A1' }),
    ]));
    expect(rejected.find(r => r.lemma === 'against')?.reason).toBe('not-A1');
  });

  it('should keep a whitelisted preposition with A1 if includeA1 is true', () => {
    const { kept } = applyBeginnerFilters(
      makeMap([makeEntry({ lemma: 'against', pos: 'Preposition', cefrLevel: 'A1' })]),
      { includeA1: true },
    );
    expect(kept.map(e => e.lemma)).toContain('against');
  });

  it('should reject a whitelisted preposition with globalCount < minFreq', () => {
    const { rejected } = applyBeginnerFilters(makeMap([
      makeEntry({ lemma: 'against', pos: 'Preposition', globalCount: 1 }),
    ]));
    expect(rejected.find(r => r.lemma === 'against')?.reason).toBe('not-hapax');
  });
});
