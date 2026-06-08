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
});
