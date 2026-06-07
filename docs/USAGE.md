# USAGE

## 快速開始

```bash
# 1. 設定 API Key
cp .env.example .env
# 編輯 .env，填入 ANTHROPIC_API_KEY=sk-ant-...

# 2. 不用 API 先測試整條流程（mock 模式，同時產生 CSV）
npx ts-node src/index.ts novel.epub --mock --chunks 3

# 3. 正式執行（呼叫 Claude API）
npx ts-node src/index.ts novel.epub --chunks 3
```

## 完整選項

```
npx ts-node src/index.ts <輸入> [選項]

引數：
  <輸入>                  PDF、EPUB、CSV 檔案路徑；CSV 目錄路徑；或逗號分隔的多個 CSV 路徑

選項：
  -d, --deck <名稱>       牌組名稱（預設：檔名或目錄名）
  -t, --types <類型>      字卡類型，逗號分隔（預設：全部）
                          可選值：vocab, cloze, character, plot
  -c, --chunks <數量>     最多處理幾個段落區塊（預設：全部）
  -o, --output <目錄>     輸出目錄（預設：./output）
  --mock                  模擬模式：不呼叫 API，用文字分析產生字卡，並額外輸出 CSV
  --offline               離線模式：使用本機 Ollama 產生字卡（需先啟動 Ollama）
  --model <模型名稱>      指定 Ollama 模型（預設：llama3.2，也可設定 OLLAMA_MODEL）
  --deepl                 使用 DeepL API 翻譯定義（需設定 DEEPL_API_KEY）
  --split-chapters        將 CSV 依章節分割輸出（搭配 --mock）
  --split-size <數量>     將 CSV 依每 N 個 chunk 分割輸出（搭配 --mock）
  --reading               讀書理解模式：產出術語、因果、章節脈絡、主題意象字卡
  --flash                 額外輸出單字卡 HTML（頁籤切換 + 上一張 / 下一張 + 翻面）
  --beginner              初學者模式：掃描全書，擷取達目標覆蓋率所需詞彙，輸出翻譯用 CSV
  --beginner-target <N>   覆蓋率目標 0–100（預設：95）
  --beginner-min-freq <N> 詞彙最低出現次數（預設：2）
  --beginner-include-a1   包含 A1 基礎詞彙（預設：排除）
```

## 使用範例

```bash
# EPUB 小說，只產生詞彙卡和克漏字
npx ts-node src/index.ts novel.epub --types vocab,cloze

# PDF，指定牌組名稱，處理前 5 個區塊
npx ts-node src/index.ts novel.pdf --deck "Pride and Prejudice" --chunks 5

# Mock 模式：產生單一 .apkg、.html、.csv
npx ts-node src/index.ts novel.epub --mock

# Mock 模式：依章節切割為多個 CSV
npx ts-node src/index.ts novel.epub --mock --split-chapters

# Mock 模式：每 5 個 chunk 切割為一個 CSV
npx ts-node src/index.ts novel.epub --mock --split-size 5

# 從單一 CSV 打包
npx ts-node src/index.ts output/novel.csv -d "My Deck"

# 從目錄合併所有 CSV 打包
npx ts-node src/index.ts output/ -d "My Deck"

# 從逗號分隔的多個 CSV 打包
npx ts-node src/index.ts "output/novel-part-01.csv,output/novel-part-02.csv" -d "My Deck"

# 離線模式（需先執行 ollama serve 並 ollama pull llama3.2）
npx ts-node src/index.ts novel.epub --offline --chunks 3

# 離線模式，自訂模型
npx ts-node src/index.ts novel.epub --offline --model gemma3 --chunks 3

# DeepL 翻譯模式（需設定 DEEPL_API_KEY）
npx ts-node src/index.ts novel.epub --deepl --chunks 5

# DeepL + Claude API 比對模式（同時產生比對 HTML）
npx ts-node src/index.ts novel.epub --deepl --chunks 5

# 讀書理解模式（mock）：產出 CSV + 互動預覽 HTML
npx ts-node src/index.ts novel.epub --reading --mock --chunks 10

# 讀書理解模式（Claude API）
npx ts-node src/index.ts novel.epub --reading

# 讀書理解模式（Ollama 離線）
npx ts-node src/index.ts novel.epub --reading --offline

# 額外輸出單字卡 HTML（可與任何模式並用，包含 --reading）
npx ts-node src/index.ts novel.epub --mock --flash
npx ts-node src/index.ts novel.epub --reading --mock --flash
npx ts-node src/index.ts output/novel.csv --flash
```

## Mock → CSV → APKG 工作流程

Mock 模式適合先快速擷取單字與例句，再以 AI 工具補全定義。
書籍較長時可切割 CSV，避免單次 AI 額度不足造成不連貫。

