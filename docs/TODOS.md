# TODOS

> 待實作功能，按優先順序排列。完成後將 `[ ]` 改為 `[x]` 並標註完成日期。

- [x] 同步產生 HTML 預覽檔，可直接用瀏覽器查看所有字卡（`src/html/exporter.ts`）
- [x] 離線模式：`--offline` 旗標透過本機 Ollama 產生字卡，`--model` 自訂模型名稱（`src/cards/offlineGenerator.ts`）
- [x] NLP 前處理管線：compromise tokenize → lemma → 詞頻 → CEFR 分級，提供 `vocabSuggestions` 給所有生成模式（`src/nlp/`）
## 初學者模式（`--beginner`）

- [x] **升級字典 API**（`src/csv/beginnerDeeplTranslator.ts`，2026-06-07）：已接入 Merriam-Webster Learner's Dictionary API（`MW_API_KEY` 環境變數，1000 req/day 免費，端點 `/learners/json`）作為主要字典來源，原 `dictionaryapi.dev` 降為 fallback。MW 的 `shortdef` 欄位定義精確、無交叉參照干擾，品質大幅優於 Wiktionary 資料。翻譯進度列同步顯示 `[MW]` / `[Free]` / `[fallback]` 標記。
- [x] **預建人名表**（`src/nlp/nameProtector.ts`、`src/csv/beginnerExporter.ts`，2026-06-07）：`--beginner` 掃描完成後，從所有 `bestSentence` 以 NER（compromise + mid-sentence 大寫詞）偵測專有名詞，輸出 `*-beginner-names.txt`（純文字，一行一名詞，含說明注釋）。使用者可在翻譯前確認 / 新增 / 刪除。`--deepl` 翻譯時自動讀取同目錄的 `*-beginner-names.txt`，以預建名詞集保護人名（原動態偵測作 backward-compat fallback）。NER 函式抽離至 `src/nlp/nameProtector.ts` 共用模組。
- [x] **CEFR 詞表升級至 Oxford 5000**（`src/data/cefr-wordlist.json`、`scripts/process-oxford.py`，2026-06-07）：原 853 詞 AWL 詞表 UNKNOWN 率 86%，已整合 Oxford 5000（4954 詞）+ 奇幻/敘事補充詞（778 詞），共 5732 詞。UNKNOWN 率降至 37.8%（《The Demon Awakens》），剩餘 UNKNOWN 以奇幻發明詞（centaur, dactyl, powrie）為主，無法分配標準 CEFR 等級。同步修復停用詞表（代名詞遺漏）及 cefrLookup 後綴剝離邏輯（24 條規則）。
- [x] **MW 預查旗標 `--mw`**（`src/csv/beginnerDeeplTranslator.ts`、`src/index.ts`，2026-06-08）：新增 `--mw` CLI 旗標，可單獨預查英文定義並寫入 CSV 的 `definition_en` 欄（DeepL 額度用完時先行備妥），亦可與 `--deepl` 組合一次完成。`--deepl` 運行時若 `definition_en` 已填則直接使用，跳過 MW API 呼叫。進度顯示新增 `[字典]`（精選）/ `[快取]`（自動）標記。
- [x] **三層個人單字庫**（`src/nlp/wordCache.ts`、`src/csv/beginnerDeeplTranslator.ts`，2026-06-08）：新增 `WordCacheManager`（`~/.novel2anki/word-dict.json` + `word-cache.json`），查找順序：word-dict（使用者精選）→ word-cache（MW 自動快取）→ MW API。key 格式 `word:pos`，不同書的同詞不互相污染。`--update-dict` 旗標可將 CSV 已編輯的 `definition_en` 升級到 word-dict，未來所有書優先使用。髒資料延遲寫盤（dirty flag），避免每詞一次磁碟 I/O。
- [x] **CEFR 字庫 MW 批次預查 `--prefetch-cefr`**（`src/nlp/cefrPrefetcher.ts`、`src/index.ts`，2026-06-08）：對 CEFR 字庫 5782 個詞批次預查 MW 英文定義，所有 POS 變體分別存入 `word-cache.json`；已快取的詞自動跳過，可中斷後重跑。MW 1000 req/day 限制下每天一次持續執行，約 6 天建完。
- [x] **CEFR 字庫中文批次翻譯 `--prefetch-cefr-zh`**（`src/nlp/cefrPrefetcher.ts`、`src/index.ts`，2026-06-08）：對 `word-cache.json` 中的英文定義批次翻譯為繁體中文，存入 `word-cache-zh.json`；已翻譯的詞自動跳過。5782 詞 × 平均 40 字元 ≈ 23 萬字元，在 DeepL/Azure 免費額度一次跑完。需先執行 `--prefetch-cefr`。
- [x] **翻譯後端多路切換**（`src/cards/translator.ts`，2026-06-08）：新增 `TranslatorConfig`（`provider` + `apiKey` + `region?`）統一介面，支援 DeepL / Google Translate / Azure Translator / Claude Haiku 四個後端。以 `TRANSLATE_PROVIDER` env var 切換（預設 `deepl`），`deeplTranslator.ts` 改為薄包裝層，既有呼叫者零修改。
- [x] **輸出前補填快取翻譯 `fillVocabTranslationsFromCache`**（`src/cards/translationFiller.ts`，2026-06-09）：新增 `fillVocabTranslationsFromCache(cards)`，在每個字卡輸出路徑執行前補填 `definition_zh`（查 `word-cache-zh.json`）與 `exampleZh`（查 `sentence-cache.json`）；已有內容不覆寫，快取未命中保持空白。4 個輸出路徑（beginner words、beginner tokens、CSV import、主流程）均已接入。
- [x] **例句翻譯快取 `sentence-cache.json`**（`src/nlp/wordCache.ts`、`src/csv/beginnerDeeplTranslator.ts`，2026-06-09）：新增 `sentence-cache.json`（`~/.novel2anki/`），以例句英文的 FNV-1a 32-bit hash（8 位 hex）為 key，存 `{ en, zh }`。`translateBeginnerWordsCsv` Phase 3 翻譯後自動存入；`WordCacheManager` 新增 `getSentenceZh` / `setSentenceZh` / `sentenceCacheSize` / `sentenceCacheFilePath`。
- [x] **`--fill-sent-zh` 雙向同步 CLI**（`src/index.ts`、`src/csv/beginnerDeeplTranslator.ts`，2026-06-09）：新增 `--fill-sent-zh` 旗標，對 beginner words CSV 執行 `syncSentenceCacheWithCsv`：非空 `context_sentence_zh` 存入 sentence-cache；空白列從快取補填；僅有填入時才重寫 CSV。不需 API key。
- [x] **CLI 執行資訊顯示 + 補填進度**（`src/index.ts`、`src/cards/translationFiller.ts`，2026-06-09）：每次執行任何指令時 header 顯示完整執行指令與快取路徑（`WORD_CACHE_PATH` 或預設 `~/.novel2anki`）。`fillVocabTranslationsFromCache` 新增 `onProgress` 回呼與 `FillResult` 返回值，4 個呼叫點均顯示即時百分比進度，完成後報告補填筆數。beginner words 路徑的字彙統計改為在補填完成後才輸出。
- [x] **`--fill-def-zh` 雙向同步定義翻譯 CLI**（`src/index.ts`、`src/csv/beginnerDeeplTranslator.ts`，2026-06-09）：新增 `--fill-def-zh` 旗標，對 beginner words CSV 執行 `syncDefinitionCacheWithCsv`：非空 `definition_zh` 存入 `word-cache-zh.json`（key: `lemma:pos`）；空白列從快取補填；僅有填入時才重寫 CSV。不需 API key。
- [x] **快取覆寫保護 `skippedCache`**（`src/csv/beginnerDeeplTranslator.ts`，2026-06-09）：`syncSentenceCacheWithCsv` 與 `syncDefinitionCacheWithCsv` 的 CSV→cache 方向加入先查快取邏輯：快取已有值時略過不覆寫，計入 `skippedCache` 回傳欄位。CLI 顯示格式新增「快取已有 N 筆」欄位。
- [x] **離線片語庫 `phrase-list.json`**（`scripts/extract-phrase-lists.py`、`src/data/phrase-list.json`、`src/nlp/phraseLookup.ts`，2026-06-10）：解析 OPAL spoken（~250 phrases）、OPAL written（~370 phrases）、Oxford Phrase List（750 phrases，A1–C1）三份 PDF，合併為 `src/data/phrase-list.json`（1409 個唯一片語）。資料結構：`{ opal_spoken?, opal_written?, opl_level? }`。TypeScript 查詢模組提供 `lookupPhrase(phrase)`（精確 + 尾綴替代詞剝除）與 `findPhrasesInText(text)`（最長優先滑動視窗，回傳位移與元資料）。
- [x] **片語 MW 預查 `--prefetch-phrases`**（`src/nlp/cefrPrefetcher.ts`、`src/nlp/wordCache.ts`、`src/index.ts`，2026-06-10）：對 `phrase-list.json` 1409 個片語批次查詢 MW Learner's API，結果存入 `phrase-cache.json`（同 `WORD_CACHE_PATH` 目錄）。命中（`source: 'MW'`）與查無結果（`source: 'no-def'`）均快取，重跑時自動跳過。`WordCacheManager` 新增 `getPhrase` / `setPhrase` / `hasPhrase` / `phraseCacheSize` / `phraseCacheFilePath`。
- [x] **語意介系詞白名單 `SEMANTIC_PREPOSITIONS`**（`src/nlp/beginnerFilter.ts`，2026-06-10）：新增 17 個介系詞白名單（against / amid / amidst / beneath / beyond / beside / besides / except / unlike / via / across / along / among / amongst / opposite / underneath / versus），允許有位置/關係語意的介系詞通過 `content-pos` 過濾規則。stopWords 已涵蓋的虛詞介系詞（about/around/through/within 等）不受影響。
- [x] **各 CSV 缺漏統計表 + `--missing-split` 分割缺漏 CSV**（`src/html/beginnerStatsExporter.ts`、`src/index.ts`，2026-06-11）：HTML 統計頁新增「各 CSV 缺漏統計表」區段，按來源 CSV 彙整每個檔案的詞彙數與三類缺漏計數（非零值橘色標示）。新增 `--missing-split <N>` CLI 旗標，缺漏 CSV 可按每 N 筆分割輸出（`{base}-part-01.csv`…），`BeginnerStatsExportResult` 三個 paths 欄位改為 `string[]`（未分割時長度 1）。
- [x] **CLI flag 更名 `--deepl` → `--translate`**（`src/index.ts`、`src/csv/beginnerTranslator.ts`（原 `beginnerDeeplTranslator.ts`）、`src/cards/translator.ts`，2026-06-10）：`--deepl` / `--deepl-force` 更名為 `--translate` / `--translate-force`，避免誤導使用者以為翻譯一定走 DeepL。`deeplTranslator.ts` 薄包裝層刪除，所有呼叫者直接引用 `translator.ts`；`DeepLConfig` / `loadDeepLConfig` 全面改用 `TranslatorConfig` / `loadTranslatorConfig`；`beginnerDeeplTranslator.ts` 更名為 `beginnerTranslator.ts`。

