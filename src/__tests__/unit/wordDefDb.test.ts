import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WordDefDb } from '../../nlp/wordDefDb';
import { fnv1a } from '../../nlp/wordCache';

let tmpDir: string;
let db: WordDefDb;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worddefdb-test-'));
  db = new WordDefDb(tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── get ──────────────────────────────────────────────────────────────────────

describe('get()', () => {
  it('找不到時回傳 null', () => {
    expect(db.get('bank', 'noun', 'a financial institution')).toBeNull();
  });

  it('set 後可取得 entry（含 source）', () => {
    db.set('bank', 'noun', 'a financial institution', '銀行', 'deepl');
    expect(db.get('bank', 'noun', 'a financial institution')).toEqual({
      en: 'a financial institution',
      zh: '銀行',
      source: 'deepl',
    });
  });

  it('key 不同（定義不同）時互不干擾', () => {
    db.set('bank', 'noun', 'a financial institution',        '銀行', 'deepl');
    db.set('bank', 'noun', 'the rising ground beside a river', '河岸', 'deepl');
    expect(db.get('bank', 'noun', 'a financial institution')!.zh).toBe('銀行');
    expect(db.get('bank', 'noun', 'the rising ground beside a river')!.zh).toBe('河岸');
  });
});

// ── set ──────────────────────────────────────────────────────────────────────

describe('set()', () => {
  it('首次插入回傳 true', () => {
    expect(db.set('run', 'verb', 'to move fast', '奔跑', 'deepl')).toBe(true);
  });

  it('key 已存在時跳過並回傳 false，原值不覆蓋', () => {
    db.set('run', 'verb', 'to move fast', '奔跑', 'deepl');
    expect(db.set('run', 'verb', 'to move fast', '跑動', 'azure')).toBe(false);
    const entry = db.get('run', 'verb', 'to move fast')!;
    expect(entry.zh).toBe('奔跑');
    expect(entry.source).toBe('deepl');
  });

  it('word / pos 不分大小寫，以小寫統一', () => {
    db.set('Bank', 'Noun', 'a financial institution', '銀行', 'csv');
    expect(db.get('bank', 'noun', 'a financial institution')).not.toBeNull();
  });

  it('source 儲存正確', () => {
    db.set('test', 'noun', 'an examination', '測試', 'azure');
    expect(db.get('test', 'noun', 'an examination')!.source).toBe('azure');
  });
});

// ── setZhIfEmpty ──────────────────────────────────────────────────────────────

describe('setZhIfEmpty()', () => {
  it('key 不存在時回傳 false（不建立新 row）', () => {
    expect(db.setZhIfEmpty('ghost', 'noun', 'a spirit', '鬼', 'deepl')).toBe(false);
    expect(db.get('ghost', 'noun', 'a spirit')).toBeNull();
  });

  it('已有 zh 時不覆寫，回傳 false', () => {
    db.set('run', 'verb', 'to move fast', '奔跑', 'deepl');
    expect(db.setZhIfEmpty('run', 'verb', 'to move fast', '跑', 'azure')).toBe(false);
    expect(db.get('run', 'verb', 'to move fast')!.zh).toBe('奔跑');
  });

  it('zh 為空時補填 zh 與 source，回傳 true', () => {
    db.set('run', 'verb', 'to move fast', '', '');
    expect(db.setZhIfEmpty('run', 'verb', 'to move fast', '奔跑', 'deepl')).toBe(true);
    const entry = db.get('run', 'verb', 'to move fast')!;
    expect(entry.zh).toBe('奔跑');
    expect(entry.source).toBe('deepl');
  });
});

// ── key 格式 ──────────────────────────────────────────────────────────────────

describe('key 格式', () => {
  it('同 word+pos 不同 definition_en 各自獨立', () => {
    db.set('set', 'verb', 'to put something in a place', '放置', 'deepl');
    db.set('set', 'verb', 'to harden or solidify',       '凝固', 'deepl');
    expect(db.get('set', 'verb', 'to put something in a place')!.zh).toBe('放置');
    expect(db.get('set', 'verb', 'to harden or solidify')!.zh).toBe('凝固');
  });
});

// ── migration：既有 DB 無 source 欄 ─────────────────────────────────────────

describe('schema migration', () => {
  it('既有無 source 欄的 DB 在重新開啟後可正常讀寫', () => {
    const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worddefdb-mig-'));
    try {
      // 先建立舊格式 DB（無 source 欄）
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const enDef = 'old definition';
      const oldKey = `old:noun::${fnv1a(enDef)}`;
      const oldDb = new Database(path.join(migDir, 'word-def.db'));
      oldDb.exec(`CREATE TABLE IF NOT EXISTS defs (key TEXT PRIMARY KEY, en TEXT NOT NULL, zh TEXT NOT NULL DEFAULT '')`);
      oldDb.prepare('INSERT INTO defs (key, en, zh) VALUES (?, ?, ?)').run(oldKey, enDef, '舊翻譯');
      oldDb.close();

      // 用 WordDefDb 重新開啟（會執行 migration 加 source 欄）
      const migrated = new WordDefDb(migDir);
      // migration 後可正常插入含 source 的新資料
      expect(migrated.set('run', 'verb', 'to move fast', '奔跑', 'deepl')).toBe(true);
      expect(migrated.get('run', 'verb', 'to move fast')!.source).toBe('deepl');
      // 舊資料 source 預設為空字串
      expect(migrated.get('old', 'noun', enDef)!.source).toBe('');
      migrated.close();
    } finally {
      fs.rmSync(migDir, { recursive: true, force: true });
    }
  });
});
