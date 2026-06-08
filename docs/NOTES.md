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

- **字典 API 選用 Merriam-Webster Learner's Dictionary 作為主要來源**：Free Dictionary API（dictionaryapi.dev，Wiktionary 資料）的第一筆定義常為冷僻義（`above` adjective → "Of heaven; heavenly"）。MW Learner's API 的 `shortdef` 欄位為人工編輯的教學向定義，無需另行清理格式符號；免費方案 1000 req/day 已足夠使用（100 詞 = 100 次查詢）。**注意：dictionaryapi.com 上有多種字典產品（Collegiate、Learner's、Medical…），每個字典各有獨立 API key；填錯會收到 403 並靜默 fallback，現已加上 stderr 警告訊息。** 申請時需選擇 "Merriam-Webster's Learner's Dictionary"。設定 `MW_API_KEY` 後自動優先使用，未設定或查詢失敗時 fallback 到 Free Dictionary API，不影響既有流程。

- **NER 人名保護：預建人名表流程**（`src/nlp/nameProtector.ts`、`src/csv/beginnerExporter.ts`）：DeepL 會把常見英文詞當人名使用的角色名音譯或誤譯（如 "Pony" → "小馬"）。解決方式：翻譯前將例句中的專有名詞換成 `__PERSON_N__` 佔位符，翻譯後再還原。**新流程（預建人名表）**：`--beginner` 掃描結束後，從所有 `bestSentence` 收集專有名詞，輸出到 `{slug}-beginner-names.txt`（純文字，一行一名詞，含說明注釋），使用者可在翻譯前手動確認、新增或刪除。`--deepl` 翻譯時自動讀取同目錄的 `*-beginner-names.txt`，以預建名詞集取代即時偵測（`translateBeginnerWordsCsv` 的 `prebuiltNames` 選項）。偵測策略：① compromise `.people()` + `#ProperNoun`；② mid-sentence 大寫詞（token 索引 > 0）。限制：若某人名在整書 bestSentence 中都只出現在句首且 compromise 未識別，則不出現在自動偵測結果中，使用者需手動加入人名檔。NER 相關函式（`buildProperNounSet`、`protectNames`、`restoreNames`、`saveNamesFile`、`loadNamesFile`）集中於 `nameProtector.ts`，供 exporter 與 translator 共用。

- **`extractSentences` 以換行符切割防止詩節混入**（`src/nlp/globalFreqAnalyzer.ts`）：原本只在 `.!?` 後切句，書中詩節（如 `"The shining sword, the horse's run,\nThe bane of monsters all and one."`）整段被視為單一句子並帶著 `\n` 存入 occurrence。改為同時在 `\n+` 處切割後，詩行各自成為獨立候選句（不含換行符），Sentence Mining 評分後分數低於正常敘述句而不被選中。修正後詩/分行比例從 3.1% 降至 0%，純敘述從 87.6% 升至 91.4%。

- **例句評分採 Sentence Mining 原則**（`src/nlp/sentenceScorer.ts`）：有意義的例句定義為「離開原書後仍能獨立理解，且能幫助推測目標單字」。評分標準：
  - **對話懲罰 -5**：以引號 / em dash 開頭，或 >55% 字元在引號內 → 依賴說話者與對話脈絡，無法獨立理解
  - **代詞開頭懲罰 -2**：He / She / They / His / Her / Their 開頭 → 需要前文才知道指涉對象
  - **說話動詞懲罰 -1**：said / whispered / replied… 出現在非對話句 → 語境稍弱
  - **純敘述加分 +2**：無任何引號 → 最適合獨立學習
  - **長度理想區間 40–120 +5**（原 30–100）：SM 需要足夠前後文供讀者推測詞義
  - 代詞開頭雖有 -2，但詞位置好可補回 +2，因此在候選句有限時仍可能被選中；有多個候選句時會輸給同分的無代詞敘述句

- **初學者字彙統計 HTML 為自含式靜態頁面**：`beginnerStatsExporter.ts` 產生的 HTML 不依賴任何外部資源（CDN、框架），所有樣式與 JS 內嵌，可離線瀏覽。排序邏輯在瀏覽器端以 vanilla JS 實作（約 40 行），數字欄（排名、出現次數）用 `parseFloat` 判斷，字串欄用 `localeCompare('zh-TW')`。詞彙表來自 words CSV 的 `global_frequency` 欄；舊版 CSV（7 欄，無 `global_frequency`）讀到的頻率為 0，需重新跑 `--beginner` 產生 8 欄 CSV 後才能正確顯示。