- [ ] **初學者模式 Cloze 字卡生成**（`src/csv/beginnerImporter.ts`、`src/index.ts`）：`importBeginnerWords` 目前只產生 `VocabCard[]`，`csvCards.cloze` 永遠為空。實作方式：以正規表示式在 `context_sentence` 中找 lemma（含前綴匹配涵蓋變化形），替換為 `{{c1::原形::definition_zh}}`，同時產出對應 `ClozeCard`；找不到時 fallback 為句尾附加 `[{{c1::lemma}}]`。可加 `--beginner-cloze` 旗標控制是否產生。

- [x] **Token 正規化設定檔（方言/古語變體還原）**（`src/nlp/tokenNormalizer.ts`、`src/data/archaic-en.json`、`src/nlp/globalFreqAnalyzer.ts`、`src/csv/beginnerExporter.ts`、`src/csv/beginnerTranslator.ts`、`src/index.ts`，2026-06-11）：初學者模式 NLP 管線支援方言/古語變體正規化（如 `yer` → `your`、`'tis` → `it is`）。`buildGlobalFreqMap` 在 `tokenize` 前套用正規化，CEFR lookup 使用正規化後 lemma；`occurrence.sentence` 保留原文。`--translate` Phase 2 亦對例句套用正規化改善翻譯品質。`archaic-en.json`（~70 條）放 `WORD_CACHE_PATH`（fallback `src/data/`）；`{slug}-normalize.json` 放 output 目錄，與 CSV 同層。`--beginner` 掃描後自動比對 UNKNOWN 詞彙寫入 normalize 檔，CLI 輸出高頻 UNKNOWN 建議清單供人工判斷。

