# NOTES

> 架構決策、實作細節與注意事項。新增時附上日期。

- **`.apkg` 格式**：本質是 ZIP 壓縮檔，內含 `collection.anki2`（SQLite）與 `media`（媒體清單 JSON）。Anki 讀取時依模型 ID 識別卡片類型，因此 ID 常數（`1715000001` 等）一旦有卡片產出後不可變更，否則 Anki 會視為新模型。

- **Prompt Caching**：`generator.ts` 在系統提示上加了 `cache_control: { type: 'ephemeral' }`，讓同一 session 內的系統提示命中快取，減少 token 費用。

- **工具呼叫強制 JSON**：Claude API 呼叫使用 tool_use 模式取代直接解析文字，確保回應為結構化 JSON，避免自由格式文字的解析問題。

- **CHUNK_TARGET_CHARS = 3000**：PDF/EPUB 提取器的目標區塊大小，過小會使 Claude 缺乏情境，過大會逼近 token 上限並增加費用，調整時需同步評估字卡品質。

- **情節卡雙向**：情節卡使用 `MODEL_BASIC_REVERSED_ID`，會在 `notes` 插入一個 note 並在 `cards` 插入 `ord=0`（正向）和 `ord=1`（反向）兩張卡片，是 Anki 原生雙向學習機制。

- **Mock 模式限制**：Mock 產生的卡片以規則式提取（長單字、大寫名詞、固定問題），品質低，僅用於測試整條流程，不代表正式輸出品質。

- **`@types/archiver` 為殘留相依**：專案最終改用 `jszip` 打包，`archiver` 未被引用，可安全移除。

- **NLP 管線使用 compromise 的 POS 分類做形態還原**：`Verb / Infinitive / PastTense / Gerund` 類的 token 用 `toInfinitive()` 還原，`Noun / Plural` 用 `toSingular()` 還原，其他類直接用 `normal`（小寫去標點）。compromise v14 不規則動詞覆蓋率約 95%，少數找不到的詞會 fallback 到 normal，僅影響 CEFR 查不到對應詞條，不會報錯。

- **CEFR 詞表篩選範圍為 B1-C2**：A1/A2 為過於基礎的詞彙，讀英文小說的使用者無需特別學習，管線在 `generateVocabSuggestions` 時直接過濾掉。

- **NLP 管線失敗時降級為空 vocabSuggestions**：`processChunk` 內以 try/catch 包覆，失敗時回傳 `EMPTY_CHUNK_NLP`，三個生成器各自有 `suggestions.length === 0` 的降級路徑，整體流程不中斷。

- **離線模式選用 Ollama 原生 `/api/chat` 而非 `/v1/chat/completions`**：原生端點支援 `format.json_schema` 結構化輸出，OpenAI 相容層不一定透傳此功能。

- **離線模式改循序呼叫**：Claude API 模式使用 `Promise.all` 並行發出 4 個請求；Ollama 模式改為循序 `await`，原因是本地 Ollama 同一時間只能跑一個推理任務，並行請求不會加速，徒增 HTTP 連線開銷。

- **不引入 `ollama` npm 套件**：Node 18+ 內建的 `fetch()` 足以呼叫 Ollama REST API，不引入額外套件可降低相依風險，且 `fetch` API 對使用者更易讀。
