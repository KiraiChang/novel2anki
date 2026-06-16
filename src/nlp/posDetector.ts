import { tokenize } from './tokenizer';
import { lemmatize } from './lemmatizer';

// compromise 對這些介詞無論語境都會標成 Adjective（已知錯誤）。
// 偵測結果為 Adjective 時才覆寫；若 compromise 標出 Verb / Noun / Adverb 等，
// 代表詞在例句中另有用法，尊重語境結果。
// beginnerFilter 的 SEMANTIC_PREPOSITIONS 與此清單保持同步。
const COMPROMISE_MISLABELS_AS_ADJ = new Set([
  'against', 'amid', 'amidst', 'beneath', 'beyond',
  'beside', 'besides', 'except', 'via',
  'across', 'along', 'among', 'amongst',
  'underneath', 'versus',
  // opposite / unlike 有真實形容詞用法，不納入覆寫清單
]);

/**
 * 對指定例句重新做 NLP 標記，取目標 lemma 在該句中的詞性。
 * - 先對例句標記；找不到詞時退回 fallback
 * - 若偵測結果為 Adjective 且詞在已知誤標清單中，修正為 Preposition
 * - 若 compromise 標出 Verb / Noun / Adverb 等其他詞性，尊重語境
 */
export function detectPosFromSentence(lemma: string, sentence: string, fallback: string): string {
  const tokens = lemmatize(tokenize(sentence));
  const match = tokens.find(t => t.lemma === lemma || t.normal === lemma);
  const detected = match?.pos ?? fallback;
  if (detected === 'Adjective' && COMPROMISE_MISLABELS_AS_ADJ.has(lemma)) return 'Preposition';
  return detected;
}
