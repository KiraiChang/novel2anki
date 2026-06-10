# USAGE

## 快速開始

```bash
# 1. 設定 API Key
cp .env.example .env
# 編輯 .env，依需要填入：
#   ANTHROPIC_API_KEY=sk-ant-...        ← 標準模式必填
#   DEEPL_API_KEY=your-deepl-key        ← TRANSLATE_PROVIDER=deepl 時必填
#   MW_API_KEY=your-mw-key              ← 選用，有設定時字典定義品質更佳
#                                          申請：https://dictionaryapi.com/register/index

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
  --translate             批次翻譯 CSV 定義（後端依 TRANSLATE_PROVIDER 決定，預設 deepl）
  --translate-force       強制重新翻譯（即使 CSV 已有翻譯內容也全部覆寫）
  --split-chapters        將 CSV 依章節分割輸出（搭配 --mock）
  --split-size <數量>     將 CSV 依每 N 個 chunk 分割輸出（搭配 --mock）
  --reading               讀書理解模式：產出術語、因果、章節脈絡、主題意象字卡
  --flash                 額外輸出單字卡 HTML（頁籤切換 + 上一張 / 下一張 + 翻面）
  --beginner              初學者模式：掃描全書，擷取達目標覆蓋率所需詞彙，輸出翻譯用 CSV
  --beginner-target <N>   覆蓋率目標 0–100（預設：95）
  --beginner-min-freq <N> 詞彙最低出現次數（預設：2）
  --beginner-include-a1   包含 A1 基礎詞彙（預設：排除）
  --beginner-split <N>    將翻譯 CSV 分割為每 N 個詞彙一個檔案（搭配 --beginner）
  --mw                    MW 預查：預先查詢英文定義寫入 CSV 的 definition_en 欄（需設定 MW_API_KEY）
  --update-dict           將 CSV 的 definition_en 升級到個人精選字典 word-dict.json
  --prefetch-cefr         批次預查 CEFR 字庫（5782 詞）MW 英文定義，存入 word-cache.json（需設定 MW_API_KEY）
  --prefetch-cefr-zh      批次翻譯 word-cache.json 的英文定義為繁體中文，存入 word-cache-zh.json
  --prefetch-phrases      批次預查片語庫（1409 個片語）MW 英文定義，存入 phrase-cache.json（需設定 MW_API_KEY；命中與查無結果均快取）
  --fill-sent-zh          雙向同步例句翻譯：已有 context_sentence_zh 的寫入 sentence-cache.json；空白的從快取補填
  --fill-def-zh [layers]  雙向同步詞彙定義（definition_zh 與 definition_en）。layers 格式：domain 或 domain,book
                          （例：--fill-def-zh=fantasy 或 --fill-def-zh=fantasy,the-demon-awakens）
                          未指定時只同步全局快取（zh: word-cache-zh.json；en: word-cache.json）
                          CEFR 已知詞才寫入 global；UNKNOWN 詞寫入 domain/book 分層快取
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
npx ts-node src/index.ts novel.epub --translate --chunks 5

# DeepL + Claude API 比對模式（同時產生比對 HTML）
npx ts-node src/index.ts novel.epub --translate --chunks 5

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
| vocab | 單字 ＋ 英文例句 | 繁體中文定義（＋例句中文翻譯，若有填入） |
| cloze | 挖空句（`___`） | 提示 ＋ 含答案原句（`【word】`）|
| character | 人名 ＋ 首次出現原句 | 繁體中文描述 |
| plot | 中文問題 | 答案 |

## 初學者覆蓋率模式（`--beginner`）

適用對象：熟悉中文、英文程度初階，想在讀完字卡後能閱讀整本小說。

**設計原理**：根據語言學覆蓋率研究（Nation 2001），讀者認識文本中 95% 的詞時才能流暢閱讀。本模式掃描全書詞頻，計算出「學多少個字能達到目標覆蓋率」，並按重要性排序輸出供翻譯的清單。

### 工作流程

`--beginner` 掃描完成後，除了 CSV 外，還會輸出 `*-beginner-names.txt`（人名與專有名詞清單）。  
可在翻譯前開啟確認 / 新增 / 刪除，翻譯時自動讀取，防止人名被翻譯後端誤譯（例如 "Pony" → "小馬"）。

名稱檔支援兩種格式：
- **只保護**（翻譯後保留英文原名）：每行只寫英文名，例如 `Elbryan`
- **指定音譯**（翻譯後替換為中文）：`英文名: 中文音譯`，例如 `Markwart: 馬克瓦特`

> 宗教頭銜（Father、Abbot、Brother…）、軍事頭銜（Captain、General、Colonel…）、封建稱謂（King、Queen、Sir…）等已內建排除，**不會出現在人名表中**，翻譯後端會直接翻譯這些詞（如「神父」「隊長」「國王」）。

#### 手動翻譯

```bash
# Step 1：掃描全書，輸出覆蓋率報告 + CSV + 人名表
npx ts-node src/index.ts novel.epub --beginner
# 輸出：
#   output/novel-beginner-words.csv   ← 待翻譯清單
#   output/novel-beginner-names.txt   ← 人名表（可手動編輯）

