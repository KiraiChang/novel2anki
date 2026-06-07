# NOTES

> 架構決策、實作細節與注意事項。新增時附上日期。

- **`.apkg` 格式**：本質是 ZIP 壓縮檔，內含 `collection.anki2`（SQLite）與 `media`（媒體清單 JSON）。Anki 讀取時依模型 ID 識別卡片類型，因此 ID 常數（`1715000001` 等）一旦有卡片產出後不可變更，否則 Anki 會視為新模型。

- **Prompt Caching**：`generator.ts` 在系統提示上加了 `cache_control: { type: 'ephemeral' }`，讓同一 session 內的系統提示命中快取，減少 token 費用。

- **工具呼叫強制 JSON**：Claude API 呼叫使用 tool_use 模式取代直接解析文字，確保回應為結構化 JSON，避免自由格式文字的解析問題。

- **CHUNK_TARGET_CHARS = 3000**：PDF/EPUB 提取器的目標區塊大小，過小會使 Claude 缺乏情境，過大會逼近 token 上限並增加費用，調整時需同步評估字卡品質。

- **情節卡雙向**：情節卡使用 `MODEL_BASIC_REVERSED_ID`，會在 `notes` 插入一個 note 並在 `cards` 插入 `ord=0`（正向）和 `ord=1`（反向）兩張卡片，是 Anki 原生雙向學習機制。

- **Mock 模式限制**：Mock 產生的卡片以規則式提取（長單字、大寫名詞、固定問題），品質低，僅用於測試整條流程，不代表正式輸出品質。

- **`@types/archiver` 為殘留相依**：專案最終改用 `jszip` 打包，`archiver` 未被引用，可安全移除。

- **NLP 管線分兩套工具負責 POS 與 lemma**：`tokenizer.ts` 以 compromise 對全句做一次 `nlp(text)` 取得上下文 POS（`Verb / Noun / Adjective` 等）；`lemmatizer.ts` 改用 wink-lemmatizer 做詞形還原（`verb()` / `noun()` / `adjective()`，輸入統一 lowercase）。原本 compromise 的 `toInfinitive()` / `toSingular()` 不處理形容詞比較級/最高級，換用 wink-lemmatizer 後 `faster→fast`、`best→good`、`worst→bad` 等案例全部正確。wink-lemmatizer 找不到對應形式時回傳空字串，程式以 `|| lower` 作 fallback，不影響整體流程。
- **不引入 wink-tokenizer**：其輸出只有 `{ value, tag: 'word' }` 無 POS，無法取代 compromise 的 POS 標記步驟；而 compromise 的 tokenizer 對英文散文已足夠，故不引入。

- **DeepL 批次採交錯排列而非分段排列**：原始設計是 `[def1…defN, sent1…sentN]`（定義與句子各一段），改為 `[def1, sent1, def2, sent2, …]`（交錯）後，每個定義的 DeepL 上下文鄰居是同一個詞的例句，而非其他詞的定義，利用 DeepL 的 context-aware 翻譯選出正確詞義（如 `(noun) Heaven` 在 "as he lost his fear" 語境下不會被翻成「天堂」）。

- **字典 API 選用 Merriam-Webster 作為主要來源**：Free Dictionary API（dictionaryapi.dev，Wiktionary 資料）的第一筆定義常為冷僻義（`above` adjective → "Of heaven; heavenly"）。MW Collegiate API 的 `shortdef` 欄位為人工編輯的教學向定義，無需另行清理格式符號；免費方案 1000 req/day 已足夠使用（100 詞 = 100 次查詢）。設定 `MW_API_KEY` 後自動優先使用，未設定或查詢失敗時 fallback 到 Free Dictionary API，不影響既有流程。

- **CEFR 詞表篩選範圍為 B1-C2**：A1/A2 為過於基礎的詞彙，讀英文小說的使用者無需特別學習，管線在 `generateVocabSuggestions` 時直接過濾掉。

- **NLP 管線失敗時降級為空 vocabSuggestions**：`processChunk` 內以 try/catch 包覆，失敗時回傳 `EMPTY_CHUNK_NLP`，三個生成器各自有 `suggestions.length === 0` 的降級路徑，整體流程不中斷。

- **離線模式選用 Ollama 原生 `/api/chat` 而非 `/v1/chat/completions`**：原生端點支援 `format.json_schema` 結構化輸出，OpenAI 相容層不一定透傳此功能。

- **離線模式改循序呼叫**：Claude API 模式使用 `Promise.all` 並行發出 4 個請求；Ollama 模式改為循序 `await`，原因是本地 Ollama 同一時間只能跑一個推理任務，並行請求不會加速，徒增 HTTP 連線開銷。

- **不引入 `ollama` npm 套件**：Node 18+ 內建的 `fetch()` 足以呼叫 Ollama REST API，不引入額外套件可降低相依風險，且 `fetch` API 對使用者更易讀。
