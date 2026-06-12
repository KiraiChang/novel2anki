#!/usr/bin/env node
/**
 * 將 output/missing-cefr-words.json 回填至 word-cache.json 與 word-cache-zh.json
 *
 * 規則：
 *   - definition_en  非空 → 寫入 word-cache.json   base key（word）
 *   - definition_zh  非空 → 更新 word-cache-zh.json base key 的 zh / source 欄位
 *   - word_zh        非空 → 更新 word-cache-zh.json base key 的 word_zh 欄位
 *   - 空白欄位不異動既有快取
 *
 * 環境變數：
 *   WORD_CACHE_PATH  快取目錄（相對於專案根目錄），預設 ../booking/CEFR/
 */

'use strict';
const path = require('path');
const fs   = require('fs');

// ── 路徑解析 ──────────────────────────────────────────────────────────────────
const projectRoot = path.resolve(__dirname, '..');
const cachePath   = process.env.WORD_CACHE_PATH
  ? path.resolve(projectRoot, process.env.WORD_CACHE_PATH)
  : path.resolve(projectRoot, '../booking/CEFR/');

const missingPath = path.join(projectRoot, 'output', 'missing-cefr-words.json');
const enCachePath = path.join(cachePath, 'word-cache.json');
const zhCachePath = path.join(cachePath, 'word-cache-zh.json');

// ── 讀檔 ──────────────────────────────────────────────────────────────────────
for (const p of [missingPath, enCachePath, zhCachePath]) {
  if (!fs.existsSync(p)) {
    console.error(`錯誤：找不到檔案 ${p}`);
    process.exit(1);
  }
}

const missing = JSON.parse(fs.readFileSync(missingPath, 'utf-8'));
const enCache = JSON.parse(fs.readFileSync(enCachePath, 'utf-8'));
const zhCache = JSON.parse(fs.readFileSync(zhCachePath, 'utf-8'));

// ── 回填 ──────────────────────────────────────────────────────────────────────
let enUpdated = 0;
let zhDefUpdated = 0;
let wordZhUpdated = 0;

for (const entry of missing.words) {
  const { word, definition_en, definition_zh, word_zh } = entry;

  // 1. definition_en → word-cache.json base key
  const defEn = (definition_en ?? '').trim();
  if (defEn) {
    enCache[word] = { def: defEn, source: 'manual' };
    enUpdated++;
  }

  // 2. definition_zh / word_zh → word-cache-zh.json base key（合併不覆蓋其他欄位）
  const defZh  = (definition_zh ?? '').trim();
  const wordZh = (word_zh      ?? '').trim();

  if (defZh || wordZh) {
    const existing = { ...(zhCache[word] ?? {}) };

    if (defZh) {
      existing.zh     = defZh;
      existing.source = 'manual';
      zhDefUpdated++;
    }

    if (wordZh) {
      existing.word_zh        = wordZh;
      existing.word_zh_source = 'manual';
      wordZhUpdated++;
    }

    zhCache[word] = existing;
  }
}

// ── 寫回 ──────────────────────────────────────────────────────────────────────
fs.writeFileSync(enCachePath, JSON.stringify(enCache, null, 2), 'utf-8');
fs.writeFileSync(zhCachePath, JSON.stringify(zhCache, null, 2), 'utf-8');

console.log(`✓ word-cache.json    寫入 definition_en：${enUpdated} 筆`);
console.log(`✓ word-cache-zh.json 寫入 definition_zh：${zhDefUpdated} 筆`);
console.log(`✓ word-cache-zh.json 寫入 word_zh：      ${wordZhUpdated} 筆`);
console.log(`  快取路徑：${cachePath}`);
