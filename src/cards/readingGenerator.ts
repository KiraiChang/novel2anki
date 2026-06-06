import Anthropic from '@anthropic-ai/sdk';
import { EnrichedChunk } from '../nlp/types';
import { generateReadingMockCards } from './readingMockGenerator';
import {
  ReadingCards, ReadingTermCard, ReadingCauseCard,
  ReadingChapterCard, ReadingThemeCard,
} from './readingTypes';

const client = new Anthropic();

const SYSTEM_PROMPT = `你是英文小說讀書理解字卡製作專家，協助讀者深入理解故事。
所有說明、定義、問題與答案一律使用繁體中文，英文原文保留原樣。`;

async function callClaude<T>(userPrompt: string, toolName: string, toolSchema: object): Promise<T> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{
      name: toolName,
      description: '儲存處理結果',
      input_schema: toolSchema as Anthropic.Tool['input_schema'],
    }],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('未收到工具回應');
  return toolUse.input as T;
}

async function enrichTermCards(terms: ReadingTermCard[], deckName: string): Promise<ReadingTermCard[]> {
  if (terms.length === 0) return terms;

  const termList = terms.map((t, i) =>
    `${i + 1}. ${t.word}（出現 ${t.frequency} 次）\n   代表例句：${t.exampleFromText}`
  ).join('\n');

  const prompt = `書名：${deckName}

以下是書中反覆出現的術語，請為每個術語說明它在**本書**中的含義與角色（非通用英文字典定義），限 30 字內。

${termList}`;

  const schema = {
    type: 'object',
    properties: {
      definitions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            word: { type: 'string', description: '術語原文（與輸入完全一致）' },
            definition_zh: { type: 'string', description: '本書中的含義（繁體中文，限30字）' },
          },
          required: ['word', 'definition_zh'],
        },
      },
    },
    required: ['definitions'],
  };

  const result = await callClaude<{ definitions: Array<{ word: string; definition_zh: string }> }>(
    prompt, 'save_term_definitions', schema
  );

  const defMap = new Map(result.definitions.map(d => [d.word, d.definition_zh]));
  return terms.map(t => ({ ...t, definition_zh: defMap.get(t.word) ?? t.definition_zh }));
}

async function enrichCauseCards(causes: ReadingCauseCard[], deckName: string): Promise<ReadingCauseCard[]> {
  if (causes.length === 0) return causes;

  const causeList = causes.map((c, i) =>
    `${i + 1}. 問題提示：${c.question_zh}\n   英文原文：${c.answer_zh}`
  ).join('\n\n');

  const prompt = `書名：${deckName}

以下是書中的因果轉折句，請為每張字卡：
1. 重新擬定更精準的繁體中文問題（question_zh），讓讀者聚焦在關鍵因果關係
2. 提供繁體中文解釋（answer_zh）：先給出中文摘要說明因果關係，空一行後附上英文原文

${causeList}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number', description: '對應輸入的序號（1-based）' },
            question_zh: { type: 'string', description: '繁體中文因果問題' },
            answer_zh: { type: 'string', description: '中文解釋（空行後附英文原文）' },
          },
          required: ['index', 'question_zh', 'answer_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callClaude<{ cards: Array<{ index: number; question_zh: string; answer_zh: string }> }>(
    prompt, 'save_cause_cards', schema
  );

  return causes.map((c, i) => {
    const enriched = result.cards.find(r => r.index === i + 1);
    return enriched ? { ...c, question_zh: enriched.question_zh, answer_zh: enriched.answer_zh } : c;
  });
}

async function enrichChapterCards(chapters: ReadingChapterCard[], deckName: string): Promise<ReadingChapterCard[]> {
  if (chapters.length === 0) return chapters;

  const chapterList = chapters.map((c, i) =>
    `${i + 1}. ${c.question_zh}\n   首尾句：${c.answer_zh}`
  ).join('\n\n');

  const prompt = `書名：${deckName}

以下是各章節的首尾句，請為每章：
1. 微調 question_zh，讓問題更聚焦（可保持原問題）
2. 提供繁體中文章節摘要（answer_zh），說明這章的核心事件，限 80 字內

${chapterList}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number', description: '對應輸入的序號（1-based）' },
            question_zh: { type: 'string', description: '章節理解問題（繁體中文）' },
            answer_zh: { type: 'string', description: '章節核心事件摘要（繁體中文，限80字）' },
          },
          required: ['index', 'question_zh', 'answer_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callClaude<{ cards: Array<{ index: number; question_zh: string; answer_zh: string }> }>(
    prompt, 'save_chapter_cards', schema
  );

  return chapters.map((c, i) => {
    const enriched = result.cards.find(r => r.index === i + 1);
    return enriched ? { ...c, question_zh: enriched.question_zh, answer_zh: enriched.answer_zh } : c;
  });
}

async function enrichThemeCards(themes: ReadingThemeCard[], deckName: string): Promise<ReadingThemeCard[]> {
  if (themes.length === 0) return themes;

  const themeList = themes.map((t, i) =>
    `${i + 1}. ${t.name}（出現 ${t.frequency} 次）\n   代表例句：${t.firstMention}`
  ).join('\n');

  const prompt = `書名：${deckName}

以下是書中反覆出現的意象詞，請說明每個詞在**本書**中象徵或代表什麼（限 40 字）。

${themeList}`;

  const schema = {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '意象詞原文（與輸入完全一致）' },
            description_zh: { type: 'string', description: '在本書中的象徵意義（繁體中文，限40字）' },
          },
          required: ['name', 'description_zh'],
        },
      },
    },
    required: ['themes'],
  };

  const result = await callClaude<{ themes: Array<{ name: string; description_zh: string }> }>(
    prompt, 'save_theme_descriptions', schema
  );

  const descMap = new Map(result.themes.map(t => [t.name, t.description_zh]));
  return themes.map(t => ({ ...t, description_zh: descMap.get(t.name) ?? t.description_zh }));
}

export async function generateReadingCards(
  chunks: EnrichedChunk[],
  deckName: string,
): Promise<ReadingCards> {
  const mockCards = generateReadingMockCards(chunks);

  // 四種類型並行送 Claude 補充中文定義
  const [terms, causes, chapters, themes] = await Promise.all([
    enrichTermCards(mockCards.terms, deckName),
    enrichCauseCards(mockCards.causes, deckName),
    enrichChapterCards(mockCards.chapters, deckName),
    enrichThemeCards(mockCards.themes, deckName),
  ]);

  return { terms, causes, chapters, themes };
}
