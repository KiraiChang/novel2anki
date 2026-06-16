import { detectPosFromSentence } from '../../nlp/posDetector';

// ── detectPosFromSentence ─────────────────────────────────────────────────────

describe('detectPosFromSentence — 從例句取詞性', () => {
  it('介詞語境：against 在 "against a wall" 中應為 Preposition', () => {
    const pos = detectPosFromSentence('against', 'She put her head against a wall.', 'Adjective');
    expect(pos).toBe('Preposition');
  });

  it('動詞語境：run 在動詞位置應為 Verb 系列', () => {
    const pos = detectPosFromSentence('run', 'He runs fast every morning.', 'Noun');
    expect(['Verb', 'Infinitive', 'PastTense', 'Gerund'].includes(pos)).toBe(true);
  });

  it('形容詞語境：deep 作為謂語形容詞應為 Adjective', () => {
    const pos = detectPosFromSentence('deep', 'The cave was dark and deep.', 'Noun');
    expect(pos).toBe('Adjective');
  });

  it('名詞語境：mountain 應為 Noun', () => {
    const pos = detectPosFromSentence('mountain', 'They climbed the mountain in silence.', 'Verb');
    expect(pos).toBe('Noun');
  });

  it('目標詞不在例句中：退回 fallback', () => {
    const pos = detectPosFromSentence('elephant', 'The cat sat on the mat.', 'Noun');
    expect(pos).toBe('Noun');
  });

  it('例句為空字串：退回 fallback', () => {
    const pos = detectPosFromSentence('run', '', 'Verb');
    expect(pos).toBe('Verb');
  });

  it('結果應覆蓋 freqAnalyzer 鎖定的錯誤詞性（beside Adjective → Preposition）', () => {
    // beside 在 freqAnalyzer 可能被鎖為 Adjective（第一次出現的標籤）
    // 對例句重新標記後應得到正確的 Preposition
    const pos = detectPosFromSentence('beside', 'He sat beside the fire and waited.', 'Adjective');
    expect(pos).toBe('Preposition');
  });

  it('已知誤標清單中的詞，若例句語境讓 compromise 標出非 Adjective 詞性，尊重語境結果', () => {
    // 若 compromise 對某個句子將 "across" 標為 Adverb（而非 Adjective），
    // 應尊重該語境結果而非強制覆寫為 Preposition
    const pos = detectPosFromSentence('across', 'He came across.', 'Adjective');
    // compromise 可能標 Adverb 或 Adjective；無論如何不應強制覆寫非 Adjective 的結果
    expect(pos).not.toBe('Adjective'); // 最差情況仍會被修正為 Preposition
  });
});
