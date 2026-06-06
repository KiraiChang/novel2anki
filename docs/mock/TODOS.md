# Mock 模式 TODOS

> 對應原始碼：`src/cards/mockGenerator.ts`  
> 完成後勾選並標註日期，同步更新 `docs/mock/ISSUES.md` 對應條目。

---

## 克漏字卡

- [ ] **修正重複單字只挖空第一個**  
  `mockCloze`：改用全域 Regex 替換（`new RegExp(clean, 'g')`），確保所有出現位置都被填空。  
  對應 ISSUES：`String.replace` 只替換第一個符合位置

- [ ] **防止 `clean` 為空字串時產生格式錯誤**  
  `mockCloze`：在 `replace` 前加 `if (!clean) continue`，跳過無效目標。  
  對應 ISSUES：標點清除可能產生空字串

- [ ] **改善克漏字選詞策略**  
  `mockCloze`：優先選名詞或動詞（可用詞尾啟發式：`-tion`、`-ness`、`-ed`、`-ing`），而非固定取中間位置。  
  對應 ISSUES：目標單字選取位置固定

---

## 詞彙卡

- [ ] **擴充 COMMON_WORDS 黑名單**  
  `extractLongWords`：補充常見長字（`thought`、`through`、`something`、`because`、`another`、`without`、`between`、`everything` 等），或改用詞頻字典（如 en-basic-word-list）過濾。  
  對應 ISSUES：長度啟發式選詞品質低

- [ ] **避免例句重複使用**  
  `mockVocab`：當句子數量不足時，對多餘的單字改用 `chunk.text` 的不同片段而非循環同一句。  
  對應 ISSUES：例句循環取用可能重複

---

## 人物概念卡

- [ ] **擴充句首詞排除清單**  
  `extractCapitalizedNames`：將現有 7 個詞擴充為完整的英文句首常見詞集合（`But`、`When`、`Now`、`After`、`Before`、`During`、`While`、`Although`、`However` 等至少 30 個）。  
  對應 ISSUES：排除清單過於簡陋

- [ ] **限制只在句子中間位置匹配大寫詞**  
  `extractCapitalizedNames`：過濾掉每個句子第一個 token（句首大寫），降低誤判率。  
  對應 ISSUES：大寫開頭不等於專有名詞

---

## 情節問答卡

- [ ] **讓摘要覆蓋段落頭尾**  
  `mockPlot`：改為取前 2 句 + 最後 1 句，避免段落重點在中後段時被遺漏；截斷改為在句子邊界截，不在字元中間截斷。  
  對應 ISSUES：摘要來源只取前三句

---

## 通用

- [ ] **跨 Chunk 單字去重**  
  `generateMockCards` 呼叫端（`src/index.ts`）：維護已出現的單字與名稱 Set，生成前過濾掉重複項目。  
  對應 ISSUES：多 Chunk 間無去重
