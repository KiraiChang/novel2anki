import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// word-dict.json：使用者精選，跨書共用，以純字串儲存方便手動編輯
type DictData = Record<string, string>;

// word-cache.json：MW 自動快取，可拋棄重建
interface CacheEntry { def: string; source: string; }
type CacheData = Record<string, CacheEntry>;

// word-cache-zh.json：中文翻譯快取，可拋棄重建
export interface CacheZhEntry { zh: string; source: string; example?: string; }
type CacheZhData = Record<string, CacheZhEntry>;

// sentence-cache.json：例句中文翻譯快取，key = FNV-1a 雜湊（8 字元 hex）
export interface SentenceCacheEntry { en: string; zh: string; }
type SentenceCacheData = Record<string, SentenceCacheEntry>;

export type CacheTier = 'dict' | 'cache';

/** FNV-1a 32-bit hash → 8-char hex（效能優先，不用於密碼學） */
function fnv1a(str: string): string {
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
  private dict: DictData = {};
  private cache: CacheData = {};
  private cacheZh: CacheZhData = {};
  private sentenceCache: SentenceCacheData = {};
  private dictDirty = false;
  private cacheDirty = false;
  private cacheZhDirty = false;
  private sentenceCacheDirty = false;

  constructor(baseDir?: string) {
    const dir = baseDir
      ?? process.env['WORD_CACHE_PATH']
      ?? path.join(os.homedir(), '.novel2anki');
    this.dictPath          = path.join(dir, 'word-dict.json');
    this.cachePath         = path.join(dir, 'word-cache.json');
    this.cacheZhPath       = path.join(dir, 'word-cache-zh.json');
    this.sentenceCachePath = path.join(dir, 'sentence-cache.json');
    this.dict          = this.loadDict();
    this.cache         = this.loadCache();
    this.cacheZh       = this.loadCacheZh();
    this.sentenceCache = this.loadSentenceCache();
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

  /** 查找中文翻譯快取：精確 word:pos → fallback word，回傳 zh 字串 */
  getChinese(word: string, pos?: string | null): string | null {
    const exact = this.key(word, pos);
    const base  = this.key(word);
    return this.cacheZh[exact]?.zh ?? this.cacheZh[base]?.zh ?? null;
  }

  /** 精確比對 word:pos 是否已有中文翻譯（不走 fallback） */
  hasChinese(word: string, pos: string | null): boolean {
    return !!this.cacheZh[this.key(word, pos)];
  }

  /** 寫入中文翻譯快取（in-memory，呼叫 flush() 才落盤） */
  setChinese(word: string, pos: string | null | undefined, zh: string, source: string): void {
    this.cacheZh[this.key(word, pos)] = { zh, source };
    this.cacheZhDirty = true;
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

  /** 寫入例句中文翻譯快取（in-memory，呼叫 flush() 才落盤） */
  setSentenceZh(en: string, zh: string): void {
    this.sentenceCache[fnv1a(en)] = { en, zh };
    this.sentenceCacheDirty = true;
  }

  /** 將 in-memory 的修改批次寫盤（dirty flag 保護，避免無謂 I/O） */
  flush(): void {
    if (this.cacheDirty)         { this.saveJson(this.cachePath,         this.cache);         this.cacheDirty         = false; }
    if (this.dictDirty)          { this.saveJson(this.dictPath,          this.dict);          this.dictDirty          = false; }
    if (this.cacheZhDirty)       { this.saveJson(this.cacheZhPath,       this.cacheZh);       this.cacheZhDirty       = false; }
    if (this.sentenceCacheDirty) { this.saveJson(this.sentenceCachePath, this.sentenceCache); this.sentenceCacheDirty = false; }
  }

  get dictSize():          number { return Object.keys(this.dict).length;          }
  get cacheSize():         number { return Object.keys(this.cache).length;         }
  get cacheZhSize():       number { return Object.keys(this.cacheZh).length;       }
  get sentenceCacheSize(): number { return Object.keys(this.sentenceCache).length; }

  get dictFilePath():          string { return this.dictPath;          }
  get cacheFilePath():         string { return this.cachePath;         }
  get cacheZhFilePath():       string { return this.cacheZhPath;       }
  get sentenceCacheFilePath(): string { return this.sentenceCachePath; }

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
      if (fs.existsSync(this.sentenceCachePath))
        return JSON.parse(fs.readFileSync(this.sentenceCachePath, 'utf-8')) as SentenceCacheData;
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
