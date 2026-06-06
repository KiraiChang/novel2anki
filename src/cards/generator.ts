import Anthropic from '@anthropic-ai/sdk';
import {
  Chunk, GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard
} from './types';

const client = new Anthropic();

const SYSTEM_PROMPT = `你是一位英語學習輔助專家，專門從英文小說段落中產生高品質的 Anki 記憶字卡。
所有解釋、定義、提示、問題與答案一律使用**繁體中文**，英文原文保留原樣。
請確保字卡內容有情境關聯，幫助學習者記憶單字與理解故事。`;

type CardToolInput =
  | { cards: Array<{ word: string; definition_zh: string; exampleFromText: string }> }
  | { cards: Array<{ text: string; hint_zh: string }> }
  | { cards: Array<{ name: string; description_zh: string; firstMention: string }> }
  | { cards: Array<{ question_zh: string; answer_zh: string }> };

async function callClaude(userPrompt: string, toolName: string, toolSchema: object): Promise<CardToolInput> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{
      name: toolName,
      description: '儲存產生的字卡',
      input_schema: toolSchema as Anthropic.Tool['input_schema'],
    }],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('未收到工具回應');
  return toolUse.input as CardToolInput;
}

async function generateVocab(chunk: Chunk): Promise<VocabCard[]> {
  const prompt = `請從以下英文小說段落中挑選 3-5 個進階單字或片語，為每個單字產生字卡。

段落：
${chunk.text}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            word: { type: 'string', description: '英文單字或片語' },
            definition_zh: { type: 'string', description: '繁體中文定義與詞性說明' },
            exampleFromText: { type: 'string', description: '從段落中直接引用的例句（英文原句）' },
          },
          required: ['word', 'definition_zh', 'exampleFromText'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callClaude(prompt, 'save_vocab_cards', schema) as { cards: Array<{ word: string; definition_zh: string; exampleFromText: string }> };
  return result.cards.map(c => ({ type: 'vocab' as const, ...c }));
}

async function generateCloze(chunk: Chunk): Promise<ClozeCard[]> {
  const prompt = `請從以下英文小說段落中選取 2-3 個關鍵句子，將最重要的片語做成克漏字格式（{{c1::片語}}）。

段落：
${chunk.text}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '包含 {{c1::詞語}} 格式的英文句子' },
            hint_zh: { type: 'string', description: '給學習者的繁體中文提示，說明這個克漏字考什麼' },
          },
          required: ['text', 'hint_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callClaude(prompt, 'save_cloze_cards', schema) as { cards: Array<{ text: string; hint_zh: string }> };
  return result.cards.map(c => ({ type: 'cloze' as const, ...c }));
}

async function generateCharacter(chunk: Chunk): Promise<CharacterCard[]> {
  const prompt = `請從以下英文小說段落中找出出現的人物、地點或重要概念（如有），為每個產生介紹字卡。若段落中沒有明顯的新人物或概念，可回傳空陣列。

段落：
${chunk.text}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '人物、地點或概念名稱（英文原名）' },
            description_zh: { type: 'string', description: '繁體中文描述，說明此人物的角色、特徵或概念的意義' },
            firstMention: { type: 'string', description: '段落中首次提及的原文句子' },
          },
          required: ['name', 'description_zh', 'firstMention'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callClaude(prompt, 'save_character_cards', schema) as { cards: Array<{ name: string; description_zh: string; firstMention: string }> };
  return result.cards.map(c => ({ type: 'character' as const, ...c }));
}

async function generatePlot(chunk: Chunk): Promise<PlotCard[]> {
  const prompt = `請根據以下英文小說段落，產生 1-2 張情節摘要問答字卡，幫助讀者記憶重要劇情。

段落${chunk.chapter ? `（${chunk.chapter}）` : ''}：
${chunk.text}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_zh: { type: 'string', description: '繁體中文問題，測試讀者對此段落的理解' },
            answer_zh: { type: 'string', description: '繁體中文答案，包含重點情節摘要' },
          },
          required: ['question_zh', 'answer_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callClaude(prompt, 'save_plot_cards', schema) as { cards: Array<{ question_zh: string; answer_zh: string }> };
  return result.cards.map(c => ({ type: 'plot' as const, ...c }));
}

export type CardTypes = 'vocab' | 'cloze' | 'character' | 'plot';

export async function generateCards(chunk: Chunk, types: CardTypes[]): Promise<GeneratedCards> {
  const results = await Promise.all([
    types.includes('vocab') ? generateVocab(chunk) : Promise.resolve([]),
    types.includes('cloze') ? generateCloze(chunk) : Promise.resolve([]),
    types.includes('character') ? generateCharacter(chunk) : Promise.resolve([]),
    types.includes('plot') ? generatePlot(chunk) : Promise.resolve([]),
  ]);

  return {
    vocab: results[0] as VocabCard[],
    cloze: results[1] as ClozeCard[],
    character: results[2] as CharacterCard[],
    plot: results[3] as PlotCard[],
  };
}
