// 薄包裝層，維持既有 import 路徑相容性。
// 實際邏輯移至 translator.ts，支援 deepl / google / azure / claude 後端切換。
import { TranslatorConfig, loadTranslatorConfig, batchTranslate, translateToZh } from './translator';

export type DeepLConfig = TranslatorConfig;
export { TranslatorConfig, loadTranslatorConfig, batchTranslate, translateToZh };

/** @deprecated 請改用 loadTranslatorConfig()。讀取 TRANSLATE_PROVIDER 決定後端 */
export function loadDeepLConfig(): DeepLConfig {
  return loadTranslatorConfig();
}