### 單一 CSV 流程

```bash
# 1. 產生單一 CSV
npx ts-node src/index.ts novel.epub --mock

# 2. 用 AI 填入空白欄（見下方 ai_hint 說明）

# 3. 從 CSV 重新打包
npx ts-node src/index.ts output/novel.csv -d "Novel"
```

### 分割 CSV 流程（推薦大型書籍）

```bash
# 1. 依章節切割（檔名含零補位流水號，確保合併順序正確）
npx ts-node src/index.ts novel.epub --mock --split-chapters
# 輸出：output/novel-ch-01-chapter-1.csv、output/novel-ch-02-chapter-2.csv ...

# 或依 chunk 數切割（每 5 個 chunk 一檔）
npx ts-node src/index.ts novel.epub --mock --split-size 5
# 輸出：output/novel-part-01.csv、output/novel-part-02.csv ...

# 2. 逐一對每個 CSV 用 AI 填入空白欄

# 3. 整目錄一次合併打包（自動依流水號排序合併）
npx ts-node src/index.ts output/ -d "Novel"
```

### CSV 欄位說明

| 欄位 | mock 自動填入 | 需 AI 或手動補全 |
|------|:---:|:---:|
| `source_title` | ✓ | — |
| `word` | ✓ | — |
| `exampleFromText` | ✓ | — |
| `definition_zh` | — | ✓ |
| `text`（cloze） | ✓ | — |
| `hint_zh` | — | ✓ |
| `name` | ✓ | — |
| `firstMention` | ✓ | — |
| `description_zh` | — | ✓ |
| `question_zh` | ✓ | — |
| `answer_zh` | ✓（原文段落） | ✓（替換為摘要） |
| `ai_hint` | ✓（含角色設定、書名、格式規範） | — |

`ai_hint` 為完整的 AI 提示詞，可直接複製貼入 ChatGPT / Claude，各類型規範如下：

| 類型 | ai_hint 規範 |
|------|-------------|
| vocab | 繁體中文定義，限 25 字，選最符合例句語意的詞性 |
| cloze | 繁體中文提示說明，限 15 字，說明填空語意角色 |
| character | 2–3 句繁體中文描述；無法判斷時回傳「（原文中為地名／概念）」 |
| plot | 繁體中文摘要，空一行後附上英文原文（中英對照格式） |

## 字卡類型

| 類型 | 說明 | Anki 模型 |
|------|------|-----------|
| `vocab` | 英文單字 → 繁中定義 + 原文例句 | Basic |
| `cloze` | 關鍵片語挖空填充 | Cloze |
| `character` | 人物／地點／概念介紹 | Basic |
| `plot` | 情節理解問答（正反兩面） | Basic + Reversed |

## 讀書理解模式（`--reading`）

以「讀懂整本書」為目標產生四種字卡，獨立於一般字卡流程。

| 字卡類型 | 說明 |
|----------|------|
| `reading-term` | 書中高頻術語或世界觀專有名詞（出現 ≥2 次） |
| `reading-cause` | 含因果標記的關鍵轉折句（because / since / therefore 等） |
| `reading-chapter` | 每章首尾句，輔助理解章節核心事件 |
| `reading-theme` | 全書反覆出現的意象詞（出現 ≥3 次） |

產出兩個檔案：
- `{deck}-reading.csv`：含 `ai_hint` 提示詞，可用 AI 補全中文說明
- `{deck}-reading.html`：互動預覽，四個色塊區域，點擊翻面

```bash
# Mock 模式（不呼叫 API，快速預覽）
npx ts-node src/index.ts novel.epub --reading --mock

# Claude API 模式（兩階段：Mock 結構分析 → Claude 補充中文）
npx ts-node src/index.ts novel.epub --reading

# Ollama 離線模式
npx ts-node src/index.ts novel.epub --reading --offline

# 依卡片類型切割為 4 個 CSV（術語 / 因果 / 章節 / 主題）
npx ts-node src/index.ts novel.epub --reading --mock --split-chapters

# 某類型卡片過多時，再以 --split-size 細分（每檔最多 N 張）
npx ts-node src/index.ts novel.epub --reading --mock --split-chapters --split-size 20

# 切割 + 單字卡 HTML 三合一
npx ts-node src/index.ts novel.epub --reading --mock --split-chapters --flash
```

`--split-chapters` 搭配 `--reading` 輸出（不帶 `--split-size`）：
```
output/{deck}-reading-ch-01-terms.csv      # 全書術語卡
output/{deck}-reading-ch-02-causes.csv     # 因果事件卡
output/{deck}-reading-ch-03-chapters.csv   # 章節脈絡卡（每章一行）
output/{deck}-reading-ch-04-themes.csv     # 主題意象卡
```

