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
  ├─ *-beginner-words.csv（12 欄，含 global_frequency）  ← --beginner
  ├─ *-beginner-words-part-NN.csv（12 欄，分割版）       ← --beginner-split N
  └─ *-beginner-names.txt（純文字人名表）                ← --beginner（供翻譯前確認）

  words CSV 欄位（12 欄）：
    lemma | pos | cefr_level | coverage_rank | global_frequency |
    definition_en | definition_en_source |
    context_sentence |
    context_sentence_zh | context_sentence_zh_source |
    definition_zh | definition_zh_source

  source 欄優先序：空(0) < cache(1) < deepl/azure/google/claude/chatgpt(2) < csv(3)
    definition_en_source：--mw 預查後寫入 mw / free / fallback / cache / dict；
      --fill-def-zh cache→CSV 回填時寫入快取條目原始來源；舊 CSV 自動插入欄
    definition_zh_source / context_sentence_zh_source：
      --translate 翻譯後寫入 provider 名稱；--fill-sent-zh / --fill-def-zh cache→CSV
      補填時，source 優先序 ≤ 1 才填入，並寫入快取條目中儲存的原始來源
    （來源為 null 時退回 'cache'）；舊 CSV（無 source 欄）自動插入

  [選用] beginnerTranslator.ts（--mw / --translate / --translate-force / --update-dict）

    estimateMWFetch(csvPaths)
      → { unfetchedCount }（統計尚未預查的列數）

    fetchBeginnerWordsMW(csvPath, onProgress?, { force? })
      → 寫入 definition_en 欄（MW → cache → 寫回 CSV）；自動插入缺少的 definition_en_source 欄
      → definition_en_source 寫入正規化後的來源字串：'mw' / 'free' / 'fallback' / 'cache' / 'dict'
         （source === 'MW' → 'mw'；source === 'cached' → 'cache'；其餘小寫直寫）
      → getWordCache().flush() 批次落盤（dirty flag 保護）
      進度標記：[字典] / [MW] / [Free] / [快取] / [fallback]

    estimateBeginnerTranslate(csvPaths, { force? })
      → 統計未翻譯列數（force 時計全部）、字元量、費用預估

    translateBeginnerWordsCsv(csvPath, config, onProgress, { force?, prebuiltNames? })
      prebuiltNames: 從 *-beginner-names.txt 讀入的 Map<string, string>（key=英文名, value=中文音譯或空字串；優先使用）
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

      Phase 2 — 批次翻譯（目標語言：zh-HANT 繁體中文）
        NER 人名保護（翻譯前）：
          優先使用 prebuiltNames（讀自 *-beginner-names.txt，使用者可確認修改）
            properNouns = new Set(prebuiltNames.keys())（保護集從 Map keys 取得）
          無 prebuiltNames 時動態建：
            buildProperNounSet(sentences)
              ↳ compromise .people() + #ProperNoun，以及 mid-sentence 大寫詞（從索引 1 起）
              ↳ NAME_SKIP 以小寫儲存（代名詞 he/she/his/her/they/their 等 + 宗教/軍事/封建頭銜 Father/Abbot/Captain/King 等），比對時統一 .toLowerCase()
              ↳ 跨句共享名詞集：「Pony」在任一句中段出現 → 同批所有句子（含句首）都保護
          protectNames(sentence, nouns) → 替換為 __PERSON_0__、__PERSON_1__… + 還原表
        交錯排列送入：[def1, protected_sent1, def2, protected_sent2, …]
        ↳ 定義與對應例句相鄰 → 翻譯 def_i 時以 sent_i 作語境，選出正確詞義
        每批次 50 筆（= 25 組詞對），batchTranslateChunked 循序累積
        NER 還原（翻譯後）：
          restoreNames(translated, restoreMap, prebuiltNames)
            ↳ 有中文音譯（prebuiltNames.get(original) 非空）→ 替換為中文（如「馬克瓦特」）
            ↳ 無中文音譯（空字串）→ 還原為英文原名
        結果拆分：偶數索引 → defZh[]；奇數索引 → sentZh[]（已還原人名）

      Phase 3 — 寫回 CSV
        definition_en         ← englishDefs[j]（Phase 1 本次從 API 取得才寫；CSV 原本有值不覆寫；不受 force 控制）
        definition_en_source  ← 正規化來源（MW→'mw'、cached→'cache'、其餘原值小寫；同上條件寫入）
        definition_zh         ← defZh[j]（空白才寫入；force 模式強制覆寫）
        definition_zh_source  ← config.provider（同上條件寫入）
        context_sentence_zh   ← sentZh[j]（空白才寫入；force 模式強制覆寫）
        context_sentence_zh_source ← config.provider（同上條件寫入）
        舊 CSV（無 source 欄）→ 自動插入 source 欄（context 後；definition 後）

    needTranslation 過濾條件：definition_en 空白 OR definition_zh 空白 OR context_sentence_zh 空白（三者皆有才跳過）
    --translate-force：needTranslation = 全部列（不過濾已翻譯，但 definition_en 仍只在空白時回寫）

    updateWordDictFromCsv(csvPath, onProgress?)
      → 讀 CSV 的 definition_en 欄 → getWordCache().setDict(lemma, pos, defEn) → flush()
      → 回傳 { updatedCount, skippedCount }（definition_en 空白或無 lemma 的列跳過）

  [CSV 輸入 → 字卡輸出路徑（已翻譯 CSV 直接匯出）]
    computeBeginnerWordStats(csvPaths)
      → BeginnerWordStats { total, translated, missingDefEn, missingContextZh, cefrDist, rankMin, rankMax, words: WordStat[] }
      （讀 lemma / pos / cefr_level / coverage_rank / global_frequency /
         definition_zh / definition_zh_source / definition_en / definition_en_source /
         context_sentence / context_sentence_zh / context_sentence_zh_source，依 coverage_rank 排序）
      WordStat 另記 sourceFile（來源 CSV 檔名，basename）

    exportBeginnerStatsToHtml(stats, deckName, outputDir, options?)
      options?: { splitSize?: number }（指定時缺漏 CSV 按 N 筆分割為多個檔案）
      → BeginnerStatsExportResult { htmlPath, missingDefZhPaths, missingCtxZhPaths, missingDefEnPaths }
        三個 paths 欄位均為 string[]；未分割時長度 1，分割時依缺漏數量決定
      同時寫出 1 + 3×N 個檔案：
        *-beginner-stats.html（自含式 HTML）
          ① sticky 導覽列：「未翻譯單字（中文）N筆」/「未翻譯例句（中文）N筆」/「未翻譯英文解釋 N筆」跳轉按鈕
          ② 摘要卡片 5 張：總數 / 已翻譯（%）/ 缺 definition_zh / 缺 definition_en / 缺例句中文
          ③ CEFR 分佈長條圖（A1–C2 + UNKNOWN，各級配色）
          ④ 各 CSV 缺漏統計表：來源檔案 / 詞彙數 / 缺 definition_zh / 缺例句中文 / 缺 definition_en（非零以橘色標示）
          ⑤ 未翻譯單字（缺 definition_zh）：排名 / 單字 / 詞性 / CEFR / 英文例句 / 來源檔案
          ⑥ 未翻譯例句（缺 context_sentence_zh）：排名 / 單字 / definition_zh / 英文例句 / CEFR / 來源檔案
          ⑦ 未翻譯英文解釋（缺 definition_en）：排名 / 單字 / 詞性 / CEFR / 英文例句 / 來源檔案
          ⑧ 完整詞彙列表：排名 / 單字 / 詞性 / CEFR / 出現次數 / 定義 / 已譯
             ↳ 各缺漏表：搜尋（單字 + 例句 + 定義）、CEFR 篩選、欄位點擊排序
          ↳ 回到頂端浮動按鈕（捲動 > 300px 顯示）
        *-missing-def-zh.csv（或 *-missing-def-zh-part-NN.csv）
        *-missing-ctx-zh.csv（或 *-missing-ctx-zh-part-NN.csv）
        *-missing-def-en.csv（或 *-missing-def-en-part-NN.csv）
      三個缺漏 CSV 格式（13 欄）：原始 12 欄 + source_file
      分割時命名：{base}-part-01.csv、{base}-part-02.csv…（零補位，依缺漏總數決定位數）
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
| CEFR 查詢 | `src/nlp/cefrLookup.ts` | `lookupCefrLevel()`、`generateVocabSuggestions()`；惰性載入 `cefr-wordlist.json`（透過 `resolveDataPath`） |
| 片語查詢 | `src/nlp/phraseLookup.ts` | `lookupPhrase()`（精確 + 尾綴代詞剝除）、`findPhrasesInText()`（最長優先滑動視窗，回傳 `PhraseMatch[]`）、`phraseCount()`；惰性載入 `phrase-list.json` |
| 資料路徑 | `src/nlp/dataPath.ts` | `resolveDataPath(name)`：先查 `WORD_CACHE_PATH/<name>`，找不到退回 `src/data/<name>`；統一解析 `cefr-wordlist.json` 與 `phrase-list.json` 的外部/內建路徑 |
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
| 初學者過濾 | `src/nlp/beginnerFilter.ts` | 7 條規則過濾，每個被排除的詞記錄 reason 供驗證。`CONTENT_POS`（Noun/Verb/Adj/Adv 等）控制允許的詞性；`SEMANTIC_PREPOSITIONS` 白名單（against/amid/beneath/beyond 等 17 個）允許有語意的介系詞通過 `content-pos` 規則 |
| 覆蓋率排序 | `src/nlp/coverageRanker.ts` | 按頻率排序，計算累積覆蓋率（含基準線） |
| 例句評分 | `src/nlp/sentenceScorer.ts` | Sentence Mining 評分：為每個詞選出「離開原書後仍能獨立理解且能推測詞義」的例句；對話句（引號 / em dash）`-5`、代詞開頭（He/She/They…）`-2`、說話動詞 `-1`、純敘述 `+2`、長度 40–120 `+5` |
| 覆蓋率報告 | `src/nlp/coverageReport.ts` | 產生並格式化覆蓋率統計報告（終端輸出） |
| 詞彙匯出 | `src/csv/beginnerExporter.ts` | `WordToken[]` → tokens CSV（12 欄）+ words CSV（**14 欄**，含 `definition_en` / `definition_en_source` 預查欄 + `word_zh` / `word_zh_source` 對應詞欄）+ 分割版 words CSV + `*-beginner-names.txt`（人名表）+ `*-normalize.json`（古語正規化對照表）。`exportBeginnerNormalizeFile(tokens, deckName, outputDir)`：收集 UNKNOWN 詞彙，對照 `archaic-en.json` 自動補入命中條目，寫出 `{slug}-normalize.json` 至 output 目錄。`loadBeginnerNormalizeMap(outputDir, deckName)`：讀取 `{slug}-normalize.json`，回傳 `Map<string, string>` 供 `--beginner` 掃描前套用 |
| Token 正規化 | `src/nlp/tokenNormalizer.ts` | 方言 / 古語變體正規化。`loadNormalizeFile(filePath)`：載入 JSON 對照表為 `Map<string, string>`。`loadArchaicMap()`：透過 `resolveDataPath('archaic-en.json')` 讀取內建古語表。`findNormalizeFile(dir, slug?)`：在目錄中尋找 `*-normalize.json`，slug 已知時優先精確比對。`slugFromCsvPath(csvPath)`：從 `*-beginner-words-*.csv` 檔名提取 slug。`applyNormalization(text, map)`：以非字母邊界 regex（`(?<![a-zA-Z])…(?![a-zA-Z])`）case-insensitive 替換，可處理 `'tis` 等含標點前綴的形式。`exportNormalizeFile(unknownWords, archaicMap, outputPath)`：保留既有條目（不覆蓋人工修改），補入新命中，回傳 `NormalizeFileResult { outputPath, matched, suggestions }` |
| 詞彙匯入 | `src/csv/beginnerImporter.ts` | 偵測 CSV 格式（words/tokens）、支援多檔合併 → VocabCard[]；`definition_zh` 為空的列仍合併（不過濾）；`computeBeginnerWordStats()` → `BeginnerWordStats`（含 per-word `WordStat[]`，每筆附所有翻譯欄位及來源欄位與 `sourceFile`；整體附 `missingDefEn`、`missingContextZh` 計數） |
| 字彙統計 HTML | `src/html/beginnerStatsExporter.ts` | `BeginnerWordStats` + `options?: { splitSize? }` → `BeginnerStatsExportResult { htmlPath, missingDefZhPaths, missingCtxZhPaths, missingDefEnPaths }`（三個 paths 均為 `string[]`）；HTML 含 sticky 導覽 + **各 CSV 缺漏統計表** + 3 張缺漏明細表 + 完整列表；三個缺漏 CSV 支援按 `splitSize` 分割為多個 part 檔案 |
| NER 人名保護 | `src/nlp/nameProtector.ts` | `buildProperNounSet()`（compromise + mid-sentence 大寫；`NAME_SKIP` 小寫儲存，涵蓋代名詞、宗教/軍事/封建頭銜）、`protectNames()` / `restoreNames(translated, restoreMap, translationMap?)`（`__PERSON_N__` 佔位符；有 translationMap 時優先替換為中文音譯，否則還原英文原名）、`saveNamesFile()`（保留現有 mapping，只補新名詞）/ `loadNamesFile()`（回傳 `Map<string, string>`，支援 `English: 中文` 或純英文格式） |
| 翻譯管線 | `src/csv/beginnerTranslator.ts` | MW 預查 + 多後端翻譯四階段管線。`fetchBeginnerWordsMW`：查三層快取（word-dict → word-cache → MW API），將英文定義寫入 `definition_en`。`translateBeginnerWordsCsv`：Phase 1 優先讀 `definition_en` 跳過 API 呼叫；Phase 2 NER 人名保護 + 交錯批次翻譯（`[def1,sent1,…]`，每批 25 詞對）+ 還原人名；**Phase 2.5** 對缺少 `word_zh` 的列另批翻譯 lemma，結果存入 `word_zh` 欄並以 `setWordZhIfEmpty` 寫入 `word-cache-zh.json`；Phase 3 寫回 CSV（`definition_zh` 空白才寫入；`context_sentence_zh` 空白或 force 才寫入）；例句翻譯同步存入 `sentence-cache.json`。`needTranslation` 過濾條件：`definition_en` OR `definition_zh` OR `context_sentence_zh` OR `word_zh` 任一為空才納入。`updateWordDictFromCsv`：把 CSV 的 `definition_en` 升級到 `word-dict.json`（個人精選庫）。`syncSentenceCacheWithCsv(csvPath)`：雙向同步 `context_sentence_zh` ↔ `sentence-cache.json`，僅在有列被填入時重寫 CSV。`syncDefinitionCacheWithCsv(csvPath, onProgress?, config?)`：雙向同步 `definition_zh` / `definition_en` / `word_zh` ↔ 快取；`FillDefZhConfig { domain?, book? }` 控制 zh/en 的分層快取層；`word_zh` 僅使用全局快取（無 domain/book 分層），CEFR 已知才寫入（`setWordZhIfEmpty`）；zh 全局寫入限定 CEFR 已知詞（`setChinese`），en 全局寫入同條件（`setCache`）；book / domain zh 採 `setIfEmpty(word, pos, zh, zhSource)`，en 採 `setEnIfEmpty(word, pos, def, source)`（均不覆寫既有條目）；`defZhSrc` 與 `defEnSrc` 從 CSV 讀出並原樣傳入（避免來源升格）；en cache → CSV 時以 `getEnSource()` 取得各層真實來源，寫入 `definition_en_source` 欄 |
| 翻譯後端 | `src/cards/translator.ts` | 多後端統一介面。`TranslatorConfig { provider, apiKey, region? }`；`loadTranslatorConfig()` 讀取 `TRANSLATE_PROVIDER` env（預設 `deepl`）；`batchTranslate(texts, config)` 路由到對應後端（deepl-node / Google REST / Azure REST / Claude Haiku） |
| 個人單字庫 | `src/nlp/wordCache.ts` | `WordCacheManager`：管理五個快取——word-dict.json（精選）/ word-cache.json（MW 自動）/ word-cache-zh.json（中文翻譯）/ sentence-cache.json（例句翻譯）/ phrase-cache.json（片語 MW 定義）；`get(word, pos)` / `getChinese(word, pos)` / `getChineseSource(word, pos)` 各自採 `word:pos` → `word` fallback；`getWordZh(word, pos)` / `getWordZhSource(word, pos)` / `setWordZhIfEmpty(word, pos, zh, source)` 管理 `word-cache-zh.json` 中的 `word_zh` 欄位（已有值時 `setWordZhIfEmpty` 不覆蓋，回傳 `false`）；`getSentenceZh(en)` / `getSentenceZhSource(en)` / `setSentenceZh(en, zh, source): boolean` 以 FNV-1a 32-bit hash 為 key，`setSentenceZh` 依優先序保護（新來源嚴格高於現有才覆蓋，現有 `''` 時無條件允許），回傳 `true` 表示實際寫入；`loadSentenceCache()` 舊條目缺 `source` 時自動補 `''`；`getPhrase(phrase)` / `setPhrase(phrase, def, source)` / `hasPhrase(phrase)` 管理片語快取（命中與 no-def 均存）；`getEnSource(word, pos)` 回傳 word-cache 中定義的來源（dict 命中時回傳 `'dict'`，cache 中 `'MW'` 正規化為 `'mw'`，`'cached'` 正規化為 `'cache'`）；dirty flag 延遲寫盤（`flush()`）；`cacheDir` getter 回傳快取目錄路徑（供 `DefinitionLayerCache` 建立同目錄的分層快取檔案）。`getWordCache()` 模組層級 singleton。`DefinitionLayerCache`：domain / book 專屬的雙語定義快取；`get(word, pos)` / `getSource(word, pos)` 查詢 zh 及其來源；zh 快取（`{type}_{name}_cache_zh.json`）結構同 `word-cache-zh.json`（`CacheZhEntry: {zh, source}`）；en 快取（`{type}_{name}_cache.json`）結構同 `word-cache.json`（`CacheEntry: {def, source}`）；讀取舊格式純字串時自動升級（`source: 'legacy'`）；`setIfEmpty(word, pos, zh, source)` / `setEnIfEmpty(word, pos, def, source)` 均採不覆寫語意；`getEn(word, pos)` 查詢英文定義；`getEnSource(word, pos)` 回傳 en 快取條目的 source（供 `syncDefinitionCacheWithCsv` 寫入 `definition_en_source`）；`enFilePath` 存放 en 快取路徑。JSON 格式：zh 條目需有 `"zh"` 欄位（`"def"` 無效）；key 格式為 `word:pos`，pos 須為完整小寫形式（如 `"elvish:adjective"`，非縮寫 `"adj"`）。儲存位置：`~/.novel2anki/`（可用 `WORD_CACHE_PATH` env 覆寫） |
| CEFR 預查器 | `src/nlp/cefrPrefetcher.ts` | `prefetchCefrToWordCache()`：對 CEFR 字庫 5782 詞批次預查 MW，所有 POS 變體分別存入 `word-cache.json`，已快取詞自動跳過可重跑。`prefetchCefrZhToWordCache(config)`：讀取 `word-cache.json` 英文定義，批次翻譯後存入 `word-cache-zh.json`，同樣可中斷重跑。`prefetchPhrasesToCache()`：對 `phrase-list.json` 1409 個片語批次預查 MW，結果存入 `phrase-cache.json`；命中與 no-def 均快取，避免重複查詢 |

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

