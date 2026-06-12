# 單字處理流程

## 整體架構：兩條主線

```
書籍 (PDF/EPUB)
      │
      ▼
  [文字擷取]
      │
      ├─── 初學者模式 (--beginner)
      │         │
      │    [全書 NLP 分析]
      │         │
      │    [單字選出 + 過濾 + 排名]
      │         │
      │    [例句選配]
      │         │
      │    [英文定義查詢]
      │         │
      │    [中文翻譯]
      │         │
      │    → CSV → Anki
      │
      └─── Claude API 模式 (--types vocab)
                │
           [段落送 Claude]
                │
           [Claude 直接判斷：選詞 + 定義 + 例句]
                │
           → Anki
```

---

## 1. 怎麼選出這個單字（初學者模式）

```
所有 Chunk（段落）
      │
      ▼
buildGlobalFreqMap()         ← globalFreqAnalyzer.ts
  每個 chunk → tokenize → lemmatize
  每個 lemma 記錄：
    - 出現次數 (globalCount)
    - 所有出現位置 + 所屬句子 (occurrences)
    - 句中大寫次數 (midSentenceCapitalCount)
      │
      ▼
applyBeginnerFilters()       ← beginnerFilter.ts
  逐一過濾，下列情況丟棄：
  ┌─ too-short    : lemma 長度 < 3
  ├─ alpha-only   : 包含非字母字元（數字、連字號等）
  ├─ not-stopword : 在 stopWords 集合中（the/a/of/...）
  ├─ not-A1       : CEFR 等級為 A1（太基礎）
  ├─ not-hapax    : 全書出現次數 < 2
  ├─ content-pos  : 詞性不屬於 Content POS（見第 3 節）
  └─ proper-noun  : 句中大寫比例 > 70% 且出現 ≥ 3 次
      │
      ▼
rankByCoverage()             ← coverageRanker.ts
  按頻率由高到低排序（同頻率者 CEFR 較低者優先）
  計算累積覆蓋率，標記達到 95% 覆蓋率的截止點
      │
      ▼
  最終選出詞清單（WordToken[]）
  每詞含：lemma / pos / cefrLevel / globalFrequency / bestSentence
```

**Claude API 模式（對比）**：Claude 直接從一個段落中判斷「3-5 個進階單字或片語」，完全由 AI 決定，不經過上面的統計流程。

---

## 2. 怎麼確定這個單字的詞性

```
原始文字
    │
    ▼
tokenize()            ← tokenizer.ts（使用 compromise NLP 套件）
  doc.terms().json()
  每個 token 取：
    - original: 原始形式（e.g. "running"）
    - normal  : 小寫正規化（e.g. "running"）
    - pos     : compromise 打的 POS tag（e.g. "Gerund"）
    │
    ▼
lemmatize()           ← lemmatizer.ts（使用 wink-lemmatizer）
  根據 pos 決定用哪種 lemmatizer：
    動詞類 (Verb/Infinitive/PastTense/Gerund) → winkLemmatizer.verb()
    名詞類 (Noun/Plural)                      → winkLemmatizer.noun()
    形容詞類 (Adjective)                       → winkLemmatizer.adjective()
    其他                                       → 維持 normal 不變
  結果存入 token.lemma（e.g. "run"）
```

詞性標籤來源為 **compromise 套件**，解析英文語法後輸出。後續以 `token.pos` 直接使用，不做二次確認。

---

## 3. 有多少詞性

```
系統認識的 POS 標籤（compromise 輸出）：

  ┌── Content POS（保留進入候選）─────────────────┐
  │  Noun       一般名詞   (e.g. bridge)           │
  │  Plural     複數名詞   (e.g. bridges)          │
  │  Verb       動詞       (e.g. run)              │
  │  Infinitive 不定式     (e.g. to run)           │
  │  PastTense  過去式     (e.g. ran)              │
  │  Gerund     動名詞     (e.g. running)          │
  │  Adjective  形容詞     (e.g. bright)           │
  │  Adverb     副詞       (e.g. quickly)          │
  └─────────────────────────────────────────────┘

  ┌── 語意介系詞白名單（特別保留）────────────────┐
  │  against, amid, amidst, beneath, beyond,       │
  │  beside, besides, except, unlike, via,         │
  │  across, along, among, amongst, opposite,      │
  │  underneath, versus                            │
  └─────────────────────────────────────────────┘

  ┌── 被丟棄的 POS────────────────────────────────┐
  │  Preposition  一般介系詞 (in/on/at/by...)       │
  │  Conjunction  連接詞     (and/but/or...)        │
  │  Determiner   限定詞     (the/a/an...)          │
  │  Pronoun      代名詞     (he/she/it...)         │
  │  Modal        情態動詞   (can/will/should...)   │
  │  Unknown      無法識別                          │
  └─────────────────────────────────────────────┘
```

在 CEFR 快取（word-cache.json）中，每個詞按 POS 分別存一筆，格式為 `word:pos`（如 `run:verb`, `run:noun`），另有一筆無 POS 的基底鍵 `run` 供預設查詢。

---

## 4. 怎麼取英文定義（取捨細節）

### CEFR 預查路徑（`--prefetch-cefr`）

實作位置：`src/nlp/cefrPrefetcher.ts`

