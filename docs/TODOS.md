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
