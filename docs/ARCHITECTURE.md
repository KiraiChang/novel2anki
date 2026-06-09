# ARCHITECTURE

## 概覽

從英文 PDF / EPUB 小說自動產生 Anki 字卡的 CLI 工具。  
支援三種生成模式：Claude API（雲端）、Ollama（本地離線）、Mock（規則式測試）。  
另有兩種獨立模式：`--reading`（讀書理解）與 `--beginner`（初學者覆蓋率擷取）。

## 資料流

### 標準字卡模式

```
CLI 輸入
  │
  ├─ .csv → src/csv/importer.ts → GeneratedCards ──────────────────────────────┐
  │  └─ beginner-words.csv → src/csv/beginnerImporter.ts → VocabCard[] ─────────┤
  │  └─ beginner-tokens.csv → src/csv/beginnerImporter.ts → VocabCard[] ────────┤
  │                                                                              │
  ├─ .pdf → src/pdf/extractor.ts  → Chunk[]                                     │
  └─ .epub → src/epub/extractor.ts → Chunk[]                                    │
                   │
                   ├─ --beginner ──────────────────────────────────────────────────────────┐
                   │   src/nlp/beginnerExtractor.ts（全書掃描，不走逐 chunk NLP 管線）       │
                   │   buildGlobalFreqMap → applyBeginnerFilters → rankByCoverage           │
                   │   → selectBestSentence → WordToken[] + CoverageReport                 │
                   │                   │                                                   │
                   │   exportBeginnerTokensToCsv  exportBeginnerWordsToCsv                │
                   │   （*-beginner-tokens.csv）  （*-beginner-words.csv）                 │
                   │                                                                       │
                   ▼                                                                       │
         NLP 前處理管線（標準模式）                                                          │
         src/nlp/pipeline.ts                                                               │
         cleanText → tokenize → lemmatize                                                  │
         → 詞頻分析 → CEFR 查表                                                            │
                   │                                                                       │
                   ▼                                                                       │
           EnrichedChunk[]（含 vocabSuggestions）                                          │
                   │                                                                       │
                   ├─ --reading → src/cards/readingGenerator.ts ────────┐                  │
                   │             ReadingCards（術語/因果/章節/主題）     │                  │
                   │                                                    │                  │
                   ▼                                                    │                  │
           逐 Chunk 處理                                                │                  │
                   │                                                    │                  │
       ┌───────────┼───────────┐                                        │                  │
     --mock     --offline    API 模式（預設）                            │                  │
       │            │            │                                      │                  │
mockGenerator  offlineGenerator  generator.ts                           │                  │
       │            │            │                                      │                  │
       └────────────┴────────────┘                                      │                  │
                   │                                                    │                  │
                   ▼                                                    │                  │
           GeneratedCards 合併                                          │                  │
                   │                                                    │                  │
                   ▼                                                    ▼                  │
        ┌──────────────────────────────────────────┐ ←──────────────────┘                 │
        │  src/anki/exporter.ts  → .apkg           │ ←────────────────────────────────────┘
        │  src/html/exporter.ts  → .html           │
        │  src/csv/exporter.ts   → .csv (mock 限定)│
        └──────────────────────────────────────────┘
```

### 初學者模式（`--beginner`）資料流