```
CEFR 字庫（5782 詞）
      │
      ▼
對每個詞查 MW Learner's Dictionary API
      │
   MW 回傳格式：[ { fl: "noun", shortdef: [...] }, ... ]
      │
      ▼ 取捨規則（依序套用）：

  1. meta.id 比對：剝除 ":N" 後必須 == 目標詞
     → 排除複合詞（cross-dressing 混入 cross 的結果）

  2. 每個 POS 只取第一筆 entry
     → 排除後出現的同 POS 複合詞蓋掉主詞義

  3. shortdef 必須通過 isUsable() 篩選：
     ├─ 長度 >= 10 字元
     ├─ 不以 "see / compare / synonym of" 開頭（交叉參照）
     └─ 不以 ": (such as)" 結尾（未完整定義）

  4. em-dash 以後的語法標記全部剝除
     e.g. "to move rapidly —often used figuratively"
          → "to move rapidly"

  5. 儲存格式：`(pos) definition text`
     e.g. "(verb) to move on foot rapidly"

  6. 同時存一筆無 POS 基底鍵（供快速查詢）
      │
      ▼
  存入 word-cache.json
  鍵格式：
    "run"       → { def: "(verb) to move...", source: "MW" }
    "run:verb"  → { def: "(verb) to move...", source: "MW" }
    "run:noun"  → { def: "(noun) a race...",  source: "MW" }
```

### 初學者 CSV 翻譯路徑（`--translate`）

實作位置：`src/csv/beginnerTranslator.ts`

```
查詢優先序（短路求值，命中即停止）：
┌────────────────────────────────────────────────────────┐
│ 1. word-dict.json（個人精選庫，最高優先，永不被覆蓋）   │
│ 2. word-cache.json（MW 自動快取，精確 word:pos → word） │
│ 3. MW API（Learner's Dictionary，附 POS 優先查詢）      │
│    └→ 結果寫回 word-cache.json                         │
│ 4. Free Dictionary API（免費備援，MW 失敗時）           │
│    ├─ 優先找符合 POS 的 meaning                        │
│    └─ fallback 到第一筆可用定義                        │
│ 5. 都查不到 → definition_en 留空，不生成字卡            │
└────────────────────────────────────────────────────────┘
```

---

## 5. 怎麼把單字跟例句做搭配

初學者模式在全書分析階段，每個 lemma 的 occurrences 就已帶著句子。

```
buildGlobalFreqMap() 時：
  每個 token 出現時記錄 WordOccurrence：
  {
    id:            "chunk042_sent3_tok7",    ← 唯一位置 ID
    chunkIndex:    42,
    chapter:       "Chapter 5",
    sentence:      "The bridge collapsed...", ← 該 token 所在的完整句子
    sentenceIndex: 3,
    tokenIndex:    7,
  }

→ 一個 lemma 在全書出現幾次，就有幾筆 occurrence
  每筆各帶一個句子
      │
      ▼
selectBestSentence() 從所有句子中評分選出最佳（見第 6 節）
```

**Claude API 模式（對比）**：Claude 自己從段落中挑選例句，直接放入 `exampleFromText` 欄位，不需要單獨評分。

---

## 6. 例句怎麼選出來的

實作位置：`src/nlp/sentenceScorer.ts`

```
對每個候選句子 scoreSentence(sentence, lemma, original)：

加分項目：
  ┌─ 長度 40-120 字元                              +5  ← 最佳學習語境長度
  ├─ 長度 20-200 字元                              +3
  ├─ 其他長度                                      +1
  ├─ 目標詞在句中位置（非句首/句尾）                +2
  ├─ 完整句（大寫開頭 + 標點結尾）                 +2
  └─ 純敘述句（無任何引號）                        +2  ← 最適合獨立學習

扣分項目：
  ├─ 主要是對話（> 55% 字元在引號內，或開頭是引號/em dash）  -5
  ├─ 含說話歸因動詞（said/asked/replied/...）                -1
  └─ 代詞開頭（He/She/They/His/Her/Their）                   -2
     └→ 離開原書脈絡後無法知道指涉誰，不適合獨立學習

全書所有 occurrence 全部評分後，取最高分的句子 → bestSentence
```

**選句核心理念**（Sentence Mining 原則）：句子必須**離開書本脈絡後仍能獨立理解**，且能幫助推測目標單字的語意。純敘述句 > 含引號的混合句 > 純對話；代詞開頭因指涉不明確而扣分。

---

## 完整流程總覽

```
書籍文字
   │
   ▼
[全書 NLP]      compromise tokenize → wink lemmatize → CEFR 查詢
   │
   ▼
[全書頻率]      每個 lemma：globalCount + 所有 occurrence 句子
   │
   ▼
[過濾]          丟棄：太短 / 非字母 / stop word / A1 / 太罕見 /
                      非 content POS / 專有名詞
   │
   ▼
[排名]          按頻率降序，計算累積覆蓋率，建議 95% 截止點
   │
   ▼
[選句]          對每個詞的所有 occurrence 評分，取最高分句子
   │
   ▼
[取英文定義]    word-dict → word-cache → MW API → Free Dict
   │
   ▼
[中文翻譯]      整批送 DeepL/Azure/Google/Claude
                結果存 word-cache-zh.json
   │
   ▼
CSV 輸出
  word / pos / cefr / definition_en / definition_zh /
  context_sentence / context_sentence_zh / word_zh
```
