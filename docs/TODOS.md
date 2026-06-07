# TODOS

> 待實作功能，按優先順序排列。完成後將 `[ ]` 改為 `[x]` 並標註完成日期。

- [x] 同步產生 HTML 預覽檔，可直接用瀏覽器查看所有字卡（`src/html/exporter.ts`）
- [x] 離線模式：`--offline` 旗標透過本機 Ollama 產生字卡，`--model` 自訂模型名稱（`src/cards/offlineGenerator.ts`）
- [x] NLP 前處理管線：compromise tokenize → lemma → 詞頻 → CEFR 分級，提供 `vocabSuggestions` 給所有生成模式（`src/nlp/`）
## 初學者模式（`--beginner`）

- [ ] **升級字典 API**（`src/csv/beginnerDeeplTranslator.ts`）：目前使用 `dictionaryapi.dev`（Wiktionary 資料），部分詞彙的第一筆定義偏向冷僻或古義（如 `above` → "Of heaven"、`course` → "to flow"）。建議改用 Merriam-Webster Collegiate Dictionary API（免費，1000 req/day，需申請 key：`dictionaryapi.com`）或 WordsAPI（RapidAPI 免費層，2500 req/day）。升級後配合現有 POS 比對與 `isUsable` 過濾，可大幅提升英文定義品質。
  - **相關設計**：`fetchEnglishDefinition(word, pos)` 已支援 POS 優先比對，直接替換 API 呼叫即可；新 key 可透過環境變數 `MW_API_KEY` / `WORDS_API_KEY` 傳入。

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
