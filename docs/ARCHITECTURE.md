# ARCHITECTURE

## 概覽

從英文 PDF / EPUB 小說自動產生 Anki 字卡的 CLI 工具。  
使用 Claude API（工具呼叫模式）產生結構化字卡，輸出為 `.apkg` 格式。

## 資料流

```
CLI 輸入
  │
  ├─ .pdf → src/pdf/extractor.ts  → Chunk[]
  └─ .epub → src/epub/extractor.ts → Chunk[]
                   │
                   ▼
           逐 Chunk 處理
                   │
         ┌─────────┴─────────┐
       --mock              API 模式
         │                   │
  mockGenerator.ts     generator.ts
  （規則式提取）        （Claude 工具呼叫，4 類並行）
         │                   │
         └─────────┬─────────┘
                   ▼
           GeneratedCards 合併
                   │
                   ▼
        ┌──────────────────────────────┐
        │  src/anki/exporter.ts        │
        │  （SQLite → ZIP → .apkg）    │
        ├──────────────────────────────┤
        │  src/html/exporter.ts        │
        │  （GeneratedCards → .html）  │
        └──────────────────────────────┘
                   │
                   ▼
           ./output/{deckName}.apkg
           ./output/{deckName}.html
```

## 模組職責

| 模組 | 路徑 | 職責 |
|------|------|------|
| CLI 入口 | `src/index.ts` | 參數解析、流程協調、進度輸出 |
| PDF 提取 | `src/pdf/extractor.ts` | pdf-parse → 段落分割 → Chunk[] |
| EPUB 提取 | `src/epub/extractor.ts` | epub2 → stripHtml → 分割 → Chunk[] |
| 型別定義 | `src/cards/types.ts` | Chunk、*Card、GeneratedCards 介面 |
| API 生成 | `src/cards/generator.ts` | Claude 工具呼叫、Prompt Caching |
| Mock 生成 | `src/cards/mockGenerator.ts` | 規則式提取，不需 API → 詳見 [mock/ARCHITECTURE.md](mock/ARCHITECTURE.md) |
| 卡片模板 | `src/cards/templates.ts` | Anki HTML/CSS 模板常數 |
| Anki 匯出器 | `src/anki/exporter.ts` | SQLite 建構、ZIP 打包、.apkg 輸出 |
| HTML 匯出器 | `src/html/exporter.ts` | GeneratedCards → 自含式 HTML 預覽頁 |

## 核心型別

```typescript
interface Chunk          { index: number; text: string; chapter?: string }
interface VocabCard      { type: 'vocab';     word: string; definition_zh: string; exampleFromText: string }
interface ClozeCard      { type: 'cloze';     text: string; hint_zh: string }
interface CharacterCard  { type: 'character'; name: string; description_zh: string; firstMention: string }
interface PlotCard       { type: 'plot';      question_zh: string; answer_zh: string }
interface GeneratedCards { vocab: VocabCard[]; cloze: ClozeCard[]; character: CharacterCard[]; plot: PlotCard[] }
type CardTypes = 'vocab' | 'cloze' | 'character' | 'plot'
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
| `@anthropic-ai/sdk` | Claude API 官方 SDK |
| `better-sqlite3` | 建構 Anki SQLite 資料庫 |
| `jszip` | 打包 `.apkg`（ZIP 容器） |
| `pdf-parse` | PDF 文字提取 |
| `epub2` | EPUB 章節解析 |
| `commander` | CLI 參數解析 |
| `chalk` | 終端彩色輸出 |
| `dotenv` | 載入 `.env` 環境變數 |
