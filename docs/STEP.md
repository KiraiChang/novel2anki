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
