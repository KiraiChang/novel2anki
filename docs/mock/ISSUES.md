# Mock 模式已知限制

> 對應原始碼：`src/cards/mockGenerator.ts`

---

## 克漏字卡

### `String.replace` 只替換第一個符合位置
**位置**：`mockCloze`，`sentence.replace(clean, '{{c1::clean}}')`  
目標單字在句中若出現多次，只有第一個被挖空，後續出現保持原樣，造成答案外洩。  
例：`"He said what he meant"` 選到 `he`，只有第一個 `he` 變成填空，第二個仍可見。

### 目標單字選取位置固定
**位置**：`mockCloze`，`words[Math.floor(words.length / 2)]`  
固定選句子中間的長單字，不考慮語義重要性，可能選到連接詞或副詞而非關鍵名詞／動詞。

### 標點清除可能產生空字串
**位置**：`mockCloze`，`target.replace(/[^a-zA-Z]/g, '')`  
若過濾後 `clean` 為空字串，`sentence.replace('', ...)` 會在句首插入填空標記，產生格式錯誤的卡片。

---

## 詞彙卡

### 長度啟發式選詞品質低
**位置**：`extractLongWords`，`/\b[a-z]{7,}\b/`  
以字母數 ≥ 7 作為「有學習價值」的唯一判斷依據，會選到 `thought`、`through`、`something` 等常見長字，COMMON_WORDS 黑名單無法窮舉所有高頻長詞。

### 定義為固定佔位文字
所有詞彙卡的 `definition_zh` 均為固定字串，無實際學習價值，僅用於確認資料結構正確。

### 例句循環取用可能重複
**位置**：`mockVocab`，`sentences[i % sentences.length]`  
當句子數量少於單字數量時，同一句子會被多張卡片重複使用。

---

## 人物概念卡

### 大寫開頭不等於專有名詞
**位置**：`extractCapitalizedNames`，`/\b[A-Z][a-z]{2,}\b/`  
句首的普通單字（如 `The`、`After`、`During`）亦符合 Regex，雖有部分排除清單，但清單不完整，仍會產生誤判的「人物卡」。

### 排除清單過於簡陋
**位置**：`extractCapitalizedNames`，hardcoded 7 個詞  
僅排除 `The / This / That / It / He / She / They`，大量其他句首詞（`But`、`When`、`Now` 等）未涵蓋。

---

## 情節問答卡

### 每個 Chunk 固定產生恰好 1 張
**位置**：`mockPlot`  
不論段落長短或內容複雜度，一律回傳單張固定問答，問題永遠是「這個段落主要描述了什麼？」，無法反映多重情節。

### 摘要來源只取前三句
**位置**：`mockPlot`，`sentences.slice(0, 3).join(' ')`  
若段落重點在中後段，摘要會遺漏關鍵內容；且三句拼接後截為 150 字，可能在句子中間截斷。

---

## 通用

### 無情境理解
所有提取邏輯皆為純文字規則，不理解語義。相同長度的單字、相同大小寫規則的名稱，對 Mock 模式而言無從區分重要性。

### 多 Chunk 間無去重
相同單字、相同名稱若在不同段落重複出現，Mock 模式會對每個 Chunk 各自產生一張卡，累積大量重複內容。
