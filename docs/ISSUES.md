# ISSUES

> 已知問題與潛在風險。修復後標註狀態與對應 STEP 編號。

## 錯誤處理

- **區塊失敗靜默繼續**（`src/index.ts`）：單一區塊生成失敗時只印 log，不累積錯誤報告，使用者無法得知有多少區塊失敗。
- **EPUB 章節靜默跳過**（`src/epub/extractor.ts:55-60`）：`getChapterAsync` 失敗時 `continue`，無任何 log。

## 資料驗證

- **Claude 回應未驗證內容**（`src/cards/generator.ts:32-34`）：只確認工具呼叫存在，未驗證卡片陣列長度或必填欄位，Claude 回傳空陣列或缺欄位時靜默輸出零張卡。
- **EPUB HTML 清理不完全**（`src/epub/extractor.ts:7-20`）：`<script>` / `<style>` 標籤內容未移除，可能污染送給 Claude 的文本。

## 型別安全

- **強制轉型降低嚴格模式效果**（`src/cards/generator.ts`）：`as { cards: Array<...> }` 繞過型別驗證，錯誤的 API 回應結構在執行期才會崩潰。

## 效能

- **大型書籍記憶體累積**（`src/index.ts`）：所有區塊的字卡全部累積到記憶體後才匯出，1000+ 區塊的書籍可能 OOM。
- **並行 API 呼叫無節流**（`src/cards/generator.ts`）：每個 Chunk 同時發出 4 個 Claude 請求，大量區塊時可能觸發 Anthropic 速率限制。

## 功能限制

- 克漏字目前只支援單一 `{{c1::}}`，不支援多重填空。
- 無卡片去重機制，同一單字若在多章節出現會重複建卡。
