# TODOS

> 待實作功能，按優先順序排列。完成後將 `[ ]` 改為 `[x]` 並標註完成日期。

- [x] 同步產生 HTML 預覽檔，可直接用瀏覽器查看所有字卡（`src/html/exporter.ts`）
- [x] 離線模式：`--offline` 旗標透過本機 Ollama 產生字卡，`--model` 自訂模型名稱（`src/cards/offlineGenerator.ts`）
- [x] NLP 前處理管線：compromise tokenize → lemma → 詞頻 → CEFR 分級，提供 `vocabSuggestions` 給所有生成模式（`src/nlp/`）
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