- [ ] **NAME_SKIP 抽離為使用者設定檔**（`src/nlp/nameProtector.ts`）：現行 `NAME_SKIP` 硬編碼於程式碼，新增頭銜或通稱需修改原始碼。應支援 `*-name-skip.txt`（或 domain/book 層的共用設定，一行一詞）讓使用者擴充過濾清單；程式端保留核心代名詞作為不可覆蓋的底層集合，使用者設定只做合併（union）不做替換。

- [x] **翻譯來源欄位 `definition_zh_source` / `context_sentence_zh_source`**（`src/csv/beginnerTranslator.ts`、`src/csv/beginnerExporter.ts`，2026-06-11）：CSV 新增兩個 source 欄，記錄各列翻譯的來源（`deepl` / `azure` / `google` / `claude` / `cache` / `csv`）。`--fill-def-zh` / `--fill-sent-zh` 回填時依 source 欄判斷是否覆蓋（`cache` < `deepl`/`azure` < `csv` 優先序），避免低品質快取蓋掉人工校正；`--translate` 翻譯後自動寫入 source；舊 CSV（無 source 欄）沿用現有行為，不強制遷移。

## 翻譯品質改善（待規劃）

- [ ] **雙向同步「有資料就略過」統一政策**（`src/csv/beginnerTranslator.ts`）：目前 CSV→cache 方向以 `setIfEmpty` 保護快取現有值；cache→CSV 方向以 source 優先序保護既有翻譯。兩者邏輯分散且語意略有差異，期望統一為：不論調整對象是 CSV 還是 cache，只要目標端已有資料，均以相同計數器語意標記略過，CLI 輸出的「快取已有」與「略過」計數語意更清晰。後續可考慮與 source 優先序整合，讓 CSV→cache 方向亦能依來源品質決定是否覆蓋。

