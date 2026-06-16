import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fnv1a } from './wordCache';

export interface ShortdefEntry {
  fl: string;
  shortdef: string;
}

/**
 * MW shortdefs 的 SQLite 快取。
 * Key = word（小寫，不含 POS）— 一次查詢取回所有 POS 的 shortdefs，
 * 排序由呼叫端依 targetPOS 決定，此處只負責存取。
 */
export class WsdShortdefsDb {
  private readonly db: Database.Database;
  private readonly stmtGet:    Database.Statement;
  private readonly stmtUpsert: Database.Statement;

  constructor(baseDir?: string) {
    const dir = baseDir ?? process.env['WORD_CACHE_PATH'] ?? path.join(os.homedir(), '.novel2anki');
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(path.join(dir, 'wsd-shortdefs.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shortdefs (
        word       TEXT PRIMARY KEY,
        entries    TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      )
    `);

    this.stmtGet    = this.db.prepare('SELECT entries FROM shortdefs WHERE word = ?');
    this.stmtUpsert = this.db.prepare(
      'INSERT OR REPLACE INTO shortdefs (word, entries, fetched_at) VALUES (?, ?, ?)',
    );
  }

  /** 取得指定單字的所有 shortdef entries；尚未快取時回傳 null */
  get(word: string): ShortdefEntry[] | null {
    const row = this.stmtGet.get(word.toLowerCase().trim()) as { entries: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.entries) as ShortdefEntry[];
  }

  /** 寫入（或更新）單字的 shortdef entries */
  set(word: string, entries: ShortdefEntry[]): void {
    this.stmtUpsert.run(
      word.toLowerCase().trim(),
      JSON.stringify(entries),
      Math.floor(Date.now() / 1000),
    );
  }

  close(): void {
    this.db.close();
  }
}

/** 計算 shortdef entries 的 hash（用於 wsd-cache 失效偵測） */
export function hashShortdefs(entries: ShortdefEntry[]): string {
  return fnv1a(entries.map(e => e.shortdef).join('|'));
}

let _instance: WsdShortdefsDb | null = null;

export function getWsdShortdefsDb(): WsdShortdefsDb {
  if (!_instance) _instance = new WsdShortdefsDb();
  return _instance;
}
