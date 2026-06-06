# Mock 模式字卡提取邏輯

> 對應原始碼：`src/cards/mockGenerator.ts`  
> 觸發方式：CLI 加上 `--mock` 旗標，不呼叫任何外部 API。

---

## 概覽

Mock 模式以純規則（Regex + 字串處理）從段落文本中提取資訊，產生四種型態的字卡。  
產生的內容僅用於**驗證整條流程是否正常運作**，品質遠低於 API 模式，所有卡片均附有 `【模擬】` 前綴提示。

---

## 三個共用提取函式

所有卡片生成函式都依賴這三個底層工具，先理解它們再看各卡片邏輯。

### `extractSentences(text)`

將段落切割為句子，篩選出長度適中的句子作為例句素材。

```
輸入：段落全文
  │
  ├─ 以 [.!?] 後的空白為斷點切割（使用 lookbehind: /(?<=[.!?])\s+/）
  ├─ 每句 trim()
  └─ 過濾：長度 30–200 字元（太短無意義，太長不適合當例句）

輸出：string[]
```

### `extractLongWords(text)`

從文本提取「有學習價值」的長單字，排除高頻虛詞。

```
輸入：段落全文
  │
  ├─ 全部轉小寫，Regex /\b[a-z]{7,}\b/ 取出所有 ≥ 7 字母的單字
  ├─ 去重（Set）
  ├─ 過濾掉 COMMON_WORDS 黑名單（75 個高頻虛詞，如 the/and/would 等）
  └─ 取前 10 個

輸出：string[]（小寫）
```

**COMMON_WORDS 黑名單涵蓋**：冠詞、連接詞、介系詞、助動詞、代名詞、疑問詞、高頻動詞（said/go/get 等）。

### `extractCapitalizedNames(text)`

提取首字母大寫的專有名詞（人名、地名）。

```
輸入：段落全文
  │
  ├─ Regex /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/
  │   匹配單字名（Mrs）或雙字名（Harry Potter）
  ├─ 排除代詞與冠詞：The / This / That / It / He / She / They
  ├─ 去重（Set）
  └─ 取前 5 個

輸出：string[]（原始大小寫）
```

---

## 四種字卡的生成邏輯

### 詞彙卡（`mockVocab`）

```
extractLongWords → 取前 4 個單字
extractSentences → 作為例句來源

for each word (最多 4 張)：
  word        = 長單字（小寫）
  definition  = 【模擬】固定提示文字
  example     = sentences[i % sentences.length]
                （循環取句，若無句子則取文本前 100 字）
```

**邊界情況**：若段落中沒有 ≥7 字母的非常用單字，回傳空陣列。

---

### 克漏字卡（`mockCloze`）

```
extractSentences → 取前 2 句

for each sentence (最多 2 張)：
  ① 切詞，過濾出長度 ≥ 5 的單字
  ② 選中間那個單字（index = Math.floor(words.length / 2)）
     → fallback：第一個長單字 → 字串 'word'
  ③ 清除標點（replace /[^a-zA-Z]/g → ''）
  ④ 在原句中替換第一個符合位置：sentence.replace(clean, {{c1::clean}})
  hint = 【模擬】固定提示
```

**已知限制**：`String.replace` 只替換第一個符合字串，若目標單字在句中出現多次，只有第一次被挖空。

---

### 人物概念卡（`mockCharacter`）

```
extractCapitalizedNames → 取前 2 個名稱
extractSentences        → 尋找首次提及的句子

for each name (最多 2 張)：
  name         = 大寫開頭名稱
  description  = 【模擬】固定提示文字
  firstMention = sentences.find(s => s.includes(name))
                 → fallback：文本前 100 字
```

**邊界情況**：若段落全為小寫（如純對話），回傳空陣列。

---

### 情節問答卡（`mockPlot`）

每個 Chunk 固定產生**恰好 1 張**情節卡。

```
extractSentences → 取前 3 句 join(' ') 作為摘要

question = 【模擬】這個段落（章節名）主要描述了什麼？
           （有 chunk.chapter 時附上章節名）
answer   = 【模擬】重點摘要：前 150 字...（固定提示）
```

---

## 整體呼叫流程

```
generateMockCards(chunk, types)
  │
  ├─ types.includes('vocab')     → mockVocab(chunk)
  ├─ types.includes('cloze')     → mockCloze(chunk)
  ├─ types.includes('character') → mockCharacter(chunk)
  └─ types.includes('plot')      → mockPlot(chunk)

回傳 GeneratedCards（未請求的類型回傳空陣列）
```

---

## 與 API 模式的對照

| 項目 | Mock 模式 | API 模式 |
|------|-----------|---------|
| 詞彙定義 | 固定佔位文字 | Claude 生成繁中定義 |
| 克漏字選詞 | 取句子中間的長單字 | Claude 選擇關鍵片語 |
| 人物描述 | 固定佔位文字 | Claude 根據上下文描述 |
| 情節摘要 | 前三句拼接 | Claude 理解後生成問答 |
| 速度 | 同步，毫秒級 | 非同步，需等待 API |
| 費用 | 免費 | 依 token 計費 |
| 適用場景 | 流程驗證、開發除錯 | 正式產出 |
