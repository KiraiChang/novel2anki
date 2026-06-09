import { GeneratedCards } from './types';
import { getWordCache } from '../nlp/wordCache';

export interface FillResult {
  definitionFilled: number;
  exampleFilled:    number;
}

/**
 * 補填 VocabCard 缺失的中文定義與例句翻譯。
 * - definition_zh 為空時：查 word-cache-zh.json（無 POS 基底鍵），找不到保持空字串
 * - exampleZh 為空時：查 sentence-cache.json（以英文例句 hash 為 key），找不到不設定
 * 已有內容的欄位不覆寫。
 */
export function fillVocabTranslationsFromCache(
  cards: GeneratedCards,
  onProgress?: (current: number, total: number) => void,
): FillResult {
  const wc = getWordCache();
  let definitionFilled = 0;
  let exampleFilled = 0;
  const total = cards.vocab.length;
  for (let i = 0; i < total; i++) {
    const card = cards.vocab[i];
    if (!card.definition_zh) {
      const zh = wc.getChinese(card.word, null);
      card.definition_zh = zh ?? '';
      if (zh) definitionFilled++;
    }
    if (!card.exampleZh) {
      const cached = wc.getSentenceZh(card.exampleFromText);
      if (cached) { card.exampleZh = cached; exampleFilled++; }
    }
    onProgress?.(i + 1, total);
  }
  return { definitionFilled, exampleFilled };
}
