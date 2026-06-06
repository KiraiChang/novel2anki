# 離線模式待改進項目

- [ ] 自動偵測 Ollama 版本，決定使用 `json_schema` 或 `format: "json"`（`GET /api/version`）
- [ ] 支援 `--offline-parallel` 旗標強制並行（適合大 VRAM 機器）
- [ ] 模型能力預檢指令（`novel2anki --check-model llama3.2`：發送測試 prompt 並驗證 JSON 輸出）
- [ ] OLLAMA_BASE_URL 格式驗證，提早報告設定錯誤
- [ ] streaming 支援（`stream: true`）以在終端機顯示推理進度