```
Chunk[]
  │
  ▼
globalFreqAnalyzer.ts  ← 全書詞頻統計（復用 cleanText/tokenize/lemmatize）
  每個 token 記錄 id=chunk042_sent3_tok7、所在句子
  │
  ▼ GlobalFreqMap（含 occurrences 陣列）
  │
beginnerFilter.ts  ← 6 條規則過濾，每條記錄 reason 供稽核
  not-stopword / not-A1 / too-short / not-hapax / alpha-only / content-pos
  │
  ▼ kept: GlobalFreqEntry[]  +  rejected: {lemma, reason}[]
  │
coverageRanker.ts  ← 按 globalCount 降序排列，計算累積覆蓋率
  baselineTokens（已知詞：stopwords + A1）納入起始值
  coverageByCount[i] = 學前 i+1 個字的覆蓋率
  │
  ▼ rankedEntries[]  +  coverageByCount[]
  │
sentenceScorer.ts  ← 為每個詞從所有出現的句子中選最佳例句
  評分項：長度 / 目標詞位置 / 完整句 / 引號數量
  │
  ▼ WordToken[]（含 id、bestSentence、coverageRank）
  │
beginnerExporter.ts
  ├─ *-beginner-tokens.csv（12 欄，完整元資料 + ai_hint）
  ├─ *-beginner-words.csv（8 欄，含 global_frequency）  ← --beginner
  ├─ *-beginner-words-part-NN.csv（8 欄，分割版）       ← --beginner-split N
  └─ *-beginner-names.txt（純文字人名表）               ← --beginner（供翻譯前確認）

  words CSV 欄位（9 欄）：
    lemma | pos | cefr_level | coverage_rank | global_frequency |
    definition_en | context_sentence | context_sentence_zh | definition_zh

  [選用] beginnerDeeplTranslator.ts（--mw / --deepl / --deepl-force / --update-dict）

    estimateMWFetch(csvPaths)
      → { unfetchedCount }（統計尚未預查的列數）

    fetchBeginnerWordsMW(csvPath, onProgress?, { force? })
      → 寫入 definition_en 欄（MW → cache → 寫回 CSV）；舊格式 CSV 自動插入欄位
      → getWordCache().flush() 批次落盤（dirty flag 保護）
      進度標記：[字典] / [MW] / [Free] / [快取] / [fallback]

    estimateBeginnerTranslate(csvPaths, { force? })
      → 統計未翻譯列數（force 時計全部）、字元量、費用預估

    translateBeginnerWordsCsv(csvPath, config, onProgress, { force?, prebuiltNames? })
      prebuiltNames: 從 *-beginner-names.txt 讀入的 Set<string>（優先使用）
      若未傳入則從本批句子動態偵測（backward compat fallback）

      Phase 1 — 字典查詢（三層查找：word-dict → word-cache → MW API）
        for each lemma:
          ① getWordCache().get(lemma, pos) → 命中則直接使用，source='dict' 或 'cached'
          ② cache miss：normalizePOS(pos)  CSV 詞性 → API 詞性字串（小寫）
             若設定 MW_API_KEY：
               GET dictionaryapi.com/api/v3/references/learners/json/{lemma}?key=…
               （Merriam-Webster Learner's Dictionary；非 Collegiate）
               找符合 POS 的 entry → shortdef[0]（isUsableMW 過濾 see/compare 開頭）
               HTTP 非 200 時印 stderr 錯誤訊息（key 類型錯誤警告）
             MW 失敗或無 key：
               GET dictionaryapi.dev/api/v2/entries/en/{lemma}
               找符合 POS 的 meaning → definitions[0]（isUsableFree 過濾交叉參照）
             fallback → 同詞第一可用意義 → 或詞彙本身（兩個 API 皆無收錄時）
             → getWordCache().setCache(word, pos, def, source)
          若 CSV 中 definition_en 已填寫（--mw 預查或手動填入）→ 直接使用，跳過 API

      Phase 2 — DeepL 批次翻譯（目標語言：zh-HANT 繁體中文）
        NER 人名保護（翻譯前）：
          優先使用 prebuiltNames（讀自 *-beginner-names.txt，使用者可確認修改）
          無 prebuiltNames 時動態建：
            buildProperNounSet(sentences)
              ↳ compromise .people() + #ProperNoun，以及 mid-sentence 大寫詞（從索引 1 起）
              ↳ 跨句共享名詞集：「Pony」在任一句中段出現 → 同批所有句子（含句首）都保護
          protectNames(sentence, nouns) → 替換為 __PERSON_0__、__PERSON_1__… + 還原表
        交錯排列送入：[def1, protected_sent1, def2, protected_sent2, …]
        ↳ 定義與對應例句相鄰 → DeepL 翻譯 def_i 時以 sent_i 作語境，選出正確詞義
        每批次 50 筆（= 25 組詞對），batchTranslateChunked 循序累積
        NER 還原（翻譯後）：
          restoreNames(translated, restoreMap) → __PERSON_N__ 換回原始人名
        結果拆分：偶數索引 → defZh[]；奇數索引 → sentZh[]（已還原人名）

      Phase 3 — 寫回 CSV
        definition_zh     ← defZh[j]（每列皆覆寫）
        context_sentence_zh ← sentZh[j]（已有內容跳過；force 模式強制覆寫）

    --deepl-force：needTranslation = 全部列（不過濾已翻譯）

    updateWordDictFromCsv(csvPath, onProgress?)
      → 讀 CSV 的 definition_en 欄 → getWordCache().setDict(lemma, pos, defEn) → flush()
      → 回傳 { updatedCount, skippedCount }（definition_en 空白或無 lemma 的列跳過）

  [CSV 輸入 → 字卡輸出路徑（已翻譯 CSV 直接匯出）]
    computeBeginnerWordStats(csvPaths)
      → BeginnerWordStats { total, translated, cefrDist, rankMin, rankMax, words: WordStat[] }
      （讀 global_frequency / cefr_level / coverage_rank / definition_zh，依 coverage_rank 排序）

    exportBeginnerStatsToHtml(stats, deckName, outputDir)
      → *-beginner-stats.html（自含式 HTML，包含）
        ① 摘要卡片：總數 / 已翻譯數（%）/ 未翻譯數
        ② CEFR 分佈長條圖（A1–C2 + UNKNOWN，各級配色）
        ③ 詞彙表：排名 / 單字 / 詞性 / CEFR / 出現次數 / 定義 / 已譯
           ↳ 欄位點擊排序（數字 / 字串自動判斷）
           ↳ 搜尋框（單字 + 定義全文）、CEFR 篩選、翻譯狀態篩選
```

