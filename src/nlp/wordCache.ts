import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// word-dict.json：使用者精選，跨書共用，以純字串儲存方便手動編輯
type DictData = Record<string, string>;

// word-cache.json：MW 自動快取，可拋棄重建
interface CacheEntry { def: string; source: string; }
type CacheData = Record<string, CacheEntry>;

export type CacheTier = 'dict' | 'cache';

export class WordCacheManager {
  private readonly dictPath: string;
  private readonly cachePath: string;
  private dict: DictData = {};
  private cache: CacheData = {};
  private dictDirty = false;
  private cacheDirty = false;

  constructor(baseDir?: string) {
    const dir = baseDir
      ?? process.env['WORD_CACHE_PATH']
      ?? path.join(os.homedir(), '.novel2anki');
    this.dictPath  = path.join(dir, 'word-dict.json');
    this.cachePath = path.join(dir, 'word-cache.json');
    this.dict  = this.loadDict();
    this.cache = this.loadCache();
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

  /** 將 in-memory 的修改批次寫盤（dirty flag 保護，避免無謂 I/O） */
  flush(): void {
    if (this.cacheDirty) { this.saveJson(this.cachePath, this.cache); this.cacheDirty = false; }
    if (this.dictDirty)  { this.saveJson(this.dictPath,  this.dict);  this.dictDirty  = false; }
  }

  get dictSize():  number { return Object.keys(this.dict).length;  }
  get cacheSize(): number { return Object.keys(this.cache).length; }

  get dictFilePath():  string { return this.dictPath;  }
  get cacheFilePath(): string { return this.cachePath; }

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
