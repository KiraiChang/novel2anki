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

- **`NAME_SKIP` 改為小寫比對，修復代名詞被保護導致不翻譯**（`src/nlp/nameProtector.ts`，2026-06-10）：原本 NAME_SKIP 存首字大寫版本（`'His'`、`'Her'` 等），但 `buildProperNounSet` 比對用 `NAME_SKIP.has(clean)`，當 compromise 的 `#ProperNoun` 回傳小寫 `'his'` 時，`NAME_SKIP.has('his')` 為 false，導致 `'his'` 被加進人名保護集，翻譯後被還原為英文原文而非中文。修復：NAME_SKIP 統一改為小寫儲存，比對一律用 `clean.toLowerCase()`；同時補充完整代名詞清單（he/she/they/we/him/her/them/us/me/his/my/your/our/their/its 及反身代名詞、關係代名詞）。

- **NER 人名保護：預建人名表流程**（`src/nlp/nameProtector.ts`、`src/csv/beginnerExporter.ts`）：DeepL 會把常見英文詞當人名使用的角色名音譯或誤譯（如 "Pony" → "小馬"）。解決方式：翻譯前將例句中的專有名詞換成 `__PERSON_N__` 佔位符，翻譯後再還原。**新流程（預建人名表）**：`--beginner` 掃描結束後，從所有 `bestSentence` 收集專有名詞，輸出到 `{slug}-beginner-names.txt`（純文字，一行一名詞，含說明注釋），使用者可在翻譯前手動確認、新增或刪除。`--translate` 翻譯時自動讀取同目錄的 `*-beginner-names.txt`，以預建名詞集取代即時偵測（`translateBeginnerWordsCsv` 的 `prebuiltNames` 選項）。偵測策略：① compromise `.people()` + `#ProperNoun`；② mid-sentence 大寫詞（token 索引 > 0）。限制：若某人名在整書 bestSentence 中都只出現在句首且 compromise 未識別，則不出現在自動偵測結果中，使用者需手動加入人名檔。NER 相關函式（`buildProperNounSet`、`protectNames`、`restoreNames`、`saveNamesFile`、`loadNamesFile`）集中於 `nameProtector.ts`，供 exporter 與 translator 共用。

- **翻譯來源欄位 `definition_zh_source` / `context_sentence_zh_source` / `definition_en_source`**（`src/csv/beginnerTranslator.ts`、`src/csv/beginnerExporter.ts`，2026-06-11）：CSV 三個 source 欄各自記錄對應欄位的來源，採相同優先序設計（空 = 0 < `cache` = 1 < `deepl`/`azure`/`google`/`claude`/`chatgpt` = 2 < `csv` = 3）。

  **`definition_zh_source` / `context_sentence_zh_source`**：`--translate` 翻譯後寫入 `config.provider`；`--fill-sent-zh` / `--fill-def-zh` cache→CSV 方向只在優先序 ≤ 1（空或 `cache`）時填入，**寫入快取條目中儲存的原始來源**（`getSentenceZhSource` / `getChineseSource` / `DefinitionLayerCache.getSource`），來源 null 時退回 `'cache'`。舊 CSV 自動插入（`context_sentence_zh_source` 插在 `context_sentence_zh` 後；`definition_zh_source` 插在 `definition_zh` 後），sync 函式無 source 欄時跳過優先序檢查保持向後相容。

  **`definition_en_source`**：`--mw` 執行 `fetchBeginnerWordsMW` 後寫入正規化來源字串（`'mw'` / `'free'` / `'fallback'` / `'cache'` / `'dict'`；API 回傳 `'MW'` → `'mw'`；`'cached'` → `'cache'`；其餘小寫直寫）；舊 CSV 無此欄時自動插入（插在 `definition_en` 後）。`--fill-def-zh` 雙向同步時：CSV→cache 方向讀取 `defEnSrc` 欄並原樣傳入 `setEnIfEmpty`（避免來源被升格）；cache→CSV 方向以 `getEnSource()` 取得各層真實來源寫入此欄，來源 null 時退回 `'cache'`。

  共通：`csv` source 為保留值，使用者可手動填入以保護人工校正不被任何自動填入覆蓋；避免 cache 覆蓋已有 API 翻譯，且 source 欄能正確反映來源品質。

