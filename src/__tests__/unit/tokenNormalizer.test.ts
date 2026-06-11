import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadNormalizeFile,
  findNormalizeFile,
  slugFromCsvPath,
  applyNormalization,
  exportNormalizeFile,
} from '../../nlp/tokenNormalizer';

describe('loadNormalizeFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should load JSON file into a Map of string→string', () => {
    // Given
    const file = path.join(tmpDir, 'test.json');
    fs.writeFileSync(file, JSON.stringify({ yer: 'your', thee: 'you' }), 'utf-8');
    // When
    const map = loadNormalizeFile(file);
    // Then
    expect(map.get('yer')).toBe('your');
    expect(map.get('thee')).toBe('you');
    expect(map.size).toBe(2);
  });

  it('should return empty Map when file does not exist', () => {
    // Given
    const file = path.join(tmpDir, 'nonexistent.json');
    // When
    const map = loadNormalizeFile(file);
    // Then
    expect(map.size).toBe(0);
  });

  it('should return empty Map when file contains invalid JSON', () => {
    // Given
    const file = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(file, 'not json', 'utf-8');
    // When
    const map = loadNormalizeFile(file);
    // Then
    expect(map.size).toBe(0);
  });
});

// ── findNormalizeFile ─────────────────────────────────────────────────────────

describe('findNormalizeFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when directory contains no *-normalize.json', () => {
    // Given (empty dir)
    // When
    const result = findNormalizeFile(tmpDir);
    // Then
    expect(result).toBeNull();
  });

  it('should return full path to first *-normalize.json found', () => {
    // Given
    const file = path.join(tmpDir, 'the-demon-awakens-normalize.json');
    fs.writeFileSync(file, '{}', 'utf-8');
    // When
    const result = findNormalizeFile(tmpDir);
    // Then
    expect(result).toBe(file);
  });

  it('should prefer exact slug match over other normalize files', () => {
    // Given
    const other = path.join(tmpDir, 'other-book-normalize.json');
    const exact = path.join(tmpDir, 'my-book-normalize.json');
    fs.writeFileSync(other, '{}', 'utf-8');
    fs.writeFileSync(exact, '{}', 'utf-8');
    // When
    const result = findNormalizeFile(tmpDir, 'my-book');
    // Then
    expect(result).toBe(exact);
  });

  it('should fall back to any *-normalize.json when slug does not match', () => {
    // Given
    const file = path.join(tmpDir, 'other-book-normalize.json');
    fs.writeFileSync(file, '{}', 'utf-8');
    // When
    const result = findNormalizeFile(tmpDir, 'no-match-slug');
    // Then
    expect(result).toBe(file);
  });

  it('should return null when directory does not exist', () => {
    // Given
    const missing = path.join(tmpDir, 'nonexistent-subdir');
    // When
    const result = findNormalizeFile(missing);
    // Then
    expect(result).toBeNull();
  });
});

// ── slugFromCsvPath ───────────────────────────────────────────────────────────

