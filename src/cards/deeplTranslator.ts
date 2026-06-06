import * as deepl from 'deepl-node';

export interface DeepLConfig {
  apiKey: string;
}

export function loadDeepLConfig(): DeepLConfig {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) throw new Error('未設定 DEEPL_API_KEY 環境變數，請在 .env 加入 DEEPL_API_KEY=your-key');
  return { apiKey };
}

export async function translateToZh(text: string, config: DeepLConfig): Promise<string> {
  const translator = new deepl.Translator(config.apiKey);
  const result = await translator.translateText(text, null, 'zh' as deepl.TargetLanguageCode);
  return result.text;
}

export async function batchTranslate(texts: string[], config: DeepLConfig): Promise<string[]> {
  if (texts.length === 0) return [];
  const translator = new deepl.Translator(config.apiKey);
  const results = await translator.translateText(texts, null, 'zh' as deepl.TargetLanguageCode);
  return (Array.isArray(results) ? results : [results]).map(r => r.text);
}
