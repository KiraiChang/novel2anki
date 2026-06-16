import { selectBestSentence } from '../../nlp/sentenceScorer';
import { GlobalFreqEntry } from '../../nlp/types';

function makeEntry(lemma: string, sentences: string[]): GlobalFreqEntry {
  return {
    lemma,
    original: lemma,
    pos: 'Noun',
    cefrLevel: 'B1',
    globalCount: sentences.length,
    midSentenceCapitalCount: 0,
    occurrences: sentences.map((sentence, i) => ({
      id: `c0_s${i}_t0`,
      chunkIndex: 0,
      sentence,
      sentenceIndex: i,
      tokenIndex: 0,
    })),
  };
}

describe('selectBestSentence — 字典定義格式懲罰', () => {
  it('(noun) 開頭的句子不應勝過正常敘述句', () => {
    const entry = makeEntry('against', [
      '(noun) the part of an animal that is like a person\'s back against which the rider sits.',
      'She leaned against the door and listened carefully.',
    ]);
    const best = selectBestSentence(entry);
    expect(best.sentence).toBe('She leaned against the door and listened carefully.');
  });

  it('(verb) 開頭的定義句應被懲罰', () => {
    const entry = makeEntry('run', [
      '(verb) to move quickly using your legs, faster than walking.',
      'He would run five miles every morning before sunrise.',
    ]);
    const best = selectBestSentence(entry);
    expect(best.sentence).toBe('He would run five miles every morning before sunrise.');
  });

  it('(adj) 縮寫格式也應被懲罰', () => {
    const entry = makeEntry('deep', [
      '(adj) having a large distance from top to bottom.',
      'The cave was dark, deep, and completely silent.',
    ]);
    const best = selectBestSentence(entry);
    expect(best.sentence).toBe('The cave was dark, deep, and completely silent.');
  });

  it('(n) 單字母縮寫格式也應被懲罰', () => {
    const entry = makeEntry('back', [
      '(n) the rear part of the human body.',
      'The cat arched its back and hissed at the stranger.',
    ]);
    const best = selectBestSentence(entry);
    expect(best.sentence).toBe('The cat arched its back and hissed at the stranger.');
  });

  it('只有定義句時仍回傳（別無選擇）', () => {
    const entry = makeEntry('back', [
      '(noun) the rear part of the human body from the shoulder to the hip.',
    ]);
    const best = selectBestSentence(entry);
    expect(best.sentence).toContain('(noun)');
  });
});
