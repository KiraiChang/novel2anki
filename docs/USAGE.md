# USAGE

## 快速開始

```bash
# 1. 設定 API Key
cp .env.example .env
# 編輯 .env，填入 ANTHROPIC_API_KEY=sk-ant-...

# 2. 不用 API 先測試整條流程（mock 模式，同時產生 CSV）
npx ts-node src/index.ts novel.epub --mock --chunks 3

# 3. 正式執行（呼叫 Claude API）
npx ts-node src/index.ts novel.pdf --chunks 3
```

## 完整選項

```
npx ts-node src/index.ts <檔案> [選項]

引數：
  <檔案>               PDF、EPUB 或 CSV 檔案路徑

選項：
  -d, --deck <名稱>    牌組名稱（預設：檔名）
  -t, --types <類型>   字卡類型，逗號分隔（預設：全部）
                       可選值：vocab, cloze, character, plot
  -c, --chunks <數量>  最多處理幾個段落區塊（預設：全部）
  -o, --output <目錄>  輸出目錄（預設：./output）
  --mock               模擬模式：不呼叫 API，用文字分析產生字卡，並額外輸出 CSV
  --offline            離線模式：使用本機 Ollama 產生字卡（需先啟動 Ollama）
  --model <模型名稱>   指定 Ollama 模型（預設：llama3.2，也可設定 OLLAMA_MODEL）
  --deepl              使用 DeepL API 翻譯定義（需設定 DEEPL_API_KEY）
```

## 使用範例

```bash
# EPUB 小說，只產生詞彙卡和克漏字
npx ts-node src/index.ts novel.epub --types vocab,cloze

# PDF，指定牌組名稱，處理前 5 個區塊
npx ts-node src/index.ts novel.pdf --deck "Pride and Prejudice" --chunks 5

# Mock 模式：產生 .apkg、.html、.csv（含 ai_hint 提示詞欄）
npx ts-node src/index.ts novel.epub --mock

# 從 CSV 重新打包（編輯 CSV 填入定義後使用）
npx ts-node src/index.ts output/novel.csv -d "My Deck"

# 離線模式（需先執行 ollama serve 並 ollama pull llama3.2）
npx ts-node src/index.ts novel.epub --offline --chunks 3

# 離線模式，自訂模型
npx ts-node src/index.ts novel.epub --offline --model gemma3 --chunks 3
```

## Mock → CSV → APKG 工作流程

Mock 模式適合先快速擷取單字與例句，再以 AI 工具補全定義：

1. **執行 mock**，取得 `output/{deckName}.csv`
2. **開啟 CSV**，`ai_hint` 欄已預填提示詞，可直接複製貼入 ChatGPT / Claude
3. **填入空白欄**（`definition_zh`、`hint_zh`、`description_zh`、`answer_zh`）
4. **從 CSV 重新打包**

```bash
npx ts-node src/index.ts output/mybook.csv -d "MyBook"
```

### CSV 欄位說明

| 欄位 | mock 自動填入 | 需手動或 AI 補全 |
|------|---------------|-----------------|
| `word` | ✓ | — |
| `exampleFromText` | ✓ | — |
| `definition_zh` | 留空 | ✓ |
| `text`（cloze） | ✓ | — |
| `hint_zh` | 留空 | ✓ |
| `name` | ✓ | — |
| `firstMention` | ✓ | — |
| `description_zh` | 留空 | ✓ |
| `question_zh` | ✓ | — |
| `answer_zh` | 留空 | ✓ |
| `ai_hint` | ✓（提示詞） | — |

## 字卡類型

| 類型 | 說明 | Anki 模型 |
|------|------|-----------|
| `vocab` | 英文單字 → 繁中定義 + 原文例句 | Basic |
| `cloze` | 關鍵片語挖空填充 | Cloze |
| `character` | 人物／地點／概念介紹 | Basic |
| `plot` | 情節理解問答（正反兩面） | Basic + Reversed |

## 匯入 Anki

執行後在 `output/` 目錄取得 `.apkg` 檔案，開啟 Anki → **檔案 → 匯入** 即可。