# Step 1.5（選用）：開啟 *-beginner-names.txt 確認人名清單
#   - 補充偵測漏掉的奇幻人名
#   - 為角色名加上中文音譯：Elbryan: 艾爾布萊恩

# Step 2：填入 *-beginner-words.csv 的 definition_zh 欄位
#         （可選填 context_sentence_zh 補充例句中文翻譯）

# Step 3：用填完的 words CSV 直接產生字卡
npx ts-node src/index.ts output/novel-beginner-words.csv -d "Novel" --flash
```

#### DeepL 翻譯

`--translate` 只負責翻譯並覆寫 CSV，**不產生 APKG / HTML**，讓你確認所有分割檔都翻譯完後再統一合併。  
翻譯時自動讀取同目錄的 `*-beginner-names.txt`，以預建名詞集保護人名（無此檔案時動態偵測）。

```bash
# Step 1：擷取（單一檔或分割），同時產生人名表
npx ts-node src/index.ts novel.epub --beginner
# 或分割版（每 100 個詞一個 CSV）
npx ts-node src/index.ts novel.epub --beginner --beginner-split 100
# 輸出：output/novel-beginner-names.txt  ← 可在此時編輯
#   加入音譯：Markwart: 馬克瓦特
#   補充漏掉的人名：Elbryan

# Step 2：整目錄翻譯（自動讀取 *-beginner-names.txt 保護人名）
#         每次執行前顯示費用估算，輸入 [Y/n] 確認後才送出
npx ts-node src/index.ts output/ -d "Novel" --translate
# 或逐一翻譯各分割 CSV
npx ts-node src/index.ts output/novel-beginner-words-part-01.csv -d "Novel" --translate
npx ts-node src/index.ts output/novel-beginner-words-part-02.csv -d "Novel" --translate

# Step 3：所有 CSV 翻譯完成後，整目錄合併產出最終字卡
npx ts-node src/index.ts output/ -d "Novel" --flash
```

> **字典來源**：翻譯前會先從字典 API 取得英文定義再送 DeepL。有設定 `MW_API_KEY` 時使用 Merriam-Webster（品質較佳），否則使用 Free Dictionary API（dictionaryapi.dev）作為 fallback。
>
> `--translate` 會自動跳過已有 `definition_zh` 的列，重複執行同一個檔案不會覆蓋已有翻譯。若需強制重新翻譯（例如修正錯誤翻譯），改用 `--translate-force`：
>
> ```bash
> # 強制重新翻譯單一 CSV（覆寫所有已有翻譯）
> npx ts-node src/index.ts output/novel-beginner-words-part-01.csv -d "Novel" --translate-force
>
> # 強制重新翻譯整個目錄的所有 words CSV
> npx ts-node src/index.ts output/ -d "Novel" --translate-force
> ```

### 輸出檔案

| 檔案 | 欄位數 | 用途 |
|------|:---:|------|
| `*-beginner-tokens.csv` | 12 | 完整元資料存檔、追蹤回原文位置（含 token_id、ai_hint） |
| `*-beginner-words.csv` | 9 | 精簡翻譯用，適合手動或 DeepL 翻譯 |
| `*-beginner-words-part-NN.csv` | 9 | 分割版（搭配 `--beginner-split`），逐批翻譯後放回目錄合併 |
| `*-beginner-names.txt` | — | 人名與專有名詞清單，翻譯前可手動編輯，`--translate` 自動讀取。支援兩種格式：`Elbryan`（保留英文原名）或 `Markwart: 馬克瓦特`（指定中文音譯） |

**words CSV 欄位**（9 欄）：

| 欄位 | 說明 |
|------|------|
| `lemma` | 詞幹（字卡正面） |
| `pos` | 詞性 |
| `cefr_level` | CEFR 等級（A2–C2 / UNKNOWN） |
| `coverage_rank` | 學習優先順序（1 = 最高頻，最先學） |
| `global_frequency` | 全書出現次數 |
| `context_sentence` | 最佳英文例句，提供翻譯語境（字卡背面正面） |
| `context_sentence_zh` | 例句中文翻譯（留空，可選填，字卡背面輔助理解） |
| `definition_en` | 英文定義（`--mw` 自動填入；可手動編輯作書級客製化；`--update-dict` 升級至全域字典） |
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
| `proper-noun` | 在句子中間出現時大寫比例 > 70%（人名、地名等專有名詞） |

## 翻譯後端切換

`--translate` 和 `--prefetch-cefr-zh` 都透過統一的翻譯層送出請求，可用 `TRANSLATE_PROVIDER` 環境變數切換後端，不需修改任何 CLI 指令。

```bash
# .env 設定（選一種）
TRANSLATE_PROVIDER=deepl     # DeepL（預設）— DEEPL_API_KEY 必填
TRANSLATE_PROVIDER=google    # Google Translate — GOOGLE_TRANSLATE_API_KEY 必填
TRANSLATE_PROVIDER=azure     # Azure Translator — AZURE_TRANSLATOR_KEY 必填（AZURE_TRANSLATOR_REGION 選填）
TRANSLATE_PROVIDER=claude    # Claude Haiku — ANTHROPIC_API_KEY 必填（複用現有 key）
```

| 後端 | 免費額度 | 備註 |
|------|---------|------|
| DeepL | 500,000 字/月 | 品質最佳；需獨立申請 |
| Google Translate | 500,000 字/月 | 需啟用 Google Cloud Translation API |
| Azure Translator | 2,000,000 字/月 | 免費額度最高；需建立 Azure 認知服務資源 |
| Claude Haiku | 依 token 計費 | 無免費額度，但與現有 Anthropic key 共用 |

## CEFR 字庫預查工作流程

CEFR 字庫（5,782 詞）的 MW 英文定義與繁體中文翻譯可分兩步批次建立，建完後 `--translate` 翻譯時直接從快取讀取，不再查 API。

### Step 1：批次預查 MW 英文定義（`--prefetch-cefr`）

```bash
# 需設定 MW_API_KEY（1000 req/day 免費，約 6 天建完 5782 詞）
npx ts-node src/index.ts --prefetch-cefr
# 輸出：~/.novel2anki/word-cache.json（每次執行自動跳過已快取詞，可中斷重跑）
```

已快取的詞下次自動跳過，可每天定時執行直到建完。

### Step 2：批次翻譯為繁體中文（`--prefetch-cefr-zh`）

```bash
# 需先完成 Step 1；依設定的 TRANSLATE_PROVIDER 送翻譯請求
npx ts-node src/index.ts --prefetch-cefr-zh
# 輸出：~/.novel2anki/word-cache-zh.json（已翻譯的詞自動跳過）