// 中文翻譯快取（word-cache-zh.json）
interface CacheZhEntry {
  zh: string; source: string; example?: string;
  word_zh?: string;        // 單字直接中文對應（e.g. bridge → 橋樑）
  word_zh_source?: string; // 填入來源
}

// 例句快取
interface SentenceCacheEntry { en: string; zh: string; source: string; }
// source 同 source 欄優先序（'' / 'cache' / 'deepl' / 'azure' / 'google' / 'claude' / 'csv'）
// 舊條目無 source 欄時 loadSentenceCache() 自動補 ''（priority 0，任何來源均可覆蓋）
// key 為英文句子的 FNV-1a 32-bit hash（8 位 hex）
type SentenceCacheData = Record<string, SentenceCacheEntry>;

// 翻譯補填結果
interface FillResult { definitionFilled: number; exampleFilled: number; }

// 片語查詢（phraseLookup.ts）
interface PhraseEntry {
  opal_spoken?: true;   // 出現於 OPAL Spoken Phrases
  opal_written?: true;  // 出現於 OPAL Written Phrases
  opl_level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';  // Oxford Phrase List CEFR 等級
}
interface PhraseMatch {
  phrase: string;   // 比對到的片語鍵（正規化後）
  entry:  PhraseEntry;
  start:  number;   // 在原文中的字元起始偏移
  end:    number;   // 在原文中的字元結束偏移
}