- **新增翻譯來源時需調整的位置**（2026-06-11）：source 字串不在優先序 map 時 fallback 為 0（等同空白），導致該翻譯可被 `cache` 覆蓋。新增任何翻譯後端或手動來源標籤時，必須同步更新以下兩處，否則 sync 保護失效：
  1. `src/csv/beginnerTranslator.ts` → `SOURCE_PRIORITY`（`canFillFromCache` 所用）
  2. `src/nlp/wordCache.ts` → `SENTENCE_SOURCE_PRIORITY`（`setSentenceZh` 所用）
  - 一般翻譯 API（非人工校正）設為 `2`，與 deepl/azure/google/claude/chatgpt 同級。
  - HTML / Anki 匯出不讀 source 欄，無需調整。

- **人名檔支援中文音譯 mapping，同時將宗教/軍事頭銜加入 NAME_SKIP**（`src/nlp/nameProtector.ts`，2026-06-10）：角色名如 "Markwart" 可透過名詞檔的 `Markwart: 馬克瓦特` 格式指定音譯，`restoreNames` 第三參數 `translationMap?: Map<string, string>` 接收 `loadNamesFile` 的回傳值，有中文值則替換為中文，無中文值則保留英文原名。`loadNamesFile` 同時支援舊格式（一行一名詞）與新格式（`英文: 中文`），回傳 `Map<string, string>`；`saveNamesFile` 合併現有條目與新偵測到的名詞（保留現有 mapping，只補新名詞），避免人工音譯被覆蓋。宗教（Father / Abbot / Brother / Sister / Friar…）、封建（Sir / King / Queen / Duke…）、軍事（Captain / General / Colonel…）等頭銜統一加入 NAME_SKIP，翻譯後端可直接翻譯「神父 院長 馬克瓦特」而非保留英文 "Father Abbot Markwart"。`prebuiltNames` 型別由 `Set<string>` 改為 `Map<string, string>` 後，`properNouns` 從 `new Set(namesMap.keys())` 取得，保護集與音譯映射共用同一個 Map 物件。

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

- **MW 預查 `definition_en` 欄位作為查找鏈的快取橋樑**（`src/csv/beginnerTranslator.ts`，2026-06-08）：`definition_en` 是 CSV 層的 book-scope 覆寫機制。`--mw` 從三層快取填入此欄；使用者手動修改此欄是書級客製化（不影響全局快取）；`--update-dict` 是使用者主動將書級編輯升級為全局精選。`--translate` 看到 `definition_en` 有值就直接使用，不再查 API，這也使重跑時無需重複 MW 查詢。

- **中文快取 `word-cache-zh.json` 獨立分離，不與英文快取混用**（`src/nlp/wordCache.ts`，2026-06-08）：中文快取採純字串 `Record<string, string>`，key 格式同英文（`word:pos` / `word`），查找 fallback 邏輯相同。分離的原因：英文定義快取（`word-cache.json`）記錄來源（`source: 'MW' | 'free'`），中文翻譯不需要此元資料，分離可保持各自檔案易讀、易手動編輯，也允許獨立清空重建某一語言的快取而不影響另一個。

- **翻譯後端切換：多後端邏輯集中於 `translator.ts`，CLI 改用語意中性的 `--translate`**（`src/cards/translator.ts`、`src/index.ts`，2026-06-08 / 2026-06-10）：`TranslatorConfig { provider, apiKey, region? }`；`loadTranslatorConfig()` 讀取 `TRANSLATE_PROVIDER` env（預設 `deepl`）；`batchTranslate(texts, config)` 路由到對應後端。CLI flag 原為 `--deepl` / `--deepl-force`，已更名為 `--translate` / `--translate-force`，避免誤導使用者以為一定走 DeepL。翻譯模組同步更名：`beginnerDeeplTranslator.ts` → `beginnerTranslator.ts`，`deeplTranslator.ts`（薄包裝層）已刪除，所有呼叫者直接引用 `translator.ts`。Google 和 Azure 後端使用 Node 18+ 內建 `fetch()`（不引入新 npm 套件），Claude 後端複用已有的 `@anthropic-ai/sdk`。

- **例句快取採 FNV-1a 32-bit hash 為 key，不用原文字串**（`src/nlp/wordCache.ts`，2026-06-09）：key 若使用例句原文，JSON 中每筆 key 可達 80–150 字元，大量記錄時快取檔可觀。改用 FNV-1a 32-bit（`h ^= charCode; h = Math.imul(h, 0x01000193) >>> 0`）得到 8 字元 hex，快取檔可讀、效能最佳。32-bit 的碰撞空間為 2³² ≈ 43 億，對於數萬筆例句碰撞機率可忽略（生日攻擊門檻 ≈ 65,536 筆才達 1‰）；value 中保留 `en` 原文，碰撞時可人工比對。

