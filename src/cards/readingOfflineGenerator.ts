import { EnrichedChunk } from '../nlp/types';
import { OllamaConfig } from './offlineGenerator';
import { generateReadingMockCards } from './readingMockGenerator';
import {
  ReadingCards, ReadingTermCard, ReadingCauseCard,
  ReadingChapterCard, ReadingThemeCard,
} from './readingTypes';

const SYSTEM_PROMPT = `你是英文小說讀書理解字卡製作專家，協助讀者深入理解故事。
規則：
1. 所有說明、定義、問題與答案使用繁體中文
2. 英文原文保留原樣
3. 僅輸出 JSON，不輸出其他文字
4. 嚴格遵守提供的 JSON Schema 格式`;

interface OllamaResponse {
  message: { content: string };
}

async function callOllama<T>(config: OllamaConfig, userPrompt: string, schema: object): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  let raw = '';

  try {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (res.status === 404) {
      throw new Error(`Ollama 模型「${config.model}」不存在，請執行：ollama pull ${config.model}`);
    }
    if (!res.ok) throw new Error(`Ollama 回應錯誤：HTTP ${res.status}`);

    const data = (await res.json()) as OllamaResponse;
    raw = data.message.content;

    try { return JSON.parse(raw) as T; } catch { /* 降級 */ }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Ollama 回應逾時（模型：${config.model}）`);
    const msg = (err as Error).message ?? '';
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('Failed to fetch')) {
      throw new Error(`無法連線 Ollama（${config.baseUrl}），請確認 Ollama 已啟動：ollama serve`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // 降級：寬鬆 JSON 模式
  const controller2 = new AbortController();
  const timeout2 = setTimeout(() => controller2.abort(), 120_000);
  try {
    const res2 = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller2.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt + '\n\n請只輸出合法的 JSON 物件。' },
        ],
      }),
    });
    if (res2.ok) {
      const data2 = (await res2.json()) as OllamaResponse;
      raw = data2.message.content;
      try { return JSON.parse(raw) as T; } catch { /* 繼續 */ }
    }
  } catch { /* 忽略 */ } finally {
    clearTimeout(timeout2);
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]) as T; } catch { /* 放棄 */ }
  }

  return {} as T;
}

async function enrichTermCards(terms: ReadingTermCard[], deckName: string, config: OllamaConfig): Promise<ReadingTermCard[]> {
  if (terms.length === 0) return terms;

  const termList = terms.map((t, i) =>
    `${i + 1}. ${t.word}（出現 ${t.frequency} 次）\n   代表例句：${t.exampleFromText}`
  ).join('\n');

  const prompt = `書名：${deckName}

以下是書中反覆出現的術語，請為每個術語說明它在本書中的含義與角色（非通用英文字典定義），限 30 字內。

${termList}

輸出範例：{"definitions":[{"word":"Corona","definition_zh":"本書的神秘組織，擁有超自然力量，主導整個故事衝突"}]}`;

  const schema = {
    type: 'object',
    properties: {
      definitions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            word: { type: 'string' },
            definition_zh: { type: 'string' },
          },
          required: ['word', 'definition_zh'],
        },
      },
    },
    required: ['definitions'],
  };

  const result = await callOllama<{ definitions?: Array<{ word: string; definition_zh: string }> }>(
    config, prompt, schema
  );

  const defMap = new Map((result.definitions ?? []).map(d => [d.word, d.definition_zh]));
  return terms.map(t => ({ ...t, definition_zh: defMap.get(t.word) ?? t.definition_zh }));
}

async function enrichCauseCards(causes: ReadingCauseCard[], deckName: string, config: OllamaConfig): Promise<ReadingCauseCard[]> {
  if (causes.length === 0) return causes;

  const causeList = causes.map((c, i) =>
    `${i + 1}. 問題提示：${c.question_zh}\n   英文原文：${c.answer_zh}`
  ).join('\n\n');

  const prompt = `書名：${deckName}

以下是書中的因果轉折句，請為每張字卡：
1. 重新擬定更精準的繁體中文問題（question_zh）
2. 提供繁體中文解釋（answer_zh）：先給出中文摘要，空一行後附上英文原文

${causeList}

輸出範例：{"cards":[{"index":1,"question_zh":"為什麼主角決定離開村莊？","answer_zh":"村莊遭到黑暗勢力入侵，主角為保護家人不得不出走。\n\nThe village was attacked by dark forces, leaving him no choice but to flee."}]}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            question_zh: { type: 'string' },
            answer_zh: { type: 'string' },
          },
          required: ['index', 'question_zh', 'answer_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callOllama<{ cards?: Array<{ index: number; question_zh: string; answer_zh: string }> }>(
    config, prompt, schema
  );

  return causes.map((c, i) => {
    const enriched = (result.cards ?? []).find(r => r.index === i + 1);
    return enriched ? { ...c, question_zh: enriched.question_zh, answer_zh: enriched.answer_zh } : c;
  });
}

