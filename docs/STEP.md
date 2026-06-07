# STEP

> 大型需求的分段實作記錄。每個需求一個區塊，**依時間倒序**新增（最新在最上方）。

<!-- 新需求從此處往下插入，格式如下：

### [STEP-XXX] 需求標題
**狀態**：進行中 / 已完成 / 擱置
**目標**：一句話描述要做什麼、為什麼做。

1. 子任務一
2. 子任務二
3. 子任務三

**備注**：實作決策或注意事項。

-->

---

### [STEP-007] 初學者模式擴充：分割輸出、例句中文、DeepL 自動翻譯
**狀態**：已完成
**目標**：強化初學者模式的翻譯工作流程。支援分割 words CSV、新增例句中文翻譯欄、整合 DeepL API 一鍵自動翻譯（含費用估算確認）。

1. [x] `src/csv/beginnerExporter.ts`：新增 `exportBeginnerWordsSplit()`，按 `--beginner-split N` 分割輸出多個 `*-part-NN.csv`；words CSV 從 6 欄擴充為 7 欄（加入 `context_sentence_zh`）
2. [x] `src/csv/beginnerImporter.ts`：新增 `importBeginnerWordsFromFiles()`，支援多個分割 CSV 合併讀入並按 `coverage_rank` 排序去重
3. [x] `src/cards/types.ts`：`VocabCard` 加入 `exampleZh?: string`（例句中文翻譯）
4. [x] `src/html/exporter.ts`：vocab 卡片顯示 `exampleZh`（靜態 HTML + 互動翻牌背面 + flash 背面）；新增 `.example-zh` CSS 樣式
5. [x] 新建 `src/csv/beginnerDeeplTranslator.ts`：`estimateBeginnerTranslate()`（字元估算 + 費用預估）、`formatBeginnerTranslateEstimate()`（格式化報表）、`translateBeginnerWordsCsv()`（三階段：字典 API → DeepL batchTranslate → 覆寫 CSV，每批 50 筆）
6. [x] `src/index.ts`：新增 `--beginner-split` 選項；CSV 輸入分支改用 `filter()` 取代 `every()`，使目錄中混有 tokens.csv 時仍能正確偵測 words CSV；新增 DeepL 翻譯分支（兩個路徑：`--beginner --deepl` 擷取後直翻；words CSV + `--deepl` 補譯後輸出卡片）

**備注**：
- DeepL 批次翻譯每次最多 50 筆（`DEEPL_BATCH_SIZE = 50`），超過時自動分批
- 費用計算：句子字元（實際值）+ 定義字元（每詞平均估 100）= 預估總量；超出 500,000 字元免費額度才顯示金額
- words CSV 分割時，檔名補零位數自動依總檔數決定（3 個檔 → `01–03`，10 個以上 → `01–10`）
- `context_sentence_zh` 填入後出現在 flash 卡片背面（定義下方換行顯示），協助初學者對照理解

---

### [STEP-006] 初學者覆蓋率單字擷取模式（`--beginner`）
**狀態**：已完成
**目標**：為中文母語英文初學者設計「讀完字卡就能閱讀這本小說」的單字擷取方法。以全書詞頻覆蓋率為核心，輸出可獨立翻譯的精簡 CSV，填完翻譯後直接生成 Anki 字卡，不依賴 AI API。

1. [x] 新增 `src/nlp/types.ts` 型別：`WordOccurrence`、`GlobalFreqEntry`、`GlobalFreqMap`、`WordToken`
2. [x] 建立 `src/nlp/globalFreqAnalyzer.ts`（全書詞頻統計，記錄每個 token 的位置 id 與所在句子）
3. [x] 建立 `src/nlp/beginnerFilter.ts`（6 條過濾規則，每個被排除詞記錄原因）
4. [x] 建立 `src/nlp/coverageRanker.ts`（累積覆蓋率排序，含已知詞基準線計算）
5. [x] 建立 `src/nlp/sentenceScorer.ts`（最佳例句評分：長度 / 詞位置 / 完整句 / 引號數）
6. [x] 建立 `src/nlp/coverageReport.ts`（覆蓋率報告產生與終端格式化）
7. [x] 建立 `src/nlp/beginnerExtractor.ts`（主協調器，串接步驟 1–5）
8. [x] 建立 `src/csv/beginnerExporter.ts`（`exportBeginnerTokensToCsv` + `exportBeginnerWordsToCsv`）
9. [x] 建立 `src/csv/beginnerImporter.ts`（自動偵測 tokens/words 格式，合併翻譯 → VocabCard[]）
10. [x] 修改 `src/index.ts`（新增 `--beginner` 旗標群組 + 模式分支 + CSV 輸入偵測）

**備注**：
- 不走逐 chunk NLP 管線，而是獨立的全書掃描管線（`buildGlobalFreqMap`），避免干擾現有流程
- 覆蓋率基準線：停用詞 + A1 詞彙的 token 數先計入分子，讓里程碑更真實反映初學者起點
- 雙 CSV 設計：`tokens.csv`（12 欄完整元資料）供存檔與追蹤；`words.csv`（6 欄精簡）供 DeepL 或人工翻譯，兩者可獨立使用
- `token_id = "chunk042_sent3_tok7"` 格式讓每個詞都能追蹤回原文精確位置，滿足可驗證性需求
- 填完 `words.csv` 後直接作為 CLI 輸入即可生成 APKG + HTML，不需額外合併步驟

---

### [STEP-005] 讀書導向字卡模式（`--reading`）
**狀態**：已完成
**目標**：新增 `--reading` 旗標，產出以「讀懂本書」為目標的字卡（術語、因果、章節理解、主題意象），支援 `--mock`、Claude API、`--offline` 三種處理方式，現有流程不受影響。

