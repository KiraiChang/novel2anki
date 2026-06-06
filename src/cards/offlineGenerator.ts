import {
  Chunk, GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard
} from './types';

export type CardTypes = 'vocab' | 'cloze' | 'character' | 'plot';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

export function loadOllamaConfig(cliModel?: string): OllamaConfig {
  return {
    model: cliModel ?? process.env.OLLAMA_MODEL ?? 'llama3.2',
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  };
}

const SYSTEM_PROMPT = `你是英語學習字卡產生器。從英文小說段落產生 Anki 字卡。
規則：
1. 所有解釋、定義、中文內容使用繁體中文
2. 英文原文保留原樣
3. 僅輸出 JSON，不輸出其他文字
4. 嚴格遵守提供的 JSON Schema 格式`;

interface OllamaResponse {
  message: { content: string };
}

async function callOllama<T>(
  config: OllamaConfig,
  userPrompt: string,
  schema: object
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let raw = '';

  try {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: { type: 'json_schema', json_schema: { name: 'cards', schema, strict: true } },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (res.status === 404) {
      throw new Error(
        `Ollama 模型「${config.model}」不存在，請執行：ollama pull ${config.model}`
      );
    }

    if (!res.ok) {
      throw new Error(`Ollama 回應錯誤：HTTP ${res.status}`);
    }

    const data = (await res.json()) as OllamaResponse;
    raw = data.message.content;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // 第二層：format: "json"（寬鬆模式，不帶 schema）
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Ollama 回應逾時（模型：${config.model}）`);
    }
    const msg = (err as Error).message ?? '';
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('Failed to fetch')) {
      throw new Error(
        `無法連線 Ollama（${config.baseUrl}），請確認 Ollama 已啟動：ollama serve`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // 第二層降級：使用 format: "json"
  const controller2 = new AbortController();
  const timeout2 = setTimeout(() => controller2.abort(), 60_000);
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
      try {
        return JSON.parse(raw) as T;
      } catch {
        // 繼續到第三層
      }
    }
  } catch {
    // 第三層：直接回傳空結果
  } finally {
    clearTimeout(timeout2);
  }

  // 第三層降級：嘗試從原始文字中擷取 JSON 區塊
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch {
      // 放棄，回傳空卡片（由呼叫端處理）
    }
  }

  return { cards: [] } as unknown as T;
}

async function generateVocab(chunk: Chunk, config: OllamaConfig): Promise<VocabCard[]> {
  const prompt = `請從以下英文小說段落中挑選 3-5 個進階單字或片語，為每個產生字卡。
exampleFromText 必須逐字引用段落中的原句，不可改寫。

段落：
${chunk.text}

輸出範例：
{"cards":[{"word":"arduous","definition_zh":"（形容詞）艱難的、費力的","exampleFromText":"The arduous journey had taken its toll on them."}]}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            word: { type: 'string' },
            definition_zh: { type: 'string' },
            exampleFromText: { type: 'string' },
          },
          required: ['word', 'definition_zh', 'exampleFromText'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callOllama<{ cards: Array<{ word: string; definition_zh: string; exampleFromText: string }> }>(
    config, prompt, schema
  );
  return (result.cards ?? []).map(c => ({ type: 'vocab' as const, ...c }));
}

async function generateCloze(chunk: Chunk, config: OllamaConfig): Promise<ClozeCard[]> {
  const prompt = `請從以下英文小說段落中選取 2-3 個關鍵句子，將最重要的動詞或名詞片語做成克漏字格式：{{c1::片語}}。

段落：
${chunk.text}

輸出範例：
{"cards":[{"text":"She walked into the {{c1::dimly lit}} corridor.","hint_zh":"描述走廊光線的形容詞片語"}]}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            hint_zh: { type: 'string' },
          },
          required: ['text', 'hint_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callOllama<{ cards: Array<{ text: string; hint_zh: string }> }>(
    config, prompt, schema
  );
  return (result.cards ?? []).map(c => ({ type: 'cloze' as const, ...c }));
}

async function generateCharacter(chunk: Chunk, config: OllamaConfig): Promise<CharacterCard[]> {
  const prompt = `請從以下英文小說段落中找出出現的人物、地點或重要概念（如有）。
若段落中沒有明顯的新人物、地點或重要概念，請回傳 {"cards":[]}，不要捏造。
firstMention 必須逐字引用段落中首次提及的原句。

段落：
${chunk.text}

輸出範例：
{"cards":[{"name":"Elizabeth Bennet","description_zh":"故事主角，聰明獨立的年輕女性","firstMention":"Elizabeth Bennet had been obliged to take refuge from the rain."}]}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description_zh: { type: 'string' },
            firstMention: { type: 'string' },
          },
          required: ['name', 'description_zh', 'firstMention'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callOllama<{ cards: Array<{ name: string; description_zh: string; firstMention: string }> }>(
    config, prompt, schema
  );
  return (result.cards ?? []).map(c => ({ type: 'character' as const, ...c }));
}

async function generatePlot(chunk: Chunk, config: OllamaConfig): Promise<PlotCard[]> {
  const prompt = `請根據以下英文小說段落，產生 1-2 張情節摘要問答字卡。
問題和答案都使用繁體中文，問題需具體（不能只問「這段描述什麼」）。

段落${chunk.chapter ? `（${chunk.chapter}）` : ''}：
${chunk.text}

輸出範例：
{"cards":[{"question_zh":"達西先生初次見到伊莉莎白時有什麼反應？","answer_zh":"他對她的外貌感到不屑，拒絕與她共舞，表現出傲慢的態度。"}]}`;

  const schema = {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_zh: { type: 'string' },
            answer_zh: { type: 'string' },
          },
          required: ['question_zh', 'answer_zh'],
        },
      },
    },
    required: ['cards'],
  };

  const result = await callOllama<{ cards: Array<{ question_zh: string; answer_zh: string }> }>(
    config, prompt, schema
  );
  return (result.cards ?? []).map(c => ({ type: 'plot' as const, ...c }));
}

export async function generateCards(
  chunk: Chunk,
  types: CardTypes[],
  config: OllamaConfig
): Promise<GeneratedCards> {
  const vocab: VocabCard[] = types.includes('vocab') ? await generateVocab(chunk, config) : [];
  const cloze: ClozeCard[] = types.includes('cloze') ? await generateCloze(chunk, config) : [];
  const character: CharacterCard[] = types.includes('character') ? await generateCharacter(chunk, config) : [];
  const plot: PlotCard[] = types.includes('plot') ? await generatePlot(chunk, config) : [];

  return { vocab, cloze, character, plot };
}
