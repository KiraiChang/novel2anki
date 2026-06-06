# 離線模式已知問題

## 模型能力限制

- **小型模型繁體中文品質不穩定**：7B 以下模型偶爾混入簡體中文或英文解釋，可換用較大模型（8B+）改善
- **exampleFromText 有時非原文引用**：部分模型會改寫句子而非逐字引用，無法在程式層級強制校正
- **情節卡品質受限**：需要理解整段再出題，超出 3B 模型能力，建議使用 8B+ 或改用 Claude API

## JSON 輸出穩定性

- **舊版 Ollama 不支援 json_schema**：Ollama < 0.5.0 不支援 `format.json_schema`，會靜默降級至第二層（`format: "json"`）
- **部分模型 json_schema strict 失效**：即使設定 `strict: true`，部分模型仍可能回傳不符 schema 的結果

## 效能

- **循序呼叫速度**：每個 Chunk 需循序呼叫 4 次（vocab → cloze → character → plot），比 Claude API 並行模式慢約 4 倍
- **GPU 記憶體不足**：在記憶體不足的機器上，較大模型（13B+）可能 OOM 或推理極慢

## 設定

- **OLLAMA_BASE_URL 未驗證格式**：若設定格式錯誤（如缺少 `http://`）會得到模糊的網路錯誤