- **初學者模式匯入不過濾空翻譯**：`beginnerImporter.ts` 的三個函式（`importBeginnerWords`、`importBeginnerWordsFromFiles`、`mergeTokensToVocabCards`）不再過濾 `definition_zh` 為空的列。未翻譯的單字也會合併成 VocabCard，Anki 字卡背面定義欄位顯示空白，讓使用者可以在不完整翻譯的情況下仍能匯出並學習例句。

- **CEFR 詞表篩選範圍為 B1-C2**：A1/A2 為過於基礎的詞彙，讀英文小說的使用者無需特別學習，管線在 `generateVocabSuggestions` 時直接過濾掉。

- **CEFR 詞表擴充歷程**（`src/data/cefr-wordlist.json`，2026-06-07 更新）：原始 853 詞實為 AWL（Academic Word List），與一般 CEFR 標準差距極大（UNKNOWN 率高達 86%）。已三輪擴充至 5732 詞：
  1. **Oxford 5000 整合**（`scripts/process-oxford.py`）：從 GitHub repo `tyypgzl/Oxford-5000-words`（`full-word.json`，5948 筆）下載，轉換為 `word:level` 格式；同字多詞性取最低 CEFR 等級（最容易的用法），得 4954 個 unique words。Oxford 資料為英式拼寫（defence、colour、centre…），美式拼寫另行補充。
  2. **奇幻/敘事補充詞**（約 600 詞）：Oxford 5000 聚焦學術/商業詞彙，缺少中世紀奇幻常見詞（sword、armor、dragon 等）與常用敘事動詞（stride、gasp、groan 等），手動補充並對應 CEFR 等級。
  3. **美式英語拼寫別字**：defense→B2, center→A1, theater→A1, fulfill→B2 等。
  最終 UNKNOWN 率（《The Demon Awakens》）：86% → 37.8%。剩餘 37.8% 以奇幻發明詞（centaur, dactyl, powrie, fomorian）為主，無法分配標準 CEFR 等級，屬正常現象。

- **NLP 管線失敗時降級為空 vocabSuggestions**：`processChunk` 內以 try/catch 包覆，失敗時回傳 `EMPTY_CHUNK_NLP`，三個生成器各自有 `suggestions.length === 0` 的降級路徑，整體流程不中斷。

- **離線模式選用 Ollama 原生 `/api/chat` 而非 `/v1/chat/completions`**：原生端點支援 `format.json_schema` 結構化輸出，OpenAI 相容層不一定透傳此功能。

- **離線模式改循序呼叫**：Claude API 模式使用 `Promise.all` 並行發出 4 個請求；Ollama 模式改為循序 `await`，原因是本地 Ollama 同一時間只能跑一個推理任務，並行請求不會加速，徒增 HTTP 連線開銷。

- **不引入 `ollama` npm 套件**：Node 18+ 內建的 `fetch()` 足以呼叫 Ollama REST API，不引入額外套件可降低相依風險，且 `fetch` API 對使用者更易讀。

- **個人單字庫採 `word:pos` 為 key，不綁定書籍語境**（`src/nlp/wordCache.ts`，2026-06-08）：若用 `word` 作 key，`bear` 的名詞定義會污染動詞查詢（反之亦然）。改用 `word:pos`（如 `bear:verb`、`bear:noun`）後，每個 POS 各自獨立快取，不同書中相同字的不同用法互不干擾。查找時精確匹配 `word:pos` → fallback 到 `word`（無 POS 時的通用快取），向下相容無 POS 的舊資料。

- **三層快取設計的邊界清晰度**（`src/nlp/wordCache.ts`）：`word-dict.json`（精選）永遠不被程式自動覆寫，只有 `--update-dict` 時由使用者明確升級；`word-cache.json`（自動）可隨時整個刪除重建，不影響精選庫。兩個檔案各自獨立的 dirty flag 確保未修改的檔案不被重複寫入。這個設計讓不同書的書級定義（CSV 的 `definition_en`）與全局精選定義（word-dict）之間有明確的層次，不相互污染。

- **MW 預查 `definition_en` 欄位作為查找鏈的快取橋樑**（`src/csv/beginnerDeeplTranslator.ts`，2026-06-08）：`definition_en` 是 CSV 層的 book-scope 覆寫機制。`--mw` 從三層快取填入此欄；使用者手動修改此欄是書級客製化（不影響全局快取）；`--update-dict` 是使用者主動將書級編輯升級為全局精選。`--deepl` 看到 `definition_en` 有值就直接使用，不再查 API，這也使 DeepL 重跑時無需重複 MW 查詢。