## 模組職責

### 標準模式

| 模組 | 路徑 | 職責 |
|------|------|------|
| CLI 入口 | `src/index.ts` | 參數解析、流程協調、進度輸出 |
| PDF 提取 | `src/pdf/extractor.ts` | pdf-parse → 段落分割 → Chunk[] |
| EPUB 提取 | `src/epub/extractor.ts` | epub2 → stripHtml → 分割 → Chunk[] |
| 型別定義 | `src/cards/types.ts` | Chunk、*Card、GeneratedCards 介面 |
| API 生成 | `src/cards/generator.ts` | Claude 工具呼叫、Prompt Caching |
| NLP 管線 | `src/nlp/pipeline.ts` | compromise tokenize+POS → wink-lemmatizer lemma → 詞頻 → CEFR 分級 → EnrichedChunk[] |
| NLP 型別 | `src/nlp/types.ts` | `EnrichedChunk`、`ChunkNLP`、`VocabSuggestion`、`CefrLevel`、`WordToken`、`GlobalFreqEntry` |
| CEFR 查詢 | `src/nlp/cefrLookup.ts` | `lookupCefrLevel()`、`generateVocabSuggestions()` |
| NLP 輔助 | `src/nlp/promptHelper.ts` | `buildNlpHint()` — 注入 LLM prompt 的建議詞彙區塊 |
| 離線生成 | `src/cards/offlineGenerator.ts` | Ollama fetch（循序），零新套件 → 詳見 [offline/ARCHITECTURE.md](offline/ARCHITECTURE.md) |
| Mock 生成 | `src/cards/mockGenerator.ts` | 規則式提取，不需 API → 詳見 [mock/ARCHITECTURE.md](mock/ARCHITECTURE.md) |
| 卡片模板 | `src/cards/templates.ts` | Anki HTML/CSS 模板常數 |
| Anki 匯出器 | `src/anki/exporter.ts` | SQLite 建構、ZIP 打包、.apkg 輸出 |
| HTML 匯出器 | `src/html/exporter.ts` | GeneratedCards → 自含式 HTML 預覽頁 |
| CSV 匯出器 | `src/csv/exporter.ts` | GeneratedCards → 12 欄 CSV（含 ai_hint 提示詞），mock 模式時自動產生 |
| CSV 匯入器 | `src/csv/importer.ts` | 12 欄 CSV → GeneratedCards，供直接匯出 .apkg / .html |

### 初學者模式（`--beginner`）