# 或指定後端（覆寫 .env 設定）
TRANSLATE_PROVIDER=azure npx ts-node src/index.ts --prefetch-cefr-zh
```

Azure 免費額度 2,000,000 字/月，5782 詞 × 平均 40 字元 ≈ 23 萬字元，一次可跑完。

### 快取檔位置

所有檔案預設存放於 `~/.novel2anki/`（可用 `.env` 的 `WORD_CACHE_PATH` 指定其他目錄）。  
`WORD_CACHE_PATH` 同時控制使用者資料與參考資料的查找路徑：設定後，程式優先從該目錄讀取 `cefr-wordlist.json` 和 `phrase-list.json`，找不到才退回 `src/data/` 內建版本。

| 檔案 | 內容 | 建立方式 |
|------|------|---------|
| `word-dict.json` | 個人精選英文定義（不自動覆寫） | `--update-dict` 手動升級 |
| `word-cache.json` | MW 自動查詢快取（英文定義） | `--prefetch-cefr` 或 `--mw` |
| `word-cache-zh.json` | 翻譯後的繁體中文定義（CEFR 已知詞） | `--prefetch-cefr-zh` 或 `--fill-def-zh` |
| `domain_{name}_cache_zh.json` | domain 專屬中文定義快取（含 UNKNOWN 詞，`{zh, source}`） | `--fill-def-zh=domain` 寫回時建立 |
| `domain_{name}_cache.json` | domain 專屬英文定義快取（含 UNKNOWN 詞，`{def, source}`） | `--fill-def-zh=domain` 寫回時建立（en cache） |
| `book_{name}_cache_zh.json` | book 專屬中文定義快取（含 UNKNOWN 詞，`{zh, source}`） | `--fill-def-zh=domain,book` 寫回時建立 |
| `book_{name}_cache.json` | book 專屬英文定義快取（含 UNKNOWN 詞，`{def, source}`） | `--fill-def-zh=domain,book` 寫回時建立（en cache） |
| `sentence-cache.json` | 例句翻譯快取（FNV-1a hash → `{en, zh}`） | `--translate` 翻譯時自動存入；`--fill-sent-zh` 雙向同步 |
| `cefr-wordlist.json` | CEFR 字庫（5,732 詞，A1–C2） | `scripts/build-cefr.js` 產生；若存在則優先讀此處 |
| `phrase-list.json` | 學術／常見片語庫（1,409 條，含 OPAL / OPL 來源） | `scripts/extract-phrase-lists.py` 產生；若存在則優先讀此處 |
| `phrase-cache.json` | MW 片語定義快取（命中與 no-def 均存） | `--prefetch-phrases` 建立；存在時自動跳過已查詢的片語 |

## 例句翻譯快取（`--fill-sent-zh`）

`--translate` 翻譯結束後，每筆例句翻譯會自動存入 `sentence-cache.json`（以例句 FNV-1a hash 為 key）。  
若之後有新的 beginner words CSV 尚未翻譯例句，可用 `--fill-sent-zh` 從快取補填，不需再呼叫翻譯 API：

```bash
# 單一 CSV 補填 + 同步
npx ts-node src/index.ts output/novel-beginner-words.csv --fill-sent-zh

