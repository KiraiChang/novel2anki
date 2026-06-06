# TESTING

## 測試層次劃分

| 層次 | 範圍 | 工具（建議） | 說明 |
|------|------|-------------|------|
| **單元測試** | 純函式、工具函式 | `jest` + `ts-jest` | 不依賴 API 或檔案系統，速度快 |
| **整合測試** | 提取器、匯出器 | `jest` + 真實 fixture | 使用真實 PDF/EPUB fixture 檔案與 SQLite，驗證模組協作 |
| **端對端測試** | 完整 CLI 流程 | `jest` + `child_process` | Mock API，執行完整流程，驗證 `.apkg` 可被解壓縮並讀取 |

## 現況

目前**無任何測試**。優先補齊順序：

1. 單元：`stripHtml()`、`extractSentences()`、`extractLongWords()`、`buildColJson()`
2. 整合：`extractChunks()` 對 fixture PDF/EPUB、`exportToApkg()` 輸出可解析的 ZIP
3. 端對端：`--mock` 模式 CLI 完整執行，確認輸出 `.apkg` 結構正確

## BDD 撰寫規則

採用 **Given / When / Then** 三段式描述行為，使用 `describe` / `it` 組織：

```typescript
// 命名規則：describe = 模組或函式名稱，it = "should + 預期行為"
describe('stripHtml', () => {
  it('should convert <br> to newline', () => {
    // Given
    const input = 'Hello<br>World';
    // When
    const result = stripHtml(input);
    // Then
    expect(result).toBe('Hello\nWorld');
  });

  it('should remove script tag content', () => {
    const input = '<script>alert(1)</script>Hello';
    const result = stripHtml(input);
    expect(result).not.toContain('alert');
  });
});
```

**規則**：
- `describe` 對應一個模組、類別或函式
- `it` 以 `should` 開頭，描述單一行為
- 每個 `it` 只有一個 `expect`（例外：驗證同一行為的多個面向可允許）
- 測試資料放在 `__fixtures__/` 目錄，不 inline 大型字串
- Mock 外部依賴（Claude SDK、檔案系統）使用 `jest.mock()`

## 目錄結構（規劃）

```
src/
├── __fixtures__/
│   ├── sample.pdf
│   ├── sample.epub
│   └── mock-cards.ts        # 共用測試資料
├── __tests__/
│   ├── unit/
│   │   ├── stripHtml.test.ts
│   │   ├── extractSentences.test.ts
│   │   └── buildColJson.test.ts
│   ├── integration/
│   │   ├── pdf-extractor.test.ts
│   │   ├── epub-extractor.test.ts
│   │   └── anki-exporter.test.ts
│   └── e2e/
│       └── cli-mock-mode.test.ts
```

## 執行方式

```bash
# 安裝測試工具（尚未設定）
npm install --save-dev jest ts-jest @types/jest

# 執行全部測試
npx jest

# 執行單一層次
npx jest src/__tests__/unit
npx jest src/__tests__/integration
npx jest src/__tests__/e2e

# 監看模式（開發時）
npx jest --watch

# 覆蓋率報告
npx jest --coverage
```

## jest 設定（建議加入 package.json）

```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "testMatch": ["**/__tests__/**/*.test.ts"],
  "collectCoverageFrom": ["src/**/*.ts", "!src/**/*.d.ts"]
}
```
