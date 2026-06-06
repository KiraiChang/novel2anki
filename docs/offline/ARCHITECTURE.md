# 離線模式架構（Ollama 整合）

## 觸發條件

CLI 加上 `--offline` 旗標時啟用，路由至 `src/cards/offlineGenerator.ts`。  
與 Claude API 模式（`--`預設）和 Mock 模式（`--mock`）並列，三者共用相同的 `GeneratedCards` 介面。

## 資料流

```
CLI --offline [--model <name>]
  │
  ├─ loadOllamaConfig(cliModel?) → OllamaConfig { baseUrl, model }
  │    優先順序：--model > OLLAMA_MODEL env > 預設 llama3.2
  │    baseUrl：OLLAMA_BASE_URL env > 預設 http://localhost:11434
  │
  └─ generateCards(chunk, types, config)
       │
       ├─ types.includes('vocab')     → generateVocab(chunk, config)
       ├─ types.includes('cloze')     → generateCloze(chunk, config)     （循序，非並行）
       ├─ types.includes('character') → generateCharacter(chunk, config)
       └─ types.includes('plot')      → generatePlot(chunk, config)
              │
              └─ callOllama<T>(config, userPrompt, schema)
```

## callOllama 三層降級

```
第一層：POST /api/chat
        format: { type: "json_schema", json_schema: { name: "cards", schema, strict: true } }
  ↓ JSON.parse 失敗
第二層：POST /api/chat
        format: "json"（寬鬆 JSON mode）
  ↓ JSON.parse 失敗
第三層：Regex 擷取 /\{[\s\S]*\}/ 後嘗試解析
  ↓ 全部失敗
回傳 { cards: [] }（空卡片，不中斷流程）
```

## API 請求格式

```json
POST {baseUrl}/api/chat
{
  "model": "llama3.2",
  "stream": false,
  "format": {
    "type": "json_schema",
    "json_schema": {
      "name": "cards",
      "schema": { "type": "object", "properties": { "cards": { ... } }, "required": ["cards"] },
      "strict": true
    }
  },
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user",   "content": "..." }
  ]
}
```

## 錯誤處理

| 情況 | 判斷依據 | 行為 |
|------|---------|------|
| Ollama 未啟動 | `message` 含 `ECONNREFUSED` / `fetch failed` | throw，含 `ollama serve` 提示 |
| 模型不存在 | HTTP 404 | throw，含 `ollama pull <model>` 提示 |
| JSON 解析失敗 | 三層降級全敗 | 回傳空陣列，印警告 |
| 逾時（> 60 秒） | `AbortError` | throw，含區塊索引與模型名稱 |

## 與 Claude API 模式的主要差異

| 面向 | Claude API（`generator.ts`）| Ollama（`offlineGenerator.ts`）|
|------|--------------------------|-------------------------------|
| 強制 JSON 機制 | tool_use（SDK 內建） | json_schema format + 三層降級 |
| 呼叫方式 | `Promise.all`（4 種並行） | 循序 `await`（本地模型無法真正並行） |
| HTTP 客戶端 | `@anthropic-ai/sdk` | Node 18+ 內建 `fetch()`（零新套件） |
| Prompt Caching | ephemeral cache | 不適用 |
| config 傳入方式 | 模組層級（env 自動讀取） | 由 `index.ts` 建立後傳入 |

## 模型相容性

| 模型 | json_schema 支援 | 繁體中文品質 | 備注 |
|------|----------------|------------|------|
| llama3.2 (3B/8B) | ✓（Ollama >= 0.5.0）| 良好 | 預設推薦 |
| gemma3 | ✓ | 良好 | Google 出品 |
| mistral | 部分 | 中等 | 降級至 json format |
| phi3 | 部分 | 中等 | 小型模型 |
