import { EnrichedChunk } from './types';

/**
 * 產生注入 LLM prompt 的建議詞彙區塊。
 * 若管線無結果則回傳空字串，呼叫端可直接串接到 prompt 末端。
 */
export function buildNlpHint(chunk: EnrichedChunk, maxItems = 10): string {
  const suggestions = chunk.nlp.vocabSuggestions.slice(0, maxItems);
  if (suggestions.length === 0) return '';

  const list = suggestions
    .map(s => `- ${s.original} (${s.pos}, CEFR ${s.cefrLevel})`)
    .join('\n');

  return `\n\n【參考詞彙建議，可優先考慮但不限於此列表】\n${list}`;
}
