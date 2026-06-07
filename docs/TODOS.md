# TODOS

> 待實作功能，按優先順序排列。完成後將 `[ ]` 改為 `[x]` 並標註完成日期。

- [x] 同步產生 HTML 預覽檔，可直接用瀏覽器查看所有字卡（`src/html/exporter.ts`）
- [x] 離線模式：`--offline` 旗標透過本機 Ollama 產生字卡，`--model` 自訂模型名稱（`src/cards/offlineGenerator.ts`）
- [x] NLP 前處理管線：compromise tokenize → lemma → 詞頻 → CEFR 分級，提供 `vocabSuggestions` 給所有生成模式（`src/nlp/`）
## 初學者模式（`--beginner`）

- [x] **升級字典 API**（`src/csv/beginnerDeeplTranslator.ts`，2026-06-07）：已接入 Merriam-Webster Learner's Dictionary API（`MW_API_KEY` 環境變數，1000 req/day 免費，端點 `/learners/json`）作為主要字典來源，原 `dictionaryapi.dev` 降為 fallback。MW 的 `shortdef` 欄位定義精確、無交叉參照干擾，品質大幅優於 Wiktionary 資料。翻譯進度列同步顯示 `[MW]` / `[Free]` / `[fallback]` 標記。
- [x] **預建人名表**（`src/nlp/nameProtector.ts`、`src/csv/beginnerExporter.ts`，2026-06-07）：`--beginner` 掃描完成後，從所有 `bestSentence` 以 NER（compromise + mid-sentence 大寫詞）偵測專有名詞，輸出 `*-beginner-names.txt`（純文字，一行一名詞，含說明注釋）。使用者可在翻譯前確認 / 新增 / 刪除。`--deepl` 翻譯時自動讀取同目錄的 `*-beginner-names.txt`，以預建名詞集保護人名（原動態偵測作 backward-compat fallback）。NER 函式抽離至 `src/nlp/nameProtector.ts` 共用模組。

- [ ] 新增 `--verbose` / `--debug` 旗標，輸出 API 呼叫詳情與 token 用量
- [ ] 卡片去重：相同單字 / 相同 Cloze 文本跨區塊合併
- [ ] 多重填空支援：允許 `{{c1::}}` 和 `{{c2::}}` 並存
- [ ] `exporter.ts` 改用 `db.transaction()` 批次插入，提升匯出效能
- [ ] API 呼叫加入 retry + exponential backoff（速率限制保護）
- [ ] 支援讀取 `.env.local`，或提供 `--api-key` CLI 參數
- [ ] 新增 `--sort` 選項：卡片依字母 / 類型排序後匯出
- [ ] 移除未使用的 devDependency：`@types/archiver`

## Mock 模式

Mock 模式的待修項目獨立維護於 [mock/TODOS.md](mock/TODOS.md)。
