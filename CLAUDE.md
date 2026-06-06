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
```

## 使用範例

```bash
# EPUB 小說，只產生詞彙卡和克漏字
npx ts-node src/index.ts novel.epub --types vocab,cloze

# PDF，指定牌組名稱，處理前 5 個區塊
npx ts-node src/index.ts novel.pdf --deck "Pride and Prejudice" --chunks 5

# Mock 模式測試，不花 API 費用
npx ts-node src/index.ts novel.epub --mock
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
src/
├── pdf/extractor.ts       # PDF 文字擷取與分段
├── epub/extractor.ts      # EPUB 章節擷取與分段
├── cards/
│   ├── types.ts           # TypeScript 型別定義
│   ├── generator.ts       # Claude API 字卡生成（含 prompt caching）
│   ├── mockGenerator.ts   # Mock 模式字卡生成（不用 API）
│   └── templates.ts       # Anki HTML / CSS 模板
├── anki/exporter.ts       # .apkg 匯出（SQLite + zip）
└── index.ts               # CLI 入口
output/                    # 產生的 .apkg 儲存位置
```

## 輸出語言

所有字卡說明、定義、摘要以**繁體中文**輸出，英文原文保留。

## 協作語言

與 Claude 互動時，請以**繁體中文**溝通與回應。