// 字彙統計（beginnerImporter.ts，供 HTML 報告使用）
interface WordStat {
  lemma: string; pos: string; cefr: string;
  rank: number; frequency: number;
  translated: boolean;
  definition_zh: string;        definition_zh_source: string;
  definition_en: string;        definition_en_source: string;
  context_sentence: string;
  context_sentence_zh: string;  context_sentence_zh_source: string;
  sourceFile: string;   // 來源 CSV 檔名（basename）
}
interface BeginnerWordStats {
  total: number; translated: number;
  missingDefEn: number; missingContextZh: number;
  cefrDist: Record<string, number>;
  rankMin: number; rankMax: number;
  words: WordStat[];   // 依 coverage_rank 排序
}
interface BeginnerStatsExportResult {   // beginnerStatsExporter.ts
  htmlPath: string;
  missingDefZhPaths: string[];   // *-missing-def-zh.csv（或分割版 *-missing-def-zh-part-NN.csv）
  missingCtxZhPaths: string[];   // *-missing-ctx-zh.csv（或分割版）
  missingDefEnPaths: string[];   // *-missing-def-en.csv（或分割版）
}
```

## Anki 模型 ID 對照

| 常數 | ID | 用途 |
|------|----|------|
| `MODEL_BASIC_ID` | 1715000001 | 詞彙卡、人物卡（單向） |
| `MODEL_BASIC_REVERSED_ID` | 1715000002 | 情節卡（正反雙向） |
| `MODEL_CLOZE_ID` | 1715000003 | 克漏字卡 |

## 資料檔案

| 檔案 | 來源 | 說明 |
|------|------|------|
| `cefr-wordlist.json` | `scripts/build-cefr.js` 產生 | 5,732 個單字的 CEFR 等級對照（A1–C2），由 `resolveDataPath` 解析路徑 |
| `archaic-en.json` | 手動維護 | ~70 條中古英語 / 方言 → 現代英語對照（`ye→you`、`yer→your`、`'tis→it is` 等）。查找順序：`WORD_CACHE_PATH/archaic-en.json` → `src/data/archaic-en.json`（由 `resolveDataPath` 解析）。使用者可在 `WORD_CACHE_PATH` 放自訂版本擴充條目 |
| `{slug}-normalize.json` | `--beginner` 自動產生 | 書籍專屬的 Token 正規化對照表；`--beginner` 掃描後從 UNKNOWN 詞彙比對 `archaic-en.json` 自動生成，使用者可手動補充非古語詞彙。儲存於 output 目錄（與 CSV 同層），下次 `--beginner` 掃描前自動載入並套用 |
| `phrase-list.json` | `scripts/extract-phrase-lists.py` 產生 | 1,409 個學術/常見片語，整合 OPAL Spoken（~250）、OPAL Written（~370）、Oxford Phrase List（750，A1–C1）三份 PDF；結構：`{ opal_spoken?, opal_written?, opl_level? }` |
| `phrase-cache.json` | `--prefetch-phrases` 自動建立 | MW Learner's API 片語查詢快取；key = 正規化片語字串，value = `{ def, source }`；命中（`source: 'MW'`）與查無結果（`source: 'no-def'`，`def: ''`）均寫入，避免重複查詢。儲存於 `WORD_CACHE_PATH`（與 word-dict / word-cache 同目錄） |

`cefr-wordlist.json` 和 `phrase-list.json` 的查找順序：先 `$WORD_CACHE_PATH/<name>`（環境變數指定的外部目錄），找不到再退回 `src/data/<name>`（專案內建）。`src/data/` 已加入 `.gitignore`，不隨 git 提交。`phrase-cache.json` 固定寫入 `WORD_CACHE_PATH`（無退回機制）。

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