- **`sentence-cache.json` 與 `word-cache-zh.json` 獨立分離，不合併入同一檔案**（`src/nlp/wordCache.ts`，2026-06-09）：例句快取的 key 為 hash、value 含 `en`/`zh` 兩欄，與詞義快取（key=lemma:pos、value=翻譯字串）結構完全不同。分離可讓使用者獨立清空某一類快取、易於手動查閱，也使兩個 dirty flag 互不干擾。


- **`WORD_CACHE_PATH` 同時控制使用者資料與參考資料的存取路徑**（`src/nlp/dataPath.ts`，2026-06-10）：原本 `WORD_CACHE_PATH` 只控制使用者資料（word-dict / word-cache / word-cache-zh / sentence-cache），`cefrLookup.ts` 與 `cefrPrefetcher.ts` 則用硬編碼的 `path.join(__dirname, '../data/cefr-wordlist.json')`。擴充後統一透過 `resolveDataPath(name)` 查找：先檢查 `$WORD_CACHE_PATH/<name>`，找不到退回 `src/data/<name>`。好處：使用者只需設定一個環境變數就能把所有可變資料（含 CEFR 字庫、片語庫）移到外部目錄；`src/data/` 整個加入 `.gitignore`，避免資料被意外提交。未設定 `WORD_CACHE_PATH` 時仍可從 `src/data/` 讀到內建資料，向下相容。選擇複用 `WORD_CACHE_PATH` 而非另立 `DATA_PATH`，是因為不希望 `.env.example` 多一個變數讓使用者困惑。

- **`phrase-cache.json` 同時快取 MW 命中與查無結果（no-def）**（`src/nlp/cefrPrefetcher.ts`，2026-06-10）：片語庫有 1,409 個片語，但 MW Learner's Dictionary 收錄多字片語的比例偏低（預估命中率 20–30%）。若只快取命中結果，每次重跑都會對剩餘 ~1,000 個未命中片語重打 MW API，浪費查詢配額。因此採「全快取」策略：命中存 `{ def, source: 'MW' }`，查無結果存 `{ def: '', source: 'no-def' }`，`hasPhrase()` 兩種情況均回傳 `true`。需重查時刪除 `phrase-cache.json` 即可，不影響其他快取檔案。

- **片語庫從三份 PDF 以座標解析建立，不用現成 NLP 套件**（`scripts/extract-phrase-lists.py`，2026-06-10）：OPAL Spoken（~250 phrases）、OPAL Written（~370 phrases）、Oxford Phrase List（750 phrases，A1–C1）格式相似，均為四欄排版（欄邊界 x ≈ 173/303/434 pt）。使用 pdfplumber `extract_words()` 取得每個詞的座標，按 `row_y` + `col` 分組拼接成行，不走 PDF 的原始文字流（可能排版混亂）。OPL 另用字型名稱（`UtopiaStd-Bold`）識別 CEFR 等級標記（A1/A2/B1/B2/C1），因 y 座標偵測在第 2–4 頁的等級行（y ≈ 114 pt）會被誤判為頁首 → 等級標記從不按 y 門檻過濾，只有非等級的片語內容才套用 y 範圍限制。片語正規化分四步：① 循環剝除開頭括弧前綴（最多 4 輪）；② 展開尾部可選詞（`as a result (of)` → 兩條目）；③ 剝除尾部代詞佔位符（sb/sth/yourself/oneself）；④ 以 ` / ` 拆分備選形式。最終 `phrase-list.json` 含 1,409 個不重複片語鍵。

- **CLI 一律在 header 顯示執行指令與快取路徑**（`src/index.ts`，2026-06-09）：從 `process.argv.slice(2)` 重建執行指令字串（含空白的參數加引號），搭配 `WORD_CACHE_PATH` env（或預設 `~/.novel2anki`）計算快取目錄，在所有指令的 header 統一輸出。方便使用者確認當下執行的是哪一個 CSV 路徑，以及資料寫入哪個目錄，避免因快取路徑設定不同而導致資料寫錯位置。