async function enrichChapterCards(chapters: ReadingChapterCard[], deckName: string, config: OllamaConfig): Promise<ReadingChapterCard[]> {
  if (chapters.length === 0) return chapters;

  const chapterList = chapters.map((c, i) =>
    `${i + 1}. ${c.question_zh}\n   首尾句：${c.answer_zh}`
  ).join('\n\n');

  const prompt = `書名：${deckName}

以下是各章節的首尾句，請為每章：
1. 微調 question_zh，讓問題更聚焦（可保持原問題）
2. 提供繁體中文章節摘要（answer_zh），說明核心事件，限 80 字內

${chapterList}

輸出範例：{"cards":[{"index":1,"question_zh":"第一章的核心衝突是什麼？","answer_zh":"主角在森林中遭遇神秘生物，初次感受到體內的黑暗力量，並意外摧毀了一棵古樹。"}]}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'number' },
            question_zh: { type: 'string' },
            answer_zh: { type: 'string' },
          },
          required: ['index', 'question_zh', 'answer_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callOllama<{ cards?: Array<{ index: number; question_zh: string; answer_zh: string }> }>(
    config, prompt, schema
  );

  return chapters.map((c, i) => {
    const enriched = (result.cards ?? []).find(r => r.index === i + 1);
    return enriched ? { ...c, question_zh: enriched.question_zh, answer_zh: enriched.answer_zh } : c;
  });
}

async function enrichThemeCards(themes: ReadingThemeCard[], deckName: string, config: OllamaConfig): Promise<ReadingThemeCard[]> {
  if (themes.length === 0) return themes;

  const themeList = themes.map((t, i) =>
    `${i + 1}. ${t.name}（出現 ${t.frequency} 次）\n   代表例句：${t.firstMention}`
  ).join('\n');

  const prompt = `書名：${deckName}

以下是書中反覆出現的意象詞，請說明每個詞在本書中象徵或代表什麼（限 40 字）。

${themeList}

輸出範例：{"themes":[{"name":"darkness","description_zh":"代表主角內心深處壓抑的超自然力量，也象徵整個世界面臨的未知威脅"}]}`;

  const schema = {
    type: 'object',
    properties: {
      themes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description_zh: { type: 'string' },
          },
          required: ['name', 'description_zh'],
        },
      },
    },
    required: ['themes'],
  };

  const result = await callOllama<{ themes?: Array<{ name: string; description_zh: string }> }>(
    config, prompt, schema
  );

  const descMap = new Map((result.themes ?? []).map(t => [t.name, t.description_zh]));
  return themes.map(t => ({ ...t, description_zh: descMap.get(t.name) ?? t.description_zh }));
}

export async function generateReadingOfflineCards(
  chunks: EnrichedChunk[],
  deckName: string,
  config: OllamaConfig,
): Promise<ReadingCards> {
  const mockCards = generateReadingMockCards(chunks);

  // Ollama 本地模型不支援真正並行，循序執行
  const terms = await enrichTermCards(mockCards.terms, deckName, config);
  const causes = await enrichCauseCards(mockCards.causes, deckName, config);
  const chapters = await enrichChapterCards(mockCards.chapters, deckName, config);
  const themes = await enrichThemeCards(mockCards.themes, deckName, config);

  return { terms, causes, chapters, themes };
}
