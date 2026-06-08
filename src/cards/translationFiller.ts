import { GeneratedCards } from './types';
import { getWordCache } from '../nlp/wordCache';

/**
 * 補填 VocabCard 缺失的中文定義。
 * 若 definition_zh 為空，從 word-cache-zh.json 快取查找對應翻譯（無 POS 基底鍵）。
 * 快取也找不到則保持空字串。
 * 非空的 definition_zh 不會被覆寫。
 */
export function fillVocabTranslationsFromCache(cards: GeneratedCards): void {
  const wc = getWordCache();
  for (const card of cards.vocab) {
    if (!card.definition_zh) {
      card.definition_zh = wc.getChinese(card.word, null) ?? '';
    }
  }
}