- **`--fill-def-zh` 分層快取設計：global 與 domain/book 互補不重疊**（`src/csv/beginnerTranslator.ts`、`src/nlp/wordCache.ts`，2026-06-10）：兩層寫入條件互斥——global 只收 CEFR level 已知的詞（非 UNKNOWN）；domain / book 只收 CEFR UNKNOWN 的詞（不在 CEFR 字庫內）。這樣設計使兩層完全互補：全局快取處理通用詞彙（A1–C2），domain/book 快取處理領域/書本特有詞彙（奇幻自創詞、角色名等），不會重疊。CLI 語法：`--fill-def-zh=fantasy` 或 `--fill-def-zh=fantasy,the-demon-awakens`（以 `=` 帶值、`,` 分隔，避免 `|` 在 shell 被解讀為 pipe）。查詢優先順序固定為 book → domain → global，global 永遠作最後 fallback。

- **`DefinitionLayerCache.setIfEmpty` 不覆寫現有條目**（`src/nlp/wordCache.ts`，2026-06-10）：domain / book 快取的寫回（CSV → cache）採 `setIfEmpty`——若 key 已有值則保留，僅在空白時寫入。這讓人工精修的 domain/book 翻譯不被後續自動翻譯覆蓋，且同時處理 domain + book 時不需考慮寫入順序。回傳 bool 表示是否實際寫入，搭配 `savedToCache` 計數器只在至少一層確實寫入時才加 1。

- **`DefinitionLayerCache` zh 格式升級為 `CacheZhEntry`，新增英文 en 快取**（`src/nlp/wordCache.ts`，2026-06-10）：zh 快取原先採純字串 `Record<string, string>`，已升級為 `Record<string, CacheZhEntry>`（`{zh, source}`）——與全局 `word-cache-zh.json` 格式完全一致，方便手動查閱與工具整合。同時新增英文 en 快取（`{type}_{name}_cache.json`）儲存領域/書本的英文定義，結構同 `word-cache.json`（`{def, source}`）。`setEnIfEmpty(word, pos, def, source)` / `getEn(word, pos)` 供 `syncDefinitionCacheWithCsv` 呼叫。向下相容：讀取舊格式純字串值時自動升級為 `{zh, source: 'legacy'}`，現有快取檔案無需手動遷移。

- **`syncDefinitionCacheWithCsv` 同時同步 `definition_en` 與 `definition_zh`**（`src/csv/beginnerTranslator.ts`，2026-06-10）：兩欄各自獨立雙向同步——`definition_en` 空白時從 book → domain en cache → `wc.get()` 補填（例如 `--prefetch-cefr` 建立的 `word-cache.json` 定義直接填回 CSV）；`definition_en` 非空時，UNKNOWN 詞寫入 domain/book en cache（`setEnIfEmpty`），CEFR 已知詞寫入全局 `word-cache.json`（`setCache`）。計數器邏輯：write 優先於 fill；同一列可以同時有 zh 寫入與 en 補填，以 `wroteAny` 優先計入 `savedToCache`。

- **`translateBeginnerWordsCsv` Phase 3：`definition_zh` 由「每列覆寫」改為「空白才寫入」**（`src/csv/beginnerTranslator.ts`，2026-06-10）：原始設計對 `definition_zh` 無條件覆寫，但 `needTranslation` 現在也包含「definition_zh 已有但 context_sentence_zh 空白」的列，若仍無條件覆寫會將人工校正的定義抹掉。改為與 `context_sentence_zh` 相同的邏輯：已有值則跳過，force 模式才強制覆寫。

- **`needTranslation` 過濾條件擴充，修復 context_sentence_zh 永遠空白問題**（`src/csv/beginnerTranslator.ts`，2026-06-10）：原本過濾條件只看 `definition_zh` 是否空白，導致「definition_zh 已填、context_sentence_zh 空白」的列被跳過，例句翻譯永遠為空（除非 `--translate-force`）。改為 OR 條件：任一欄空白即納入翻譯。

