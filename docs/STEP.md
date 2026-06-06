# STEP

> 大型需求的分段實作記錄。每個需求一個區塊，**依時間倒序**新增（最新在最上方）。

<!-- 新需求從此處往下插入，格式如下：

### [STEP-XXX] 需求標題
**狀態**：進行中 / 已完成 / 擱置
**目標**：一句話描述要做什麼、為什麼做。

1. 子任務一
2. 子任務二
3. 子任務三

**備注**：實作決策或注意事項。

-->

---

### [STEP-001] 專案初始化
**狀態**：已完成

1. 建立 TypeScript 專案結構（`src/`、`tsconfig.json`、`package.json`）
2. 實作 PDF 文字擷取（`src/pdf/extractor.ts`）
3. 實作 EPUB 章節擷取（`src/epub/extractor.ts`）
4. 定義卡片型別（`src/cards/types.ts`）
5. 實作 Claude API 生成器（`src/cards/generator.ts`，工具呼叫 + Prompt Caching）
6. 實作 Mock 生成器（`src/cards/mockGenerator.ts`）
7. 實作 Anki 匯出器（`src/anki/exporter.ts`，SQLite + ZIP）
8. 實作 CLI 入口（`src/index.ts`，Commander.js）
9. 撰寫 `CLAUDE.md` 文件