# 整目錄批次補填
npx ts-node src/index.ts output/ --fill-sent-zh
```

執行後輸出三類統計：
- **存入快取**：CSV 中已有 `context_sentence_zh` 的列，翻譯寫入 `sentence-cache.json`
- **補填 CSV**：CSV 中原本空白、快取命中的列，填入翻譯並更新 CSV 檔案
- **略過**：例句為空，或快取中找不到對應翻譯的列

## 詞彙定義快取（`--fill-def-zh`）

`--translate` 翻譯後，每筆 `definition_zh` 與 `definition_en` 可同時雙向同步至快取：
- **zh**：同步 `definition_zh` ↔ `word-cache-zh.json`（全局）/ `*_cache_zh.json`（分層）
- **en**：同步 `definition_en` ↔ `word-cache.json`（全局）/ `*_cache.json`（分層）

讓未來其他書的同一詞彙直接讀快取而不需重翻，也能從已有 MW 定義的 `word-cache.json` 填回 `definition_en`。

### 基本用法（全局快取）

```bash
# 單一 CSV 雙向同步（zh: word-cache-zh.json；en: word-cache.json）
npx ts-node src/index.ts output/novel-beginner-words.csv --fill-def-zh

# 整目錄批次同步
npx ts-node src/index.ts output/ --fill-def-zh
```

**兩層寫入條件互斥**（zh 與 en 均適用相同規則）：

| 快取 | 寫入條件 | 目的 |
|------|---------|------|
| `word-cache-zh.json` / `word-cache.json`（global） | CEFR level 已知（非 UNKNOWN） | 通用詞彙（A1–C2），跨書共用 |
| `domain_*/book_*_cache_zh.json` / `*_cache.json` | CEFR UNKNOWN（不在 CEFR 字庫） | 領域/書本特有詞（自創詞、角色名等） |

兩層互補不重疊：CEFR 已知的詞只進 global，UNKNOWN 詞只進 domain/book。

### 分層快取（`--fill-def-zh=domain` 或 `=domain,book`）

指定 domain 或 book 後，會額外操作 domain / book 專屬快取，適合同系列或同類型書籍共用領域特有詞彙的翻譯。

```bash
# 只用 domain 快取（奇幻類型通用）
npx ts-node src/index.ts output/ --fill-def-zh=fantasy

# 同時用 domain + book 快取（書本優先）
npx ts-node src/index.ts output/ --fill-def-zh=fantasy,the-demon-awakens
```

**查詢優先順序**（cache → CSV 補填）：
```
book cache → domain cache → global cache
```
三層均參與查詢。UNKNOWN 詞通常只在 domain/book 找到；CEFR 已知詞通常只在 global 找到。

**快取檔案**（與全局快取放同一目錄 `~/.novel2anki/`）：
```
domain_fantasy_cache_zh.json          ← 中文定義（CEFR UNKNOWN 詞，奇幻通用）
domain_fantasy_cache.json             ← 英文定義（CEFR UNKNOWN 詞，奇幻通用）
book_the-demon-awakens_cache_zh.json  ← 中文定義（CEFR UNKNOWN 詞，本書專屬）
book_the-demon-awakens_cache.json     ← 英文定義（CEFR UNKNOWN 詞，本書專屬）
```

> **注意**：只指定 `--fill-def-zh=fantasy`（無 book）時，book 快取完全不參與。若之前已用 `--fill-def-zh=fantasy,book1` 建立了 book1 快取，改用 `--fill-def-zh=fantasy` 不會讀到 book1 的資料，屬預期行為。

### 輸出統計

三類統計（與 `--fill-sent-zh` 格式相同）：
- **存入快取**：`definition_zh` 或 `definition_en`（或兩者）成功寫入任一層快取的列數
- **略過（已有）**：欄位不為空、但全部目標層快取皆已有此詞條目的列數
- **補填 CSV**：`definition_zh` 或 `definition_en`（或兩者）原本空白、任一層快取命中並填入的列數
- **略過（無快取）**：lemma 為空，或兩欄均空白且各層快取均找不到的列數

## 匯入 Anki

執行後在 `output/` 目錄取得 `.apkg` 檔案，開啟 Anki → **檔案 → 匯入** 即可。