加上 `--split-size 20`，某類型超過 20 張時自動細分：
```
output/{deck}-reading-ch-03-01-chapters.csv   # 第 1–20 章
output/{deck}-reading-ch-03-02-chapters.csv   # 第 21–40 章
output/{deck}-reading-ch-03-03-chapters.csv   # 第 41–60 章
```
填入後整目錄打包：`npx ts-node src/index.ts output/ -d "My Novel"`

## 單字卡 HTML（`--flash`）

可附加於任何執行模式，額外產出 `{deck}-flash.html`。

### 頁面功能

| 操作 | 方式 |
|------|------|
| 切換類型 | 頁籤（詞彙 / 克漏字 / 人物 / 情節），顯示各類型張數 |
| 翻面 | 點擊卡片、翻面按鈕、空白鍵、Enter |
| 換頁 | 上一張 / 下一張按鈕，或鍵盤 ← → |
| 進度 | 顯示「目前張 / 總張數」 |

### 正反面內容對應

| 類型 | 正面 | 背面 |
|------|------|------|
| vocab | 單字 ＋ 例句 | 繁體中文定義 |
| cloze | 挖空句（`___`） | 提示 ＋ 含答案原句（`【word】`）|
| character | 人名 ＋ 首次出現原句 | 繁體中文描述 |
| plot | 中文問題 | 答案 |

## 初學者覆蓋率模式（`--beginner`）

適用對象：熟悉中文、英文程度初階，想在讀完字卡後能閱讀整本小說。

**設計原理**：根據語言學覆蓋率研究（Nation 2001），讀者認識文本中 95% 的詞時才能流暢閱讀。本模式掃描全書詞頻，計算出「學多少個字能達到目標覆蓋率」，並按重要性排序輸出供翻譯的清單。

### 工作流程

```bash
# Step 1：掃描全書，輸出覆蓋率報告 + 兩個 CSV
npx ts-node src/index.ts novel.epub --beginner

# Step 2：填入 beginner-words.csv 的 definition_zh 欄位（手動或 DeepL）

# Step 3：用填完的 words CSV 直接產生字卡
npx ts-node src/index.ts output/novel-beginner-words.csv -d "Novel"
```

### 輸出的兩個 CSV

| 檔案 | 欄位 | 用途 |
|------|------|------|
| `*-beginner-tokens.csv` | 12 欄（含 token_id、位置、ai_hint） | 完整元資料存檔、追蹤回原文位置 |
| `*-beginner-words.csv` | 6 欄 | 精簡翻譯用，適合送 DeepL 或人工翻譯 |

**words CSV 欄位**：

| 欄位 | 說明 |
|------|------|
| `lemma` | 詞幹（字卡正面） |
| `pos` | 詞性 |
| `cefr_level` | CEFR 等級（A2–C2 / UNKNOWN） |
| `coverage_rank` | 學習優先順序（1 = 最高頻，最先學） |
| `context_sentence` | 最佳例句，提供翻譯語境（字卡背面） |
| `definition_zh` | 繁體中文定義（留空，待翻譯） |

### 覆蓋率報告範例

```
覆蓋率分析：novel
──────────────────────────────────────────────────────────
全書有效詞彙：12,845 unique lemma / 87,230 tokens
基準覆蓋率：45%（初學者已知的停用詞 + A1 詞彙）
──────────────────────────────────────────────────────────
學   300 個字 → 理解 70%
學   800 個字 → 理解 80%
學  1500 個字 → 理解 90%
學  2200 個字 → 理解 95%  ← 建議截止點
學  3000 個字 → 理解 98%
```

### 可追蹤性（Traceability）

`tokens.csv` 的 `token_id` 欄位格式為 `chunk042_sent3_tok7`，代表第 42 個段落、第 3 個句子、第 7 個 token，可精確追蹤回原文位置。`rejected` 欄位記錄每個被過濾詞的原因（`not-stopword`、`not-A1`、`not-hapax` 等），方便驗證選字邏輯。

### 六條過濾規則

| 規則 | 排除條件 |
|------|---------|
| `too-short` | 詞長 < 3 字元 |
| `alpha-only` | 含非英文字母 |
| `not-stopword` | 在停用詞清單中 |
| `not-A1` | CEFR A1 詞彙（初學者已知，預設排除） |
| `not-hapax` | 全書出現次數 < `--beginner-min-freq`（預設 2） |
| `content-pos` | 非內容詞（代名詞、介系詞等） |

## 匯入 Anki

執行後在 `output/` 目錄取得 `.apkg` 檔案，開啟 Anki → **檔案 → 匯入** 即可。
