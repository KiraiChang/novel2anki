import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WordCacheManager } from '../../nlp/wordCache';

describe('WordCacheManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── get ──────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return null when both dict and cache are empty', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      // When / Then
      expect(wc.get('bear', 'verb')).toBeNull();
    });

    it('should return dict entry with tier=dict on exact word:pos match', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setDict('bear', 'verb', '(verb) to endure');
      // When
      const result = wc.get('bear', 'verb');
      // Then
      expect(result?.def).toBe('(verb) to endure');
      expect(result?.tier).toBe('dict');
    });

    it('should fall back to word-only dict entry when POS-specific entry is absent', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setDict('bear', undefined, '(noun) a large mammal');
      // When
      const result = wc.get('bear', 'noun');
      // Then
      expect(result).not.toBeNull();
      expect(result?.tier).toBe('dict');
    });

    it('should prefer dict entry over cache entry for same word:pos', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('bear', 'verb', '(verb) cache definition', 'MW');
      wc.setDict('bear', 'verb', '(verb) curated definition');
      // When
      const result = wc.get('bear', 'verb');
      // Then
      expect(result?.def).toBe('(verb) curated definition');
      expect(result?.tier).toBe('dict');
    });

    it('should return cache entry with tier=cache when dict has no match', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', 'verb', '(verb) to sprint', 'free');
      // When
      const result = wc.get('run', 'verb');
      // Then
      expect(result?.def).toBe('(verb) to sprint');
      expect(result?.tier).toBe('cache');
    });

    it('should be case-insensitive for both word and POS', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setDict('Bear', 'Verb', '(verb) to endure');
      // When / Then
      expect(wc.get('bear', 'verb')).not.toBeNull();
      expect(wc.get('BEAR', 'VERB')).not.toBeNull();
    });
  });

  // ── flush ────────────────────────────────────────────────────────────────────

  describe('flush', () => {
    it('should write word-cache.json to disk after setCache', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', 'verb', '(verb) to sprint', 'MW');
      // When
      wc.flush();
      // Then
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'word-cache.json'), 'utf-8'));
      expect(data['run:verb']?.def).toBe('(verb) to sprint');
      expect(data['run:verb']?.source).toBe('MW');
    });

    it('should write word-dict.json to disk after setDict', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setDict('bear', 'verb', '(verb) to endure');
      // When
      wc.flush();
      // Then
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'word-dict.json'), 'utf-8'));
      expect(data['bear:verb']).toBe('(verb) to endure');
    });

    it('should not create any files when no changes were made', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      // When
      wc.flush();
      // Then
      expect(fs.existsSync(path.join(tmpDir, 'word-cache.json'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'word-dict.json'))).toBe(false);
    });

    it('should not overwrite dict file if only cache was changed', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', 'verb', '(verb) to sprint', 'MW');
      // When
      wc.flush();
      // Then
      expect(fs.existsSync(path.join(tmpDir, 'word-dict.json'))).toBe(false);
    });
  });

  // ── getChinese / setChinese ───────────────────────────────────────────────────

  describe('getChinese', () => {
    it('should return null when Chinese cache is empty', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      // When / Then
      expect(wc.getChinese('run', 'verb')).toBeNull();
    });

    it('should return Chinese def on base key match', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', null, '快速奔跑', 'deepl');
      // When / Then
      expect(wc.getChinese('run', null)).toBe('快速奔跑');
    });

    it('should fall back from word:pos to word when exact key is absent', () => {
      // Given: stored under base key only
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', null, '快速奔跑', 'deepl');
      // When: query with POS
      const result = wc.getChinese('run', 'verb');
      // Then: falls back to base key
      expect(result).toBe('快速奔跑');
    });

    it('should return POS-specific entry when exact word:pos key exists', () => {
      // Given: noun and base both stored
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', 'noun', '奔跑名詞', 'deepl');
      wc.setChinese('run', null, '奔跑預設', 'deepl:derived');
      // When: query with noun
      expect(wc.getChinese('run', 'noun')).toBe('奔跑名詞');
      // Then: base key still accessible separately
      expect(wc.getChinese('run', null)).toBe('奔跑預設');
    });
  });

  describe('hasChinese', () => {
    it('should return false when no zh entry exists for the key', () => {
      const wc = new WordCacheManager(tmpDir);
      expect(wc.hasChinese('run', null)).toBe(false);
      expect(wc.hasChinese('run', 'noun')).toBe(false);
    });

    it('should return true only for the exact key stored', () => {
      // Given: only base key stored
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', null, '快速奔跑', 'deepl');
      // Then: base key → true, POS key → false (no fallback)
      expect(wc.hasChinese('run', null)).toBe(true);
      expect(wc.hasChinese('run', 'noun')).toBe(false);
    });

    it('should return true for word:pos key when that specific POS is stored', () => {
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', 'noun', '奔跑名詞', 'deepl');
      expect(wc.hasChinese('run', 'noun')).toBe(true);
      expect(wc.hasChinese('run', 'verb')).toBe(false);
    });
  });

  describe('getAllCacheEntriesForWord', () => {
    it('should return empty array when word has no cache entries', () => {
      const wc = new WordCacheManager(tmpDir);
      expect(wc.getAllCacheEntriesForWord('run')).toEqual([]);
    });

    it('should return all POS-specific entries for a word', () => {
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', 'verb', '(verb) to sprint', 'MW');
      wc.setCache('run', 'noun', '(noun) a running race', 'MW');
      const result = wc.getAllCacheEntriesForWord('run');
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([
        { pos: 'verb', def: '(verb) to sprint' },
        { pos: 'noun', def: '(noun) a running race' },
      ]));
    });

    it('should include the base (no-POS) entry when present', () => {
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', null, '(verb) to sprint', 'MW');
      const result = wc.getAllCacheEntriesForWord('run');
      expect(result).toContainEqual({ pos: null, def: '(verb) to sprint' });
    });

    it('should prefer dict entry over cache entry for the same POS', () => {
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', 'verb', '(verb) cache def', 'MW');
      wc.setDict('run', 'verb', '(verb) dict def');
      const result = wc.getAllCacheEntriesForWord('run');
      const verbEntry = result.find(e => e.pos === 'verb');
      expect(verbEntry?.def).toBe('(verb) dict def');
    });
  });

  describe('flush (Chinese cache)', () => {
    it('should write word-cache-zh.json with object format after setChinese', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', null, '快速奔跑', 'deepl');
      // When
      wc.flush();
      // Then: 新格式 { zh, source }
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'word-cache-zh.json'), 'utf-8'));
      expect(data['run']).toEqual({ zh: '快速奔跑', source: 'deepl' });
    });

    it('should write POS-specific key when setChinese is called with pos', () => {
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run', 'noun', '奔跑名詞', 'azure');
      wc.flush();
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'word-cache-zh.json'), 'utf-8'));
      expect(data['run:noun']).toEqual({ zh: '奔跑名詞', source: 'azure' });
    });

    it('should not create word-cache-zh.json when only English cache was changed', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setCache('run', 'verb', '(verb) to sprint', 'MW');
      // When
      wc.flush();
      // Then
      expect(fs.existsSync(path.join(tmpDir, 'word-cache-zh.json'))).toBe(false);
    });
  });

  describe('loadCacheZh — migration from legacy string format', () => {
    it('should load old plain-string entries as {zh, source: legacy}', () => {
      // Given: old format file
      const legacyData = { run: '快速奔跑', bear: '熊' };
      fs.writeFileSync(path.join(tmpDir, 'word-cache-zh.json'), JSON.stringify(legacyData));
      // When
      const wc = new WordCacheManager(tmpDir);
      // Then: getChinese still works
      expect(wc.getChinese('run', null)).toBe('快速奔跑');
      expect(wc.getChinese('bear', null)).toBe('熊');
    });

    it('should mark migrated entries with source=legacy after flush', () => {
      // Given: old format file
      fs.writeFileSync(path.join(tmpDir, 'word-cache-zh.json'), JSON.stringify({ run: '快速奔跑' }));
      const wc = new WordCacheManager(tmpDir);
      wc.setChinese('run:extra', null, '額外', 'test'); // trigger dirty flag
      wc.flush();
      // Then: migrated entry has source=legacy
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'word-cache-zh.json'), 'utf-8'));
      expect(data['run']).toEqual({ zh: '快速奔跑', source: 'legacy' });
    });
  });

  // ── persistence ──────────────────────────────────────────────────────────────

  describe('persistence', () => {
    it('should load dict and cache from existing files on construction', () => {
      // Given: first instance writes data
      const wc1 = new WordCacheManager(tmpDir);
      wc1.setDict('abandon', 'verb', '(verb) to leave entirely');
      wc1.setCache('run', 'verb', '(verb) to sprint', 'MW');
      wc1.flush();

      // When: second instance reads from same directory
      const wc2 = new WordCacheManager(tmpDir);

      // Then
      expect(wc2.get('abandon', 'verb')?.tier).toBe('dict');
      expect(wc2.get('run', 'verb')?.tier).toBe('cache');
    });

    it('should load Chinese cache from existing file on construction', () => {
      // Given
      const wc1 = new WordCacheManager(tmpDir);
      wc1.setChinese('run', null, '快速奔跑', 'deepl');
      wc1.flush();
      // When
      const wc2 = new WordCacheManager(tmpDir);
      // Then
      expect(wc2.getChinese('run', null)).toBe('快速奔跑');
    });
  });

  // ── dictSize / cacheSize ──────────────────────────────────────────────────────

  describe('dictSize and cacheSize', () => {
    it('should reflect the number of entries in each tier', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setDict('bear', 'verb', 'def1');
      wc.setDict('run', 'verb', 'def2');
      wc.setCache('go', 'verb', 'def3', 'MW');
      // When / Then
      expect(wc.dictSize).toBe(2);
      expect(wc.cacheSize).toBe(1);
    });
  });

  // ── sentence cache ────────────────────────────────────────────────────────────

  describe('setSentenceZh / getSentenceZh', () => {
    it('should return null for unknown sentence', () => {
      const wc = new WordCacheManager(tmpDir);
      expect(wc.getSentenceZh('He ran fast.')).toBeNull();
    });

    it('should return stored translation for exact sentence', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setSentenceZh('He ran fast.', '他跑得很快。');
      // When / Then
      expect(wc.getSentenceZh('He ran fast.')).toBe('他跑得很快。');
    });

    it('should treat different sentences as different keys', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setSentenceZh('He ran fast.', '他跑得很快。');
      wc.setSentenceZh('She walked slowly.', '她走得很慢。');
      // When / Then
      expect(wc.getSentenceZh('He ran fast.')).toBe('他跑得很快。');
      expect(wc.getSentenceZh('She walked slowly.')).toBe('她走得很慢。');
    });

    it('should persist to sentence-cache.json after flush and reload', () => {
      // Given
      const wc1 = new WordCacheManager(tmpDir);
      wc1.setSentenceZh('The chapter began.', '這章開始了。');
      wc1.flush();
      // When
      const wc2 = new WordCacheManager(tmpDir);
      // Then
      expect(wc2.getSentenceZh('The chapter began.')).toBe('這章開始了。');
    });

    it('should store en and zh in sentence-cache.json', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.setSentenceZh('He ran fast.', '他跑得很快。');
      wc.flush();
      // When
      const raw = JSON.parse(fs.readFileSync(
        path.join(tmpDir, 'sentence-cache.json'), 'utf-8',
      )) as Record<string, { en: string; zh: string }>;
      const entries = Object.values(raw);
      // Then
      expect(entries).toHaveLength(1);
      expect(entries[0].en).toBe('He ran fast.');
      expect(entries[0].zh).toBe('他跑得很快。');
    });

    it('should NOT write file when no setSentenceZh was called (dirty flag)', () => {
      // Given
      const wc = new WordCacheManager(tmpDir);
      wc.flush();
      // Then: file should not exist (no write happened)
      expect(fs.existsSync(path.join(tmpDir, 'sentence-cache.json'))).toBe(false);
    });

    it('should increment sentenceCacheSize correctly', () => {
      const wc = new WordCacheManager(tmpDir);
      expect(wc.sentenceCacheSize).toBe(0);
      wc.setSentenceZh('sent1', 'zh1');
      wc.setSentenceZh('sent2', 'zh2');
      expect(wc.sentenceCacheSize).toBe(2);
    });
  });
});