1. [x] 建立 `src/cards/readingTypes.ts`（`ReadingCards` 型別 + 四種子卡片介面）
2. [x] 建立 `src/cards/readingMockGenerator.ts`（兩階段分析：全局統計 → 卡片生成）
3. [x] 修改 `src/index.ts`（新增 `--reading` 旗標 + 路由至 reading 生成器）
4. [x] 建立 `src/csv/readingExporter.ts`（`ReadingCards` CSV 匯出 + ai_hint）
5. [x] 建立 `src/html/readingExporter.ts`（reading 卡片 HTML，四區塊互動）
6. [x] 建立 `src/cards/readingGenerator.ts`（Claude API reading prompts）
7. [x] 建立 `src/cards/readingOfflineGenerator.ts`（Ollama reading prompts）

**備注**：
- Reading 卡片複用 `VocabCard`/`PlotCard`/`CharacterCard` 型別，不動 APKG/CSV 匯出管線骨架
- Mock 層需兩階段：第一階段跨 chunk 全局統計（詞頻、因果句、首尾句），第二階段排序生成
- `--reading` 與 `--mock/--offline` 正交，與現有 `--types` 互相獨立
- HTML 區塊標題改為「術語」「因果事件」「章節脈絡」「主題意象」

---

### [STEP-004] DeepL 翻譯模式 + 比對功能 + 成本預估
**狀態**：已完成
**目標**：新增 `--deepl` 旗標，以 DeepL API 取代 LLM 翻譯定義；搭配 Claude/Ollama 時自動產生上下堆疊比對 HTML；執行前顯示字元/token 成本預估並請使用者確認。

1. 更新 `docs/STEP.md`，匯出 `mockGenerator.ts` 內部輔助函式
2. 安裝 `deepl-node`；建立 `src/cards/deeplTranslator.ts`（`translateToZh`、`batchTranslate`、`loadDeepLConfig`）
3. 建立 `src/nlp/costEstimator.ts`（DeepL 字元估算 + Claude token 估算 + 格式化輸出）
4. 建立 `src/cards/deeplGenerator.ts`（Free Dictionary API 取英文定義 → DeepL 翻成繁中）
5. 修改 `src/html/exporter.ts`（新增 `exportToComparisonHtml`，上下堆疊比對視圖）
6. 修改 `src/index.ts`（`--deepl` 旗標、成本預估確認流程、比對模式路由）
7. 更新 `.env.example`，補寫 BDD 測試，確認全部通過

**備注**：DeepL 目標語言使用 `ZH` (Traditional Chinese)；Free Dictionary API 無需金鑰；比對模式僅在 `--deepl` + Claude/Ollama 時觸發，mock 不做比對。

---

### [STEP-003] NLP 前處理管線（CEFR 詞彙分析）
**狀態**：已完成
**目標**：在所有生成模式之前插入 NLP 管線（compromise tokenize → lemma → 詞頻 → CEFR 分級），提供結構化詞彙建議；Mock 直接用建議列表選字，Offline/Claude 將建議注入 prompt。

1. 建立靜態資料：`src/data/cefr-wordlist.json`、`src/nlp/types.ts`、`src/nlp/stopWords.ts`
2. 實作 NLP 核心函式：`textCleaner`、`tokenizer`、`lemmatizer`、`freqAnalyzer`（安裝 compromise）
3. 實作 `cefrLookup.ts` 與 `pipeline.ts`、`promptHelper.ts`
4. 整合三個生成器（mockGenerator / offlineGenerator / generator）
5. 修改 `index.ts` 串接管線，更新 docs/

**備注**：使用 `EnrichedChunk extends Chunk`（必填 `nlp` 欄位），管線失敗時填 `EMPTY_CHUNK_NLP` 降級。

---

### [STEP-002] 離線模式（Ollama 整合）
**狀態**：已完成
**目標**：新增 `--offline` 旗標，透過本機 Ollama LLM 產生字卡，不需網路或 API Key；模型名稱可透過 `--model` 或 `OLLAMA_MODEL` 環境變數自訂。

1. 建立 `src/cards/offlineGenerator.ts`（OllamaConfig、callOllama、4 種生成函式、匯出 generateCards）
2. 修改 `src/index.ts`（新增 `--offline`、`--model` 選項，三叉路由邏輯）
3. 新增 `.env.example` 的 Ollama 設定項目
4. 補寫 BDD 測試案例（單元 + 端對端）
5. 新建 `docs/offline/` 子目錄文件
6. 更新 `docs/ARCHITECTURE.md`、`docs/NOTES.md`、`docs/TODOS.md`、`CLAUDE.md`

**備注**：使用 Node 18+ 內建 `fetch()`，零新套件。Ollama 呼叫改用循序而非並行（本地模型無法真正並行推理）。

---

### [STEP-001] 專案初始化
**狀態**：已完成

1. 建立 TypeScript 專案結構（`src/`、`tsconfig.json`、`package.json`）
2. 實作 PDF 文字擷取（`src/pdf/extractor.ts`）
3. 實作 EPUB 章節擷取（`src/epub/extractor.ts`）
4. 定義卡片型別（`src/cards/types.ts`）
5. 實作 Claude API 生成器（`src/cards/generator.ts`，工具呼叫 + Prompt Caching）
6. 實作 Mock 生成器（`src/cards/mockGenerator.ts`）
7. 實作 Anki 匯出器（`src/anki/exporter.ts`，SQLite + ZIP）
8. 實作 CLI 入口（`src/index.ts`，Commander.js）
9. 撰寫 `CLAUDE.md` 文件