describe('slugFromCsvPath', () => {
  it('should extract slug from standard beginner-words CSV filename', () => {
    expect(slugFromCsvPath('the-demon-awakens-beginner-words-part-01.csv')).toBe('the-demon-awakens');
  });

  it('should work with full directory path', () => {
    const csvPath = path.join('/output', 'my-book-beginner-words-part-02.csv');
    expect(slugFromCsvPath(csvPath)).toBe('my-book');
  });

  it('should return null when filename does not match beginner-words pattern', () => {
    expect(slugFromCsvPath('random-file.csv')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(slugFromCsvPath('')).toBeNull();
  });

  it('should handle single-word book slug', () => {
    expect(slugFromCsvPath('dune-beginner-words-part-01.csv')).toBe('dune');
  });
});

// ── applyNormalization ────────────────────────────────────────────────────────

describe('applyNormalization', () => {
  const map = new Map([
    ['yer', 'your'],
    ['thee', 'you'],
    ["'tis", 'it is'],
    ['nay', 'no'],
  ]);

  it('should replace matching word at start of sentence', () => {
    expect(applyNormalization('Nay, I refuse.', map)).toBe('no, I refuse.');
  });

  it('should replace matching word in middle of sentence', () => {
    expect(applyNormalization('Give it to thee now.', map)).toBe('Give it to you now.');
  });

  it('should be case-insensitive', () => {
    expect(applyNormalization('Give me YER hand.', map)).toBe('Give me your hand.');
  });

  it("should handle apostrophe prefix like 'tis", () => {
    expect(applyNormalization("'Tis a fine day.", map)).toBe("it is a fine day.");
  });

  it('should NOT replace substring within a longer word', () => {
    // "yer" should not match "ayer" or "layer"
    expect(applyNormalization('The player stayed.', map)).toBe('The player stayed.');
  });

  it('should NOT replace "nay" inside "naysayer"', () => {
    expect(applyNormalization('The naysayer spoke.', map)).toBe('The naysayer spoke.');
  });

  it('should replace multiple occurrences in the same text', () => {
    expect(applyNormalization('Give thee what thee need.', map)).toBe('Give you what you need.');
  });

  it('should return original text unchanged when map is empty', () => {
    const result = applyNormalization('Hello world.', new Map());
    expect(result).toBe('Hello world.');
  });

  it('should handle text with no matches gracefully', () => {
    const result = applyNormalization('The quick brown fox.', map);
    expect(result).toBe('The quick brown fox.');
  });
});

// ── exportNormalizeFile ───────────────────────────────────────────────────────

describe('exportNormalizeFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'norm-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create JSON file with archaic matches from UNKNOWN words', () => {
    // Given
    const unknownWords = new Map([['yer', 5], ['thee', 3], ['modernword', 10]]);
    const archaicMap = new Map([['yer', 'your'], ['thee', 'you']]);
    const outputPath = path.join(tmpDir, 'test-normalize.json');
    // When
    exportNormalizeFile(unknownWords, archaicMap, outputPath);
    // Then
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(written).toEqual({ thee: 'you', yer: 'your' });
  });

  it('should return matched list with from/to/count for archaic hits', () => {
    // Given
    const unknownWords = new Map([['yer', 7], ['thee', 2]]);
    const archaicMap = new Map([['yer', 'your'], ['thee', 'you']]);
    const outputPath = path.join(tmpDir, 'test-normalize.json');
    // When
    const result = exportNormalizeFile(unknownWords, archaicMap, outputPath);
    // Then
    expect(result.matched).toContainEqual({ from: 'yer', to: 'your', count: 7 });
    expect(result.matched).toContainEqual({ from: 'thee', to: 'you', count: 2 });
  });

  it('should return suggestions for UNKNOWN words above minSuggestionFreq', () => {
    // Given
    const unknownWords = new Map([['gobbo', 5], ['rareword', 1]]);
    const archaicMap = new Map<string, string>();
    const outputPath = path.join(tmpDir, 'test-normalize.json');
    // When
    const result = exportNormalizeFile(unknownWords, archaicMap, outputPath, 3);
    // Then
    expect(result.suggestions).toContainEqual({ lemma: 'gobbo', count: 5 });
    expect(result.suggestions.find(s => s.lemma === 'rareword')).toBeUndefined();
  });

  it('should NOT overwrite existing entries (preserve manual edits)', () => {
    // Given: file already has a manual override for "yer"
    const outputPath = path.join(tmpDir, 'test-normalize.json');
    fs.writeFileSync(outputPath, JSON.stringify({ yer: 'your custom override' }), 'utf-8');
    const unknownWords = new Map([['yer', 4]]);
    const archaicMap = new Map([['yer', 'your']]);
    // When
    exportNormalizeFile(unknownWords, archaicMap, outputPath);
    // Then
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(written.yer).toBe('your custom override');
  });

  it('should write sorted keys for readability', () => {
    // Given
    const unknownWords = new Map([['yer', 3], ['nay', 4], ['thee', 5]]);
    const archaicMap = new Map([['yer', 'your'], ['nay', 'no'], ['thee', 'you']]);
    const outputPath = path.join(tmpDir, 'test-normalize.json');
    // When
    exportNormalizeFile(unknownWords, archaicMap, outputPath);
    // Then
    const keys = Object.keys(JSON.parse(fs.readFileSync(outputPath, 'utf-8')));
    expect(keys).toEqual([...keys].sort());
  });

  it('should sort matched by count descending', () => {
    // Given
    const unknownWords = new Map([['nay', 2], ['yer', 8], ['thee', 5]]);
    const archaicMap = new Map([['yer', 'your'], ['nay', 'no'], ['thee', 'you']]);
    const outputPath = path.join(tmpDir, 'test-normalize.json');
    // When
    const result = exportNormalizeFile(unknownWords, archaicMap, outputPath);
    // Then
    expect(result.matched[0].from).toBe('yer');
    expect(result.matched[1].from).toBe('thee');
    expect(result.matched[2].from).toBe('nay');
  });

  it('should return outputPath in result', () => {
    // Given
    const outputPath = path.join(tmpDir, 'slug-normalize.json');
    // When
    const result = exportNormalizeFile(new Map(), new Map(), outputPath);
    // Then
    expect(result.outputPath).toBe(outputPath);
  });

  it('should create parent directory if it does not exist', () => {
    // Given
    const nested = path.join(tmpDir, 'deep', 'dir', 'test-normalize.json');
    // When
    exportNormalizeFile(new Map(), new Map(), nested);
    // Then
    expect(fs.existsSync(nested)).toBe(true);
  });
});
