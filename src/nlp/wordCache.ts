import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// word-dict.json：使用者精選，跨書共用，以純字串儲存方便手動編輯
type DictData = Record<string, string>;

// word-cache.json：MW 自動快取，可拋棄重建
interface CacheEntry { def: string; source: string; }
type CacheData = Record<string, CacheEntry>;

// word-cache-zh.json：中文翻譯快取，可拋棄重建
export interface CacheZhEntry {
  zh: string;
  source: string;
  example?: string;
  word_zh?: string;        // 單字直接中文對應（e.g. bridge → 橋樑）
  word_zh_source?: string; // 填入來源（deepl / azure / ...）
}
type CacheZhData = Record<string, CacheZhEntry>;

// sentence-cache.json：例句中文翻譯快取，key = FNV-1a 雜湊（8 字元 hex）
export interface SentenceCacheEntry { en: string; zh: string; source: string; }
type SentenceCacheData = Record<string, SentenceCacheEntry>;

// 例句 source 優先序（空/舊條目 = 0 < cache = 1 < API 翻譯 = 2 < 人工 csv = 3）
const SENTENCE_SOURCE_PRIORITY: Record<string, number> = {
  '': 0, 'cache': 1, 'deepl': 2, 'google': 2, 'azure': 2, 'claude': 2, 'chatgpt': 2, 'csv': 3,
};

// phrase-cache.json：MW 片語定義快取（命中與 no-def 均存，避免重複查詢）
interface PhraseCacheEntry { def: string; source: string; }
type PhraseCacheData = Record<string, PhraseCacheEntry>;

// wsd-cache.json：WSD 詞義消歧快取，key = word:pos::fnv1a(sentence)
// shortdefs 本體移至 wsd-shortdefs.db（SQLite），此處只存 hash 供失效偵測
interface WsdCacheEntry {
  chosenIndex: number;
  score: number;
  shortdefsHash: string; // fnv1a(shortdefs.join('|'))，MW 改版時自動失效
}
type WsdCacheData = Record<string, WsdCacheEntry>;

export type CacheTier = 'dict' | 'cache';