| 模組 | 路徑 | 職責 |
|------|------|------|
| 主協調器 | `src/nlp/beginnerExtractor.ts` | 串接全書掃描 → 過濾 → 排序 → 例句選擇，對外單一入口 |
| 全書詞頻 | `src/nlp/globalFreqAnalyzer.ts` | 跨 Chunk 詞頻統計，記錄每個 token 的 id 與所在句子；`extractSentences` 以 `.!?` 與 `\n` 雙重切割，避免詩節跨行被整段納入 |
| 初學者過濾 | `src/nlp/beginnerFilter.ts` | 6 條規則過濾，每個被排除的詞記錄 reason 供驗證 |
| 覆蓋率排序 | `src/nlp/coverageRanker.ts` | 按頻率排序，計算累積覆蓋率（含基準線） |
| 例句評分 | `src/nlp/sentenceScorer.ts` | Sentence Mining 評分：為每個詞選出「離開原書後仍能獨立理解且能推測詞義」的例句；對話句（引號 / em dash）`-5`、代詞開頭（He/She/They…）`-2`、說話動詞 `-1`、純敘述 `+2`、長度 40–120 `+5` |
| 覆蓋率報告 | `src/nlp/coverageReport.ts` | 產生並格式化覆蓋率統計報告（終端輸出） |
| 詞彙匯出 | `src/csv/beginnerExporter.ts` | `WordToken[]` → tokens CSV（12 欄）+ words CSV（9 欄，含 `definition_en` 預查欄）+ 分割版 words CSV + `*-beginner-names.txt`（人名表） |
| 詞彙匯入 | `src/csv/beginnerImporter.ts` | 偵測 CSV 格式（words/tokens）、支援多檔合併 → VocabCard[]；`definition_zh` 為空的列仍合併（不過濾）；`computeBeginnerWordStats()` → `BeginnerWordStats`（含 per-word `WordStat[]`） |
| 字彙統計 HTML | `src/html/beginnerStatsExporter.ts` | `BeginnerWordStats` → 自含式 HTML 報告（摘要卡 + CEFR 長條圖 + 可排序/搜尋/篩選詞彙表），匯出為 `*-beginner-stats.html` |
| NER 人名保護 | `src/nlp/nameProtector.ts` | `buildProperNounSet()`（compromise + mid-sentence 大寫）、`protectNames()` / `restoreNames()`（`__PERSON_N__` 佔位符）、`saveNamesFile()` / `loadNamesFile()`（純文字 I/O） |
| 翻譯管線 | `src/csv/beginnerDeeplTranslator.ts` | MW 預查 + 多後端翻譯三階段管線。`fetchBeginnerWordsMW`：查三層快取（word-dict → word-cache → MW API），將英文定義寫入 `definition_en`。`translateBeginnerWordsCsv`：Phase 1 優先讀 `definition_en` 跳過 API 呼叫；Phase 2 NER 人名保護 + 交錯批次翻譯（`[def1,sent1,…]`，每批 25 詞對）+ 還原人名；Phase 3 覆寫 CSV，例句翻譯同步存入 `sentence-cache.json`。`updateWordDictFromCsv`：把 CSV 的 `definition_en` 升級到 `word-dict.json`（個人精選庫）。`syncSentenceCacheWithCsv(csvPath)`：雙向同步——非空 `context_sentence_zh` 存入快取，空白列從快取補填；僅在有列被填入時重寫 CSV |
| 翻譯補填 | `src/cards/translationFiller.ts` | `fillVocabTranslationsFromCache(cards, onProgress?)`：對所有 `VocabCard` 補填缺失欄位——`definition_zh` 空時查 `word-cache-zh.json`，`exampleZh` 空時查 `sentence-cache.json`；已有內容不覆寫。回傳 `FillResult { definitionFilled, exampleFilled }`。`onProgress(current, total)` 回呼供 CLI 即時進度顯示。beginner words / beginner tokens / CSV import / 主流程等 4 個輸出路徑均在輸出前呼叫 |
| 翻譯後端 | `src/cards/translator.ts` | 多後端統一介面。`TranslatorConfig { provider, apiKey, region? }`；`loadTranslatorConfig()` 讀取 `TRANSLATE_PROVIDER` env（預設 `deepl`）；`batchTranslate(texts, config)` 路由到對應後端（deepl-node / Google REST / Azure REST / Claude Haiku）；`deeplTranslator.ts` 為薄包裝層，保持既有 import 路徑相容性 |
| 個人單字庫 | `src/nlp/wordCache.ts` | `WordCacheManager`：管理 word-dict.json（精選）/ word-cache.json（MW 自動）/ word-cache-zh.json（中文翻譯）/ sentence-cache.json（例句翻譯）四個快取；`get(word, pos)` / `getChinese(word, pos)` 各自採 `word:pos` → `word` fallback；`getSentenceZh(en)` / `setSentenceZh(en, zh)` 以 FNV-1a 32-bit hash 為 key；dirty flag 延遲寫盤（`flush()`）。`getWordCache()` 模組層級 singleton。儲存位置：`~/.novel2anki/`（可用 `WORD_CACHE_PATH` env 覆寫）。`sentenceCacheSize` / `sentenceCacheFilePath` getter 供 CLI 顯示 |
| CEFR 預查器 | `src/nlp/cefrPrefetcher.ts` | `prefetchCefrToWordCache()`：對 CEFR 字庫 5782 詞批次預查 MW，所有 POS 變體分別存入 `word-cache.json`，已快取詞自動跳過可重跑。`prefetchCefrZhToWordCache(config)`：讀取 `word-cache.json` 英文定義，批次翻譯後存入 `word-cache-zh.json`，同樣可中斷重跑 |

