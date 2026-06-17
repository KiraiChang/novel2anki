import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class WordAudioDb {
  private readonly db: Database.Database;
  private readonly stmtGet:         Database.Statement;
  private readonly stmtInsertIgnore: Database.Statement;

  constructor(baseDir?: string) {
    const dir = baseDir ?? process.env['WORD_CACHE_PATH'] ?? path.join(os.homedir(), '.novel2anki');
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(path.join(dir, 'word-audio.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pronunciations (
        word       TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      )
    `);

    this.stmtGet          = this.db.prepare('SELECT url FROM pronunciations WHERE word = ?');
    this.stmtInsertIgnore = this.db.prepare(
      'INSERT OR IGNORE INTO pronunciations (word, url, fetched_at) VALUES (?, ?, ?)',
    );
  }

  get(word: string): string | null {
    const row = this.stmtGet.get(word.toLowerCase().trim()) as { url: string } | undefined;
    return row?.url ?? null;
  }

  /** 僅在 word 尚未存在時寫入；已有的不覆蓋 */
  set(word: string, url: string): void {
    this.stmtInsertIgnore.run(word.toLowerCase().trim(), url, Math.floor(Date.now() / 1000));
  }

  close(): void {
    this.db.close();
  }
}

let _instance: WordAudioDb | null = null;

export function getWordAudioDb(): WordAudioDb {
  if (!_instance) _instance = new WordAudioDb();
  return _instance;
}
