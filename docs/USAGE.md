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
```

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

## 匯入 Anki

執行後在 `output/` 目錄取得 `.apkg` 檔案，開啟 Anki → **檔案 → 匯入** 即可。