## 核心型別

```typescript
// 基礎卡片
interface Chunk          { index: number; text: string; chapter?: string }
interface VocabCard      { type: 'vocab'; word: string; definition_zh: string;
                           exampleFromText: string; exampleZh?: string }  // exampleZh：初學者模式例句中文翻譯
interface ClozeCard      { type: 'cloze';     text: string; hint_zh: string }
interface CharacterCard  { type: 'character'; name: string; description_zh: string; firstMention: string }
interface PlotCard       { type: 'plot';      question_zh: string; answer_zh: string }
interface GeneratedCards { vocab: VocabCard[]; cloze: ClozeCard[]; character: CharacterCard[]; plot: PlotCard[] }
type CardTypes = 'vocab' | 'cloze' | 'character' | 'plot'

// 初學者模式
interface WordOccurrence {
  id: string;          // "chunk042_sent3_tok7"，唯一追蹤碼
  chunkIndex: number; chapter?: string;
  sentence: string; sentenceIndex: number; tokenIndex: number;
}
interface GlobalFreqEntry {
  lemma: string; original: string; pos: string;
  cefrLevel: CefrLevel | 'UNKNOWN';
  globalCount: number;
  occurrences: WordOccurrence[];
  midSentenceCapitalCount: number;  // 在句中（tokenIndex > 0）出現大寫的次數，用於專有名詞偵測
}
interface WordToken {
  id: string;              // 最佳例句的 occurrence id
  lemma: string; original: string; pos: string;
  cefrLevel: CefrLevel | 'UNKNOWN';
  globalFrequency: number; coverageRank: number;
  bestSentence: string; bestSentenceScore: number;
  sourceChunkIndex: number; sourceChapter?: string;
  definition_zh: string;   // 空字串 → 翻譯後填入
}

// 例句快取
interface SentenceCacheEntry { en: string; zh: string; }
// key 為英文句子的 FNV-1a 32-bit hash（8 位 hex）
type SentenceCacheData = Record<string, SentenceCacheEntry>;

// 翻譯補填結果
interface FillResult { definitionFilled: number; exampleFilled: number; }

// 字彙統計（beginnerImporter.ts，供 HTML 報告使用）
interface WordStat {
  lemma: string; pos: string; cefr: string;
  rank: number; frequency: number;
  translated: boolean; definition_zh: string;
}
interface BeginnerWordStats {
  total: number; translated: number;
  cefrDist: Record<string, number>;
  rankMin: number; rankMax: number;
  words: WordStat[];   // 依 coverage_rank 排序
}
```

## Anki 模型 ID 對照

| 常數 | ID | 用途 |
|------|----|------|
| `MODEL_BASIC_ID` | 1715000001 | 詞彙卡、人物卡（單向） |
| `MODEL_BASIC_REVERSED_ID` | 1715000002 | 情節卡（正反雙向） |
| `MODEL_CLOZE_ID` | 1715000003 | 克漏字卡 |

## 相依套件

| 套件 | 用途 |
|------|------|
| `@anthropic-ai/sdk` | Claude API 官方 SDK（`--offline` 與 `--mock` 模式不需要） |
| `better-sqlite3` | 建構 Anki SQLite 資料庫 |
| `jszip` | 打包 `.apkg`（ZIP 容器） |
| `pdf-parse` | PDF 文字提取 |
| `epub2` | EPUB 章節解析 |
| `commander` | CLI 參數解析 |
| `chalk` | 終端彩色輸出 |
| `dotenv` | 載入 `.env` 環境變數 |
| `deepl-node` | DeepL 官方 SDK，`TRANSLATE_PROVIDER=deepl` 時使用（目標語言 `zh-HANT`） |
| `fetch()` | Node 18+ 內建，呼叫 Ollama / MW / Free Dictionary / Google Translate / Azure Translator REST API（不引入新套件） |
| `compromise` | 純 JS NLP，tokenize / POS tagging（全句上下文，提供 verbs/nouns/adjectives 詞性標記） |
| `wink-lemmatizer` | 英文詞形還原，補強 compromise 不處理的形容詞比較級/最高級（faster→fast、best→good、worst→bad） |