/** FNV-1a 32-bit hash → 8-char hex（效能優先，不用於密碼學） */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class WordCacheManager {
  private readonly dictPath: string;
  private readonly cachePath: string;
  private readonly cacheZhPath: string;
  private readonly sentenceCachePath: string;
  private readonly phraseCachePath: string;
  private readonly wsdCachePath: string;
  private dict: DictData = {};
  private cache: CacheData = {};
  private cacheZh: CacheZhData = {};
  private sentenceCache: SentenceCacheData = {};
  private phraseCache: PhraseCacheData = {};
  private wsdCache: WsdCacheData = {};
  private dictDirty = false;
  private cacheDirty = false;
  private cacheZhDirty = false;
  private sentenceCacheDirty = false;
  private phraseCacheDirty = false;
  private wsdCacheDirty = false;

  constructor(baseDir?: string) {
    const dir = baseDir
      ?? process.env['WORD_CACHE_PATH']
      ?? path.join(os.homedir(), '.novel2anki');
    this.dictPath          = path.join(dir, 'word-dict.json');
    this.cachePath         = path.join(dir, 'word-cache.json');
    this.cacheZhPath       = path.join(dir, 'word-cache-zh.json');
    this.sentenceCachePath = path.join(dir, 'sentence-cache.json');
    this.phraseCachePath   = path.join(dir, 'phrase-cache.json');
    this.wsdCachePath      = path.join(dir, 'wsd-cache.json');
    this.dict          = this.loadDict();
    this.cache         = this.loadCache();
    this.cacheZh       = this.loadCacheZh();
    this.sentenceCache = this.loadSentenceCache();
    this.phraseCache   = this.loadPhraseCache();
    this.wsdCache      = this.loadWsdCache();
  }

  private key(word: string, pos?: string | null): string {
    const w = word.toLowerCase().trim();
    return pos ? `${w}:${pos.toLowerCase().trim()}` : w;
  }

  /** 查找順序：word-dict（精確） → word-dict（無 POS） → word-cache（精確） → word-cache（無 POS） */
  get(word: string, pos?: string | null): { def: string; tier: CacheTier } | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);

    if (this.dict[exact]) return { def: this.dict[exact], tier: 'dict' };
    if (this.dict[base])  return { def: this.dict[base],  tier: 'dict' };
    if (this.cache[exact]) return { def: this.cache[exact].def, tier: 'cache' };
    if (this.cache[base])  return { def: this.cache[base].def,  tier: 'cache' };
    return null;
  }

  /** 寫入自動快取（in-memory，呼叫 flush() 才落盤） */
  setCache(word: string, pos: string | null | undefined, def: string, source: string): void {
    this.cache[this.key(word, pos)] = { def, source };
    this.cacheDirty = true;
  }

  /** 寫入使用者精選字典（in-memory，呼叫 flush() 才落盤） */
  setDict(word: string, pos: string | null | undefined, def: string): void {
    this.dict[this.key(word, pos)] = def;
    this.dictDirty = true;
  }

  /** 查找英文定義來源（dict → 'dict'；cache → 儲存的 source 字串，統一小寫） */
  getEnSource(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    if (this.dict[exact] || this.dict[base]) return 'dict';
    const src = this.cache[exact]?.source ?? this.cache[base]?.source ?? null;
    if (!src) return null;
    return src.toLowerCase() === 'mw' ? 'mw' : src.toLowerCase();
  }

  /** 查找中文翻譯快取：精確 word:pos → fallback word，回傳 zh 字串 */
  getChinese(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.cacheZh[exact]?.zh ?? this.cacheZh[base]?.zh ?? null;
  }

  /** 查找中文翻譯來源（快取中儲存的原始 source，如 'deepl'/'azure'） */
  getChineseSource(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.cacheZh[exact]?.source ?? this.cacheZh[base]?.source ?? null;
  }

  /** 精確比對 word:pos 是否已有中文翻譯（不走 fallback） */
  hasChinese(word: string, pos: string | null): boolean {
    return !!this.cacheZh[this.key(word, pos)];
  }

  /** 是否有任何 POS-specific cache（word:pos）條目，不含 dict（供 prefetch skip 判斷） */
  hasPosCache(word: string): boolean {
    const w = word.toLowerCase().trim();
    return Object.keys(this.cache).some(k => k.startsWith(`${w}:`));
  }

  /** 刪除所有 POS-specific 英文快取（word:pos），保留 base key（word）。回傳刪除筆數。 */
  clearPosCache(): number {
    let count = 0;
    for (const k of Object.keys(this.cache)) {
      if (k.includes(':')) {
        delete this.cache[k];
        count++;
        this.cacheDirty = true;
      }
    }
    return count;
  }

  /** 刪除所有 POS-specific 中文快取（word:pos），保留 base key（word）。回傳刪除筆數。 */
  clearPosCacheZh(): number {
    let count = 0;
    for (const k of Object.keys(this.cacheZh)) {
      if (k.includes(':')) {
        delete this.cacheZh[k];
        count++;
        this.cacheZhDirty = true;
      }
    }
    return count;
  }

  /** 刪除所有 base 中文快取（word，無 POS），保留 POS key（word:pos）。回傳刪除筆數。 */
  clearBaseZhCache(): number {
    let count = 0;
    for (const k of Object.keys(this.cacheZh)) {
      if (!k.includes(':')) {
        delete this.cacheZh[k];
        count++;
        this.cacheZhDirty = true;
      }
    }
    return count;
  }

  /** 寫入中文翻譯快取（in-memory，呼叫 flush() 才落盤） */
  setChinese(word: string, pos: string | null | undefined, zh: string, source: string): void {
    this.cacheZh[this.key(word, pos)] = { zh, source };
    this.cacheZhDirty = true;
  }

  /** 查找 word_zh（單字直接中文）：精確 word:pos → fallback word */
  getWordZh(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.cacheZh[exact]?.word_zh ?? this.cacheZh[base]?.word_zh ?? null;
  }

  /** 查找 word_zh 的來源 */
  getWordZhSource(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.cacheZh[exact]?.word_zh_source ?? this.cacheZh[base]?.word_zh_source ?? null;
  }

  /** word_zh 強制覆寫（不論是否已有值），回傳是否實際變更 */
  setWordZh(word: string, pos: string | null | undefined, zh: string, source: string): boolean {
    const k = this.key(word, pos);
    const entry = this.cacheZh[k];
    if (entry) {
      const changed = entry.word_zh !== zh || entry.word_zh_source !== source;
      entry.word_zh = zh;
      entry.word_zh_source = source;
      if (changed) this.cacheZhDirty = true;
      return changed;
    }
    this.cacheZh[k] = { zh: '', source: '', word_zh: zh, word_zh_source: source };
    this.cacheZhDirty = true;
    return true;
  }

  /** word_zh 尚無值才寫入，回傳是否實際寫入 */
  setWordZhIfEmpty(word: string, pos: string | null | undefined, zh: string, source: string): boolean {
    const k = this.key(word, pos);
    const entry = this.cacheZh[k];
    if (entry?.word_zh) return false;
    if (entry) {
      entry.word_zh = zh;
      entry.word_zh_source = source;
    } else {
      this.cacheZh[k] = { zh: '', source: '', word_zh: zh, word_zh_source: source };
    }
    this.cacheZhDirty = true;
    return true;
  }

  /** 枚舉一個詞在 word-cache / word-dict 中所有 POS 條目（含無 POS 預設） */
  getAllCacheEntriesForWord(word: string): Array<{ pos: string | null; def: string }> {
    const w = word.toLowerCase().trim();
    const results: Array<{ pos: string | null; def: string }> = [];
    const seen = new Set<string | null>();

    const addEntry = (pos: string | null, def: string) => {
      if (!seen.has(pos)) { seen.add(pos); results.push({ pos, def }); }
    };

    // dict 優先
    for (const k of Object.keys(this.dict)) {
      if (k === w) { addEntry(null, this.dict[k]); continue; }
      if (k.startsWith(`${w}:`)) { addEntry(k.slice(w.length + 1), this.dict[k]); }
    }
    // cache 補充
    for (const k of Object.keys(this.cache)) {
      if (k === w) { addEntry(null, this.cache[k].def); continue; }
      if (k.startsWith(`${w}:`)) { addEntry(k.slice(w.length + 1), this.cache[k].def); }
    }

    return results;
  }

  /** 查找例句中文翻譯（以英文句子為 key，hash 查找） */
  getSentenceZh(en: string): string | null {
    return this.sentenceCache[fnv1a(en)]?.zh ?? null;
  }

  /** 查找例句翻譯來源（快取中儲存的原始 source，如 'deepl'/'azure'） */
  getSentenceZhSource(en: string): string | null {
    return this.sentenceCache[fnv1a(en)]?.source ?? null;
  }

  /**
   * 寫入例句中文翻譯快取（in-memory，呼叫 flush() 才落盤）。
   * 依 source 優先序保護：新來源優先序必須嚴格高於現有來源才覆蓋；
   * 現有 source = '' 時（舊條目或未知來源）無條件允許覆蓋。
   * 回傳 true 表示實際寫入，false 表示因優先序略過。
   */
  setSentenceZh(en: string, zh: string, source: string): boolean {
    const hash = fnv1a(en);
    const existing = this.sentenceCache[hash];
    const existingPriority = SENTENCE_SOURCE_PRIORITY[existing?.source ?? ''] ?? 0;
    const newPriority      = SENTENCE_SOURCE_PRIORITY[source] ?? 0;
    if (existing && existingPriority !== 0 && newPriority <= existingPriority) return false;
    this.sentenceCache[hash] = { en, zh, source };
    this.sentenceCacheDirty = true;
    return true;
  }

  /** 強制覆寫例句中文翻譯快取，不做優先序檢查。回傳 true 表示值有變動。 */
  setSentenceZhForce(en: string, zh: string, source: string): boolean {
    const hash = fnv1a(en);
    const existing = this.sentenceCache[hash];
    const changed = !existing || existing.zh !== zh || existing.source !== source;
    if (changed) {
      this.sentenceCache[hash] = { en, zh, source };
      this.sentenceCacheDirty = true;
    }
    return changed;
  }

  /** 查詢片語 MW 定義；回傳 null 表示尚未查過，回傳空字串表示 MW 無此片語 */
  getPhrase(phrase: string): string | null {
    return this.phraseCache[phrase.toLowerCase().trim()]?.def ?? null;
  }

  /** 寫入片語快取（MW 命中填 def；no-def 填空字串）（in-memory，呼叫 flush() 才落盤） */
  setPhrase(phrase: string, def: string, source: string): void {
    this.phraseCache[phrase.toLowerCase().trim()] = { def, source };
    this.phraseCacheDirty = true;
  }

  /** 是否已查過此片語（不論 MW 有無結果） */
  hasPhrase(phrase: string): boolean {
    return phrase.toLowerCase().trim() in this.phraseCache;
  }

  /** WSD 快取 key：word:pos::fnv1a(sentence)（空 pos 用 'unknown'） */
  private wsdKey(word: string, pos: string | null, sentence: string): string {
    const w   = word.toLowerCase().trim();
    const p   = (pos ?? 'unknown').toLowerCase().trim();
    return `${w}:${p}::${fnv1a(sentence)}`;
  }

  /**
   * 查找 WSD 快取。shortdefsHash 不符代表 MW 已更新候選詞義，視為失效。
   * 回傳 null 表示未快取或快取失效。
   */
  getWsd(word: string, pos: string | null, sentence: string, currentShortdefsHash: string): { chosenIndex: number; score: number } | null {
    const entry = this.wsdCache[this.wsdKey(word, pos, sentence)];
    if (!entry) return null;
    // score === 0 為舊版 fallback 殘留，視為失效讓 WSD 重跑
    if (entry.score === 0) return null;
    // hash 不符 → MW 已更新 shortdefs，重跑 WSD
    if (entry.shortdefsHash !== currentShortdefsHash) return null;
    return { chosenIndex: entry.chosenIndex, score: entry.score };
  }

  /** 寫入 WSD 快取（in-memory，呼叫 flush() 才落盤） */
  setWsd(word: string, pos: string | null, sentence: string, chosenIndex: number, score: number, shortdefsHash: string): void {
    this.wsdCache[this.wsdKey(word, pos, sentence)] = { chosenIndex, score, shortdefsHash };
    this.wsdCacheDirty = true;
  }

  get wsdCacheSize(): number { return Object.keys(this.wsdCache).length; }
  get wsdCacheFilePath(): string { return this.wsdCachePath; }

  /** 將 in-memory 的修改批次寫盤（dirty flag 保護，避免無謂 I/O） */
  flush(): void {
    if (this.cacheDirty)         { this.saveJson(this.cachePath,         this.cache);         this.cacheDirty         = false; }
    if (this.dictDirty)          { this.saveJson(this.dictPath,          this.dict);          this.dictDirty          = false; }
    if (this.cacheZhDirty)       { this.saveJson(this.cacheZhPath,       this.cacheZh);       this.cacheZhDirty       = false; }
    if (this.sentenceCacheDirty) { this.saveJson(this.sentenceCachePath, this.sentenceCache); this.sentenceCacheDirty = false; }
    if (this.phraseCacheDirty)   { this.saveJson(this.phraseCachePath,   this.phraseCache);   this.phraseCacheDirty   = false; }
    if (this.wsdCacheDirty)      { this.saveJson(this.wsdCachePath,      this.wsdCache);      this.wsdCacheDirty      = false; }
  }

  get dictSize():          number { return Object.keys(this.dict).length;          }
  get cacheSize():         number { return Object.keys(this.cache).length;         }
  get cacheZhSize():       number { return Object.keys(this.cacheZh).length;       }
  get sentenceCacheSize(): number { return Object.keys(this.sentenceCache).length; }
  get phraseCacheSize():   number { return Object.keys(this.phraseCache).length;   }

  get dictFilePath():          string { return this.dictPath;          }
  get cacheFilePath():         string { return this.cachePath;         }
  get cacheZhFilePath():       string { return this.cacheZhPath;       }
  get sentenceCacheFilePath(): string { return this.sentenceCachePath; }
  get phraseCacheFilePath():   string { return this.phraseCachePath;   }
  get cacheDir():              string { return path.dirname(this.cachePath); }

  private loadDict(): DictData {
    try {
      if (fs.existsSync(this.dictPath)) return JSON.parse(fs.readFileSync(this.dictPath, 'utf-8')) as DictData;
    } catch { /* 損壞時從空白開始 */ }
    return {};
  }

  private loadCache(): CacheData {
    try {
      if (fs.existsSync(this.cachePath)) return JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as CacheData;
    } catch {}
    return {};
  }

  private loadCacheZh(): CacheZhData {
    try {
      if (!fs.existsSync(this.cacheZhPath)) return {};
      const raw = JSON.parse(fs.readFileSync(this.cacheZhPath, 'utf-8')) as Record<string, unknown>;
      const result: CacheZhData = {};
      for (const [k, v] of Object.entries(raw)) {
        // 舊格式：純字串 → 自動升級，source 標記為 'legacy'
        if (typeof v === 'string') { result[k] = { zh: v, source: 'legacy' }; }
        else { result[k] = v as CacheZhEntry; }
      }
      return result;
    } catch {}
    return {};
  }

  private loadSentenceCache(): SentenceCacheData {
    try {
      if (fs.existsSync(this.sentenceCachePath)) {
        const raw = JSON.parse(fs.readFileSync(this.sentenceCachePath, 'utf-8')) as
          Record<string, { en: string; zh: string; source?: string }>;
        const normalized: SentenceCacheData = {};
        for (const [k, v] of Object.entries(raw)) {
          normalized[k] = { en: v.en, zh: v.zh, source: v.source ?? '' };
        }
        return normalized;
      }
    } catch {}
    return {};
  }

  private loadPhraseCache(): PhraseCacheData {
    try {
      if (fs.existsSync(this.phraseCachePath))
        return JSON.parse(fs.readFileSync(this.phraseCachePath, 'utf-8')) as PhraseCacheData;
    } catch {}
    return {};
  }

  private loadWsdCache(): WsdCacheData {
    try {
      if (fs.existsSync(this.wsdCachePath))
        return JSON.parse(fs.readFileSync(this.wsdCachePath, 'utf-8')) as WsdCacheData;
    } catch {}
    return {};
  }

  private saveJson(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}

