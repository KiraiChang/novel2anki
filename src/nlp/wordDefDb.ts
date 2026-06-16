import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fnv1a } from './wordCache';

export interface WordDefEntry {
  en:     string;
  zh:     string;
  source: string;
}

function makeKey(word: string, pos: string, en: string): string {
  return `${word.toLowerCase().trim()}:${pos.toLowerCase().trim()}::${fnv1a(en.trim())}`;
}

export class WordDefDb {
  private readonly db: Database.Database;
  private readonly stmtGet:          Database.Statement;
  private readonly stmtInsertIgnore: Database.Statement;
  private readonly stmtUpdateZh:     Database.Statement;

  constructor(baseDir?: string) {
    const dir = baseDir ?? process.env['WORD_CACHE_PATH'] ?? path.join(os.homedir(), '.novel2anki');
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(path.join(dir, 'word-def.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS defs (
        key    TEXT PRIMARY KEY,
        en     TEXT NOT NULL,
        zh     TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT ''
      )
    `);

    // 既有 DB 可能缺 source 欄，嘗試新增（已存在則靜默忽略）
    try {
      this.db.exec("ALTER TABLE defs ADD COLUMN source TEXT NOT NULL DEFAULT ''");
    } catch { /* already exists */ }

    this.stmtGet          = this.db.prepare('SELECT en, zh, source FROM defs WHERE key = ?');
    this.stmtInsertIgnore = this.db.prepare(
      'INSERT OR IGNORE INTO defs (key, en, zh, source) VALUES (?, ?, ?, ?)',
    );
    this.stmtUpdateZh     = this.db.prepare(
      "UPDATE defs SET zh = ?, source = ? WHERE key = ? AND zh = ''",
    );
  }

  get(word: string, pos: string, en: string): WordDefEntry | null {
    const row = this.stmtGet.get(makeKey(word, pos, en)) as WordDefEntry | undefined;
    return row ?? null;
  }

  /** 僅在 key 不存在時插入，已有的不覆蓋 */
  set(word: string, pos: string, en: string, zh: string, source: string): boolean {
    const info = this.stmtInsertIgnore.run(makeKey(word, pos, en), en.trim(), zh.trim(), source.trim());
    return info.changes > 0;
  }

  /** 僅在 zh 為空時補填中文翻譯與來源 */
  setZhIfEmpty(word: string, pos: string, en: string, zh: string, source: string): boolean {
    const info = this.stmtUpdateZh.run(zh.trim(), source.trim(), makeKey(word, pos, en));
    return info.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

let _instance: WordDefDb | null = null;

export function getWordDefDb(): WordDefDb {
  if (!_instance) _instance = new WordDefDb();
  return _instance;
}
