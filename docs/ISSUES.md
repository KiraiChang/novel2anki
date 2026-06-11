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

- **人名表假陽性（mid-sentence 大寫通稱）**（`src/nlp/nameProtector.ts`）：mid-sentence 大寫詞偵測無法區分「角色名（Pony）」與「文法大寫通稱（Church）」，兩者都會進入 `*-beginner-names.txt`。**宗教／軍事頭銜（Father、Abbot、Brother、Captain 等）已於 2026-06-10 加入 NAME_SKIP**，不再誤入人名保護集，可被翻譯後端正確翻譯。剩餘假陽性（如特定通稱大寫）保留在人名表不影響翻譯正確性，使用者若在意可手動刪除。真正有問題的是假陰性（人名未被偵測），需手動在 names.txt 補充。
- **角色名被翻譯後端音譯錯誤或意譯**（`src/nlp/nameProtector.ts`，2026-06-10 新增 mapping 機制）：部分角色名（如 Markwart、Elbryan）在翻譯後端語境下可能被音譯錯誤或翻成有語意的詞（"Pony" → "小馬"）。現已支援 `names.txt` 中的 `英文名: 中文音譯` 格式（如 `Markwart: 馬克瓦特`），`restoreNames` 優先以指定音譯替換佔位符；無 mapping 的名詞仍保留英文原名。使用者需手動在 names.txt 補充音譯。
- **代名詞被誤加入人名保護集導致 `context_sentence_zh` 殘留英文**（`src/nlp/nameProtector.ts`，**已修復 2026-06-10**）：`NAME_SKIP` 原以首字大寫版本（`'His'`）儲存，compromise `#ProperNoun` 回傳小寫 `'his'` 時繞過檢查而被保護，翻譯後還原為英文原文。修復：NAME_SKIP 改為小寫儲存，比對統一 `toLowerCase()`，並補充完整代名詞清單。

- **字典 API 定義品質不足**（`src/csv/beginnerTranslator.ts`）：已改為 MW Learner's API 優先，但 Fantasy 自創詞（如 `powrie`、`powry`）兩個 API 皆無收錄，fallback 為詞本身，翻譯後端遇到無意義字串可能亂翻，需人工校正。
- **翻譯批次上下文影響翻譯**（`src/csv/beginnerTranslator.ts`）：翻譯後端 array 模式會以同批次文字互為上下文，雖已改為交錯排列（`[def1, sent1, def2, sent2, …]`）降低跨詞污染，但同批次內 25 組詞對仍可能相互干擾，無法完全消除。
- **MW API key 類型錯誤靜默 fallback**（`src/csv/beginnerTranslator.ts`，已修復）：dictionaryapi.com 不同字典各有獨立 key；填入 Collegiate key 但呼叫 Learner's 端點（或反之）會收到 403，原本靜默 fallback 到 Free Dictionary，使用者不知道 MW 未生效。已修正為：① 使用 Learner's 端點（`/learners/json`）；② `!res.ok` 時輸出 stderr 警告訊息。
- **`needTranslation` 過濾只看 `definition_zh`，導致 `context_sentence_zh` 永遠空白**（`src/csv/beginnerTranslator.ts`，**已修復 2026-06-10**）：過濾條件改為 `definition_zh` OR `context_sentence_zh` 任一空白即納入翻譯；Phase 3 `definition_zh` 寫入改為空白才寫入（不覆蓋既有值）。
- **舊 CSV 的 `context_sentence_zh` 為簡體中文**：各翻譯後端現已均設定繁體中文目標（DeepL=`zh-HANT`、Google=`zh-TW`、Azure=`zh-Hant`、Claude=繁體提示），但快取中的舊翻譯未自動更新。對已翻譯的 CSV 執行 `--translate-force` 可強制重翻為繁體中文。
- **CSV → cache 寫回時遺失真實翻譯來源（**已修復 2026-06-11**）**：`syncDefinitionCacheWithCsv` 在 CSV→cache 方向呼叫 `bookCache.setIfEmpty` / `domainCache.setIfEmpty` / `wc.setChinese` 時，未傳入 CSV 欄位 `definition_zh_source` 的實際值，三處全數 fallback 為硬塞 `'csv'`（優先序 3）。後果：原本 `source='deepl'`（優先序 2）的翻譯存入 cache 後被誤記為 `'csv'`，等同人工校正等級，阻止後續 API 翻譯更新。修復：改為 `defZhSrc || 'csv'`（有值用真實來源，空值才 fallback `'csv'`）。
- **未知 source 字串 fallback 為 priority 0，可被 cache 覆蓋（**已修復 2026-06-11**）**：`SOURCE_PRIORITY`（`beginnerTranslator.ts`）與 `SENTENCE_SOURCE_PRIORITY`（`wordCache.ts`）僅列出已知後端，不在 map 中的字串 fallback 為 `?? 0`（等同空白），`canFillFromCache` 回傳 `true`，導致 API 翻譯被 cache 覆蓋；`setSentenceZh` 的 `existingPriority !== 0` 條件永遠 false，sentence cache 條目每次 sync 都能被蓋掉。例：使用者手動標記 `source='chatgpt'` 的翻譯會被誤判為空白。修復：加入 `'chatgpt': 2`（與 deepl/azure 同級）至兩個 map。**新增任何翻譯來源標籤時需同步更新這兩處**，詳見 `docs/NOTES.md`。

## Mock 模式

Mock 模式的已知限制獨立維護於 [mock/ISSUES.md](mock/ISSUES.md)。
