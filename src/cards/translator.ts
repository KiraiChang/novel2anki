import * as deepl from 'deepl-node';
import Anthropic from '@anthropic-ai/sdk';

export type TranslatorProvider = 'deepl' | 'google' | 'azure' | 'claude';

export interface TranslatorConfig {
  provider: TranslatorProvider;
  apiKey: string;
  region?: string;  // Azure 專用：Ocp-Apim-Subscription-Region
}

// ── 設定載入 ─────────────────────────────────────────────────────────────────

/** 讀取 TRANSLATE_PROVIDER（預設 deepl）及對應 API key，回傳 TranslatorConfig */
export function loadTranslatorConfig(): TranslatorConfig {
  const provider = (process.env['TRANSLATE_PROVIDER'] ?? 'deepl') as TranslatorProvider;

  switch (provider) {
    case 'deepl': {
      const apiKey = process.env['DEEPL_API_KEY'];
      if (!apiKey) throw new Error('未設定 DEEPL_API_KEY 環境變數，請在 .env 加入 DEEPL_API_KEY=your-key');
      return { provider, apiKey };
    }
    case 'google': {
      const apiKey = process.env['GOOGLE_TRANSLATE_API_KEY'];
      if (!apiKey) throw new Error('未設定 GOOGLE_TRANSLATE_API_KEY 環境變數');
      return { provider, apiKey };
    }
    case 'azure': {
      const apiKey = process.env['AZURE_TRANSLATOR_KEY'];
      if (!apiKey) throw new Error('未設定 AZURE_TRANSLATOR_KEY 環境變數');
      const region = process.env['AZURE_TRANSLATOR_REGION'] ?? 'eastasia';
      return { provider, apiKey, region };
    }
    case 'claude': {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) throw new Error('未設定 ANTHROPIC_API_KEY 環境變數');
      return { provider, apiKey };
    }
    default:
      throw new Error(`不支援的翻譯後端：${String(provider)}。可選：deepl, google, azure, claude`);
  }
}

// ── 統一介面 ─────────────────────────────────────────────────────────────────

/** 批次翻譯為繁體中文，依 config.provider 路由到對應後端 */
export async function batchTranslate(texts: string[], config: TranslatorConfig): Promise<string[]> {
  if (texts.length === 0) return [];
  switch (config.provider) {
    case 'deepl':  return batchDeepL(texts, config);
    case 'google': return batchGoogle(texts, config);
    case 'azure':  return batchAzure(texts, config);
    case 'claude': return batchClaude(texts, config);
  }
}

/** 單筆翻譯為繁體中文 */
export async function translateToZh(text: string, config: TranslatorConfig): Promise<string> {
  const results = await batchTranslate([text], config);
  return results[0] ?? text;
}

// ── DeepL ─────────────────────────────────────────────────────────────────────

async function batchDeepL(texts: string[], config: TranslatorConfig): Promise<string[]> {
  const translator = new deepl.Translator(config.apiKey);
  const results = await translator.translateText(texts, null, 'zh-HANT');
  return (Array.isArray(results) ? results : [results]).map(r => r.text);
}

// ── Google Translate ──────────────────────────────────────────────────────────

interface GoogleResponse {
  data: { translations: Array<{ translatedText: string }> };
}

async function batchGoogle(texts: string[], config: TranslatorConfig): Promise<string[]> {
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(config.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target: 'zh-TW', format: 'text' }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
  const data = await res.json() as GoogleResponse;
  return data.data.translations.map(t => t.translatedText);
}

// ── Azure Translator ──────────────────────────────────────────────────────────

interface AzureResponseItem {
  translations: Array<{ text: string; to: string }>;
}

async function batchAzure(texts: string[], config: TranslatorConfig): Promise<string[]> {
  const headers: Record<string, string> = {
    'Ocp-Apim-Subscription-Key': config.apiKey,
    'Content-Type': 'application/json',
  };
  if (config.region) headers['Ocp-Apim-Subscription-Region'] = config.region;

  const res = await fetch(
    'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=zh-Hant',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(texts.map(t => ({ Text: t }))),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw new Error(`Azure Translator HTTP ${res.status}`);
  const data = await res.json() as AzureResponseItem[];
  return data.map(item => item.translations[0]?.text ?? '');
}

// ── Claude (Haiku) ────────────────────────────────────────────────────────────

const CLAUDE_BATCH = 20;

async function batchClaude(texts: string[], config: TranslatorConfig): Promise<string[]> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const results: string[] = [];

  for (let i = 0; i < texts.length; i += CLAUDE_BATCH) {
    const chunk = texts.slice(i, i + CLAUDE_BATCH);
    const numbered = chunk.map((t, j) => `${i + j + 1}. ${t}`).join('\n');

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `將以下英文定義翻譯為繁體中文，詞性標記保留（如 (verb)→（動詞））。只輸出翻譯結果，保持相同編號，一行一條：\n\n${numbered}`,
      }],
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    const translations = raw
      .split('\n')
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean);

    // 若解析行數不足，以原文 fallback
    for (let j = 0; j < chunk.length; j++) {
      results.push(translations[j] ?? chunk[j]);
    }
  }

  return results;
}
