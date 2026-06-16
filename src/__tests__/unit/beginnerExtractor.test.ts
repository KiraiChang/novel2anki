jest.mock('../../nlp/spaCyPosClient');

import { detectPosFromSentence, batchDetectPosFromSentences } from '../../nlp/posDetector';
import { batchDetectPos } from '../../nlp/spaCyPosClient';

const mockBatchDetectPos = batchDetectPos as jest.MockedFunction<typeof batchDetectPos>;

beforeEach(() => jest.clearAllMocks());

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

// ── batchDetectPosFromSentences ───────────────────────────────────────────────

describe('batchDetectPosFromSentences — spaCy 優先，失敗退回 compromise', () => {
  it('spaCy 成功時直接使用其結果', async () => {
    mockBatchDetectPos.mockResolvedValueOnce([
      { word: 'against', pos: 'Preposition' },
      { word: 'run',     pos: 'Verb' },
    ]);
    const result = await batchDetectPosFromSentences([
      { lemma: 'against', sentence: 'She put her head against a wall.', fallback: 'Adjective' },
      { lemma: 'run',     sentence: 'He runs fast.',                    fallback: 'Noun' },
    ]);
    expect(result).toEqual(['Preposition', 'Verb']);
  });

  it('spaCy 回傳空陣列時，退回 compromise + 誤標覆寫', async () => {
    mockBatchDetectPos.mockResolvedValueOnce([]);
    const result = await batchDetectPosFromSentences([
      { lemma: 'against', sentence: 'She put her head against a wall.', fallback: 'Adjective' },
    ]);
    // spaCy 失敗 → compromise 標 Adjective → COMPROMISE_MISLABELS_AS_ADJ 覆寫為 Preposition
    expect(result).toEqual(['Preposition']);
  });

  it('spaCy 部分詞 pos 為空字串時，對該詞退回 compromise', async () => {
    mockBatchDetectPos.mockResolvedValueOnce([
      { word: 'mountain', pos: 'Noun' },
      { word: 'xyzzy',    pos: '' },      // 在例句中找不到
    ]);
    const result = await batchDetectPosFromSentences([
      { lemma: 'mountain', sentence: 'They climbed the mountain.',  fallback: 'Verb' },
      { lemma: 'xyzzy',    sentence: 'A strange word appeared.',    fallback: 'Noun' },
    ]);
    expect(result[0]).toBe('Noun');       // spaCy 結果
    expect(result[1]).toBe('Noun');       // fallback
  });

  it('回傳陣列與輸入等長', async () => {
    mockBatchDetectPos.mockResolvedValueOnce([
      { word: 'deep', pos: 'Adjective' },
      { word: 'fast', pos: 'Adjective' },
      { word: 'run',  pos: 'Verb' },
    ]);
    const result = await batchDetectPosFromSentences([
      { lemma: 'deep', sentence: 'The cave is deep.', fallback: 'Noun' },
      { lemma: 'fast', sentence: 'She runs fast.',    fallback: 'Noun' },
      { lemma: 'run',  sentence: 'He runs daily.',    fallback: 'Noun' },
    ]);
    expect(result).toHaveLength(3);
  });
});
