import { GeneratedCards } from './types';
import { getWordCache } from '../nlp/wordCache';

/**
 * 補填 VocabCard 缺失的中文定義與例句翻譯。
 * - definition_zh 為空時：查 word-cache-zh.json（無 POS 基底鍵），找不到保持空字串
 * - exampleZh 為空時：查 sentence-cache.json（以英文例句 hash 為 key），找不到不設定
 * 已有內容的欄位不覆寫。
 */
export function fillVocabTranslationsFromCache(cards: GeneratedCards): void {
  const wc = getWordCache();
  for (const card of cards.vocab) {
    if (!card.definition_zh) {
      card.definition_zh = wc.getChinese(card.word, null) ?? '';
    }
    if (!card.exampleZh) {
      const cached = wc.getSentenceZh(card.exampleFromText);
      if (cached) card.exampleZh = cached;
    }
  }
}