- **`sentence-cache.json` 加入 `source` 欄位，`setSentenceZh` 採優先序保護**（`src/nlp/wordCache.ts`，2026-06-11）：`SentenceCacheEntry` 新增必填 `source: string`，與 CSV source 欄採相同優先序（`''`=0 < `cache`=1 < API=2 < `csv`=3）。`setSentenceZh(en, zh, source)` 回傳 `boolean`：現有條目 source 非 `''` 且新來源優先序 ≤ 現有時跳過（回傳 `false`）；現有 `''` 時無條件覆蓋（舊條目或未知來源）；同優先序（如 deepl vs deepl）跳過，保留較早的版本。`syncSentenceCacheWithCsv` 改為依回傳值計 `savedToCache` / `skippedCache`，移除舊的 `getSentenceZh` 預查。舊 `sentence-cache.json` 無 `source` 欄時由 `loadSentenceCache()` 補 `''`，已遷移的快取檔手動補 `"source": "deepl"`。

- **Token 正規化在 `tokenize` 前套用，`occurrence.sentence` 保留原文**（`src/nlp/globalFreqAnalyzer.ts`、`src/nlp/tokenNormalizer.ts`，2026-06-11）：正規化的目的是讓 CEFR lookup 能識別古語（`yer` → `your` → A1），但例句顯示在 Anki 字卡上應保持原書文字，不應把 `yer` 換成 `your`。因此 `applyNormalization` 僅作用於送入 `tokenize` 的句子副本，`occurrence.sentence` 仍存原始句子。雞生蛋問題：第一次 `--beginner` 掃描時 normalize 檔不存在（尚未產生），正規化不套用；掃描結束後自動比對 UNKNOWN 詞彙與 `archaic-en.json` 產生 `{slug}-normalize.json`；第二次掃描前 normalize 檔已存在，正規化自動載入生效。此模式與 `*-beginner-names.txt` 相同——使用者需跑兩次才能讓自動生成的設定參與掃描。

- **Token 正規化採非字母邊界 regex，支援含標點前綴的古語形式**（`src/nlp/tokenNormalizer.ts`，2026-06-11）：`applyNormalization` 使用 `(?<![a-zA-Z])…(?![a-zA-Z])` 而非 `\b`，原因是 `\b` 在 `'tis` 前的 `'` 會把 `'` 視為非字母邊界，`\b` 落在 `'` 與 `t` 之間，理論上也能比對；但實測 `'Tis` 中 `\b` 的行為因引擎而異，改用非字母環視（negative lookbehind / lookahead）可確保「前後字元均為非 a-z/A-Z 時才比對」，對 `'tis` 也正確作用，且不誤觸 `layer` / `player` 中的 `yer`（前一字元為字母，lookbehind 阻擋）。替換值保持小寫，tokenize 後統一處理大小寫，不影響 lemma 識別。

- **`{slug}-normalize.json` 保留人工修改，只補新命中條目**（`src/nlp/tokenNormalizer.ts`、`src/csv/beginnerExporter.ts`，2026-06-11）：`exportNormalizeFile` 先讀取現有 JSON（若存在），對 UNKNOWN 詞彙中命中 `archaic-en.json` 的詞，若 key 不在現有設定中才寫入（`!existing.has(canonical)`）。好處：使用者手動加入的條目（非 archaic 表收錄的方言、發明詞）或手動修改的值均不被覆蓋；新出現的古語詞自動補入。最終輸出依 key 排序，易於人工 diff 比對。`archaic-en.json` 與 `{slug}-normalize.json` 的關係：前者是靜態參考表（與書無關），後者是書本專屬的活設定（人工可擴充）。

- **`SEMANTIC_PREPOSITIONS` 白名單允許有語意的介系詞進入初學者字卡**（`src/nlp/beginnerFilter.ts`，2026-06-10）：`CONTENT_POS` 原本排除所有 `Preposition`，導致 `against`（靠著）、`beneath`（在…下面）等帶有明確方位語意的介系詞一律被過濾。直接加入 `Preposition` 到 `CONTENT_POS` 過於粗糙（會放入 `per`、`via`（功能性）等不值得學習的介系詞）；stopWords 已涵蓋 `about`/`around`/`through`/`within`/`despite`/`upon` 等高頻虛詞，stopWords 裡的介系詞走 `not-stopword` 路徑，不受白名單影響。白名單僅需涵蓋「不在 stopWords 但有語意」的介系詞（目前 17 個：against、amid、amidst、beneath、beyond、beside、besides、except、unlike、via、across、along、among、amongst、opposite、underneath、versus）。POS 誤標（compromise 有時把 `against` 誤標為 `Adjective`）不影響白名單邏輯，誤標的詞走 `CONTENT_POS.has('Adjective')` 通過；只有正確標為 `Preposition` 時才走白名單例外。