- [ ] **多後端翻譯比對 `--compare-trans`**：同批詞彙透過兩個翻譯提供者（如 DeepL + Azure）各跑一次，輸出對照表供人工審核，找出翻譯差異較大的詞彙集中修正。
- [ ] **Claude 翻譯品質評分**：以 Claude API 對快取中的中文翻譯進行語義評分（0–10），低分詞彙標記為待複查；評分結果存入 `word-cache-zh.json` 的 `quality` 欄位。
- [ ] **`--review-zh` 翻譯審核 CLI**：列出 `word-cache-zh.json` 中各來源（`deepl` / `azure` / `csv` / `claude`）的翻譯條目，標記低品質或來源多元的詞彙，提供互動式確認流程將優先版本升級到 `word-dict.json`。

## 單字翻譯快取改善（待規劃）

- [ ] **多來源並存 `word-cache-zh.json` 升級**：現行 key→string 結構改為 key→`{ deepl?: string, azure?: string, csv?: string, claude?: string, preferred?: string }`，可保存多個來源版本；讀取時依優先序（`preferred` > `csv` > `deepl` > 其他）取值，不同書的同詞翻譯不互相蓋掉。需遷移現有資料。
- [x] **翻譯來源標記顯示**（`src/csv/beginnerTranslator.ts`、`src/csv/beginnerExporter.ts`，2026-06-11）：已由「翻譯來源欄位」條目涵蓋（見上方已完成項目）。
- [ ] **自動優先序升級**：`--update-dict`（現有旗標）執行後，對應 `word-cache-zh.json` 條目的 `preferred` 欄位自動指向 `csv`，確保下次補填時使用已審核版本。
- [ ] **`word_zh` 對應詞欄位**：`CacheZhEntry` 新增 `word_zh?: string`（直接對應的中文單字，如「橋樑」），與現有 `zh`（定義直譯，如「一種橫跨河流的建築」）並存。資料來源：Azure Dictionary Lookup API（`/dictionary/lookup?from=en&to=zh-Hant`，回傳 POS-tagged 翻譯，免費額度 2M chars/month）。Anki 背面顯示 `word_zh` 為主答案，`zh` 為輔助解釋。向後相容：`zh` 保留，`word_zh` 為選填欄位，新增 `--prefetch-word-zh` CLI 旗標填入。

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
