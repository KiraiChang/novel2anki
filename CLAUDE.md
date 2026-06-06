# PDF / EPUB Anki 字卡產生器

從英文 PDF 或 EPUB 小說自動產生有情境關聯的 Anki 字卡。

## 快速開始

```bash
# 1. 設定 API Key
cp .env.example .env
# 編輯 .env，填入 ANTHROPIC_API_KEY=sk-ant-...

# 2. 不用 API 先測試整條流程（mock 模式）
npx ts-node src/index.ts novel.epub --mock --chunks 3

# 3. 正式執行（呼叫 Claude API）
npx ts-node src/index.ts novel.pdf --chunks 3
```

## 完整選項

```
npx ts-node src/index.ts <檔案> [選項]

引數：
  <檔案>               PDF 或 EPUB 檔案路徑

選項：
  -d, --deck <名稱>    牌組名稱（預設：檔名）
  -t, --types <類型>   字卡類型，逗號分隔（預設：全部）
                       可選值：vocab, cloze, character, plot
  -c, --chunks <數量>  最多處理幾個段落區塊（預設：全部）
  -o, --output <目錄>  .apkg 輸出目錄（預設：./output）
  --mock               模擬模式：不呼叫 API，用文字分析產生測試字卡
  --offline            離線模式：使用本機 Ollama 產生字卡（需先啟動 Ollama）
  --model <模型名稱>   指定 Ollama 模型（預設：llama3.2，也可設定 OLLAMA_MODEL）
```

## 使用範例

```bash
# EPUB 小說，只產生詞彙卡和克漏字
npx ts-node src/index.ts novel.epub --types vocab,cloze

# PDF，指定牌組名稱，處理前 5 個區塊
npx ts-node src/index.ts novel.pdf --deck "Pride and Prejudice" --chunks 5

# Mock 模式測試，不花 API 費用
npx ts-node src/index.ts novel.epub --mock

# 離線模式（需先執行 ollama serve 並 ollama pull llama3.2）
npx ts-node src/index.ts novel.epub --offline --chunks 3

# 離線模式，自訂模型
npx ts-node src/index.ts novel.epub --offline --model gemma3 --chunks 3
```

## 字卡類型

| 類型 | 說明 | Anki 模型 |
|------|------|-----------|
| `vocab` | 英文單字 → 繁中定義 + 原文例句 | Basic |
| `cloze` | 關鍵片語挖空填充 | Cloze |
| `character` | 人物／地點／概念介紹 | Basic |
| `plot` | 情節理解問答（正反兩面） | Basic + Reversed |

## 匯入 Anki

執行後在 `output/` 目錄取得 `.apkg` 檔案，開啟 Anki → **檔案 → 匯入** 即可。

## 專案結構

```
novel2anki/
├── src/
│   ├── index.ts                  # CLI 入口
│   ├── pdf/
│   │   └── extractor.ts          # PDF 文字擷取與分段
│   ├── epub/
│   │   └── extractor.ts          # EPUB 章節擷取與分段
│   ├── cards/
│   │   ├── types.ts              # TypeScript 型別定義
│   │   ├── generator.ts          # Claude API 字卡生成（含 prompt caching）
│   │   ├── mockGenerator.ts      # Mock 模式字卡生成（不用 API）
│   │   └── templates.ts          # Anki HTML / CSS 模板
│   ├── anki/
│   │   └── exporter.ts           # .apkg 匯出（SQLite + zip）
│   └── html/
│       └── exporter.ts           # HTML 預覽頁匯出
├── docs/                         # 專案文件（見「專案文件」章節）
│   └── mock/                     # Mock 模式子模組文件
├── book/                         # 測試用書籍存放位置
├── output/                       # 產生的 .apkg / .html 儲存位置
├── CLAUDE.md                     # 專案說明與協作規範
├── package.json
└── tsconfig.json
```

## 輸出語言

所有字卡說明、定義、摘要以**繁體中文**輸出，英文原文保留。

## 協作語言

與 Claude 互動時，請以**繁體中文**溝通與回應。

## 執行步驟

每次收到需求時，依序執行以下步驟，不得跳過：

| 步驟 | 動作 | 說明 |
|------|------|------|
| 0 | **分析需求大小** | 判斷是小修改或大需求。大需求須先拆分為子任務，登錄至 `docs/STEP.md`，再逐步執行 |
| 1 | **複述需求確認** | 用自己的話重新描述理解到的需求，請使用者確認是否有理解誤差，有誤差立即修正 |
| 2 | **最小範圍閱覽** | 只讀取與需求直接相關的檔案，明確說明「為什麼需要讀這個檔案」，避免無謂展開 |
| 3 | **撰寫計畫** | 列出將要修改的檔案、函式與變更內容，請使用者確認計畫 |
| 4 | **確認後執行** | 收到明確確認後才開始修改程式碼，執行期間若發現計畫外的影響須暫停回報 |
| 5 | **撰寫 BDD 測試案例** | 實作完成後，依 `docs/TESTING.md` 的 BDD 規則為新增或變更的行為補寫測試案例 |
| 6 | **確認測試通過** | 執行測試，確認所有案例如預期通過，並回報測試結果 |
| 7 | **測試失敗處理** | 同一測試案例連續失敗超過 **3 次**，停止嘗試，向使用者說明失敗原因並請求人力介入 |

## 專案文件（docs/）

所有文件存放於 `docs/` 目錄，子模組另開子目錄維護。

```
docs/
├── ARCHITECTURE.md   # 系統架構、資料流、模組職責、核心型別、相依套件
├── TODOS.md          # 待實作功能清單（checkbox）
├── ISSUES.md         # 已知問題與潛在風險
├── NOTES.md          # 架構決策與實作細節
├── STEP.md           # 大型需求分段實作記錄（倒序，最新在上）
├── TESTING.md        # 測試層次、BDD 規則、目錄結構、執行指令
└── mock/
    ├── ARCHITECTURE.md   # Mock 模式提取邏輯詳解
    ├── ISSUES.md         # Mock 模式已知限制
    └── TODOS.md          # Mock 模式待修項目
```

### 各檔案維護時機

| 檔案 | 何時更新 |
|------|---------|
| `ARCHITECTURE.md` | 新增模組、變更資料流、調整型別時 |
| `TODOS.md` | 新增需求時追加；完成後勾選並標註日期 |
| `ISSUES.md` | 發現問題時記錄；修復後標註狀態與對應 STEP |
| `NOTES.md` | 做出重要決策時記錄，避免未來重複踩坑 |
| `STEP.md` | 開始大型需求前建立條目；完成後更新狀態 |
| `TESTING.md` | 新增測試框架或調整測試策略時 |
| `mock/*` | 修改 `src/cards/mockGenerator.ts` 時同步更新 |

### 使用原則

- **TODOS vs ISSUES**：TODOS 是主動規劃要做的事；ISSUES 是被動發現的問題或風險。
- **NOTES vs ARCHITECTURE**：ARCHITECTURE 描述「現在是什麼」；NOTES 記錄「為什麼這樣做」。
- **STEP**：只用於跨多個檔案、需多個 session 才能完成的大型需求，一般小修改不需建立。
- **子目錄**：新子模組若有獨立的架構說明、問題或待辦，另開同名子目錄維護，並在主文件中加入連結。
- 文件以**繁體中文**撰寫，程式碼識別子（函式名、路徑）保留原文。
