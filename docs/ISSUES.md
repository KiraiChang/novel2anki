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

## 初學者模式（`--beginner` + `--translate`）

- **人名表假陽性（mid-sentence 大寫通稱）**（`src/nlp/nameProtector.ts`）：mid-sentence 大寫詞偵測無法區分「角色名（Pony）」與「文法大寫通稱（Brother、Captain、Church）」，兩者都會進入 `*-beginner-names.txt`。假陽性保留在人名表不影響翻譯正確性（翻譯後端不會把 "Brother" 翻成別的詞），使用者若在意可手動刪除。真正有問題的是假陰性（人名未被偵測），需手動在 names.txt 補充。

- **字典 API 定義品質不足**（`src/csv/beginnerTranslator.ts`）：已改為 MW Learner's API 優先，但 Fantasy 自創詞（如 `powrie`、`powry`）兩個 API 皆無收錄，fallback 為詞本身，翻譯後端遇到無意義字串可能亂翻，需人工校正。
- **翻譯批次上下文影響翻譯**（`src/csv/beginnerTranslator.ts`）：翻譯後端 array 模式會以同批次文字互為上下文，雖已改為交錯排列（`[def1, sent1, def2, sent2, …]`）降低跨詞污染，但同批次內 25 組詞對仍可能相互干擾，無法完全消除。
- **MW API key 類型錯誤靜默 fallback**（`src/csv/beginnerTranslator.ts`，已修復）：dictionaryapi.com 不同字典各有獨立 key；填入 Collegiate key 但呼叫 Learner's 端點（或反之）會收到 403，原本靜默 fallback 到 Free Dictionary，使用者不知道 MW 未生效。已修正為：① 使用 Learner's 端點（`/learners/json`）；② `!res.ok` 時輸出 stderr 警告訊息。
- **`needTranslation` 過濾只看 `definition_zh`，導致 `context_sentence_zh` 永遠空白**（`src/csv/beginnerTranslator.ts`，**已修復 2026-06-10**）：過濾條件改為 `definition_zh` OR `context_sentence_zh` 任一空白即納入翻譯；Phase 3 `definition_zh` 寫入改為空白才寫入（不覆蓋既有值）。
- **舊 CSV 的 `context_sentence_zh` 為簡體中文**：各翻譯後端現已均設定繁體中文目標（DeepL=`zh-HANT`、Google=`zh-TW`、Azure=`zh-Hant`、Claude=繁體提示），但快取中的舊翻譯未自動更新。對已翻譯的 CSV 執行 `--translate-force` 可強制重翻為繁體中文。

## Mock 模式

Mock 模式的已知限制獨立維護於 [mock/ISSUES.md](mock/ISSUES.md)。