let _instance: WordCacheManager | null = null;

/** 模組層級 singleton，整個 session 共用同一實例 */
export function getWordCache(): WordCacheManager {
  if (!_instance) _instance = new WordCacheManager();
  return _instance;
}

// ── domain / book 定義翻譯分層快取 ───────────────────────────────────────────

/** domain 或 book 專屬的雙語定義快取：
 *  - zh 檔：`{type}_{name}_cache_zh.json`，結構同 word-cache-zh.json（CacheZhEntry）
 *  - en 檔：`{type}_{name}_cache.json`，結構同 word-cache.json（CacheEntry）
 *  - 存放於 global cache 同目錄
 *  - setIfEmpty / setEnIfEmpty：已有值則不覆寫（由呼叫方負責冪等寫回）
 */
export class DefinitionLayerCache {
  private readonly zhData: Record<string, CacheZhEntry> = {};
  private readonly enData: Record<string, CacheEntry>   = {};
  private zhDirty = false;
  private enDirty = false;
  readonly filePath: string;    // zh 快取路徑（domain_{name}_cache_zh.json）
  readonly enFilePath: string;  // en 快取路徑（domain_{name}_cache.json）

  constructor(cacheDir: string, type: 'domain' | 'book', name: string) {
    this.filePath   = path.join(cacheDir, `${type}_${name}_cache_zh.json`);
    this.enFilePath = path.join(cacheDir, `${type}_${name}_cache.json`);
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>;
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'string') {
            this.zhData[k] = { zh: v, source: 'legacy' };  // 向下相容舊格式
          } else if (v && typeof v === 'object' && 'zh' in v) {
            this.zhData[k] = v as CacheZhEntry;
          }
        }
      }
    } catch { /* 損壞時從空白開始 */ }
    try {
      if (fs.existsSync(this.enFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.enFilePath, 'utf-8')) as Record<string, unknown>;
        for (const [k, v] of Object.entries(raw)) {
          if (v && typeof v === 'object' && 'def' in v) {
            this.enData[k] = v as CacheEntry;
          }
        }
      }
    } catch { /* 損壞時從空白開始 */ }
  }

  private key(word: string, pos?: string | null): string {
    const w = word.toLowerCase().trim();
    return pos ? `${w}:${pos.toLowerCase().trim()}` : w;
  }

  get(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.zhData[exact]?.zh ?? this.zhData[base]?.zh ?? null;
  }

  /** 查找中文翻譯來源（快取中儲存的原始 source，如 'deepl'/'azure'） */
  getSource(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.zhData[exact]?.source ?? this.zhData[base]?.source ?? null;
  }

  /** 若 key 尚無中文定義則寫入，回傳是否實際寫入 */
  setIfEmpty(word: string, pos: string | null | undefined, zh: string, source = 'csv'): boolean {
    const k = this.key(word, pos);
    if (this.zhData[k]) return false;
    this.zhData[k] = { zh, source };
    this.zhDirty = true;
    return true;
  }

  /** 強制覆寫中文定義（不論是否已有值），回傳是否實際變更 */
  set(word: string, pos: string | null | undefined, zh: string, source = 'csv'): boolean {
    const k = this.key(word, pos);
    const existing = this.zhData[k];
    const changed = !existing || existing.zh !== zh || existing.source !== source;
    if (changed) { this.zhData[k] = { zh, source }; this.zhDirty = true; }
    return changed;
  }

  getEn(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.enData[exact]?.def ?? this.enData[base]?.def ?? null;
  }

  /** 查找英文定義來源（快取中儲存的原始 source，如 'mw'/'free'） */
  getEnSource(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.enData[exact]?.source ?? this.enData[base]?.source ?? null;
  }

  /** 若 key 尚無英文定義則寫入，回傳是否實際寫入 */
  setEnIfEmpty(word: string, pos: string | null | undefined, def: string, source = 'mw'): boolean {
    const k = this.key(word, pos);
    if (this.enData[k]) return false;
    this.enData[k] = { def, source };
    this.enDirty = true;
    return true;
  }

  /** 強制覆寫英文定義（不論是否已有值），回傳是否實際變更 */
  setEn(word: string, pos: string | null | undefined, def: string, source = 'csv'): boolean {
    const k = this.key(word, pos);
    const existing = this.enData[k];
    const changed = !existing || existing.def !== def || existing.source !== source;
    if (changed) { this.enData[k] = { def, source }; this.enDirty = true; }
    return changed;
  }

  flush(): void {
    if (this.zhDirty) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.zhData, null, 2), 'utf-8');
      this.zhDirty = false;
    }
    if (this.enDirty) {
      fs.mkdirSync(path.dirname(this.enFilePath), { recursive: true });
      fs.writeFileSync(this.enFilePath, JSON.stringify(this.enData, null, 2), 'utf-8');
      this.enDirty = false;
    }
  }

  get size(): number   { return Object.keys(this.zhData).length; }
  get enSize(): number { return Object.keys(this.enData).length; }
}
