import * as fs from 'fs';
import { resolveDataPath } from './dataPath';

export interface PhraseEntry {
  opal_spoken?: true;
  opal_written?: true;
  opl_level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
}

export interface PhraseMatch {
  phrase: string;
  entry:  PhraseEntry;
  start:  number;  // char offset in original text
  end:    number;
}

// ── Lazy-loaded phrase database ───────────────────────────────────────────────
let _db: Map<string, PhraseEntry> | null = null;

function getDb(): Map<string, PhraseEntry> {
  if (!_db) {
    const raw = JSON.parse(fs.readFileSync(resolveDataPath('phrase-list.json'), 'utf-8')) as Record<string, PhraseEntry>;
    _db = new Map(Object.entries(raw));
  }
  return _db;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────
// Stopwords / placeholders that may appear where "sb/sth" was stripped
const STOPWORDS = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
  'this', 'that', 'these', 'those', 'something', 'someone', 'somebody',
  'everything', 'everyone', 'anything', 'anyone',
]);

/**
 * Strip trailing pronoun/placeholder words that correspond to "sb/sth" positions.
 * Applied iteratively, up to 2 words removed.
 */
function stripTrailingPlaceholders(words: string[]): string[] {
  let result = [...words];
  for (let pass = 0; pass < 2; pass++) {
    if (result.length < 3) break;
    const last = result[result.length - 1];
    if (STOPWORDS.has(last)) {
      result = result.slice(0, -1);
    } else {
      break;
    }
  }
  return result;
}

/**
 * Normalise a phrase string to a lookup key (lowercase, collapsed whitespace).
 */
function normaliseKey(phrase: string): string {
  return phrase.toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Look up an exact phrase and return its metadata, or null if not found.
 * Strips trailing placeholder words (pronouns, sb/sth) before lookup.
 */
export function lookupPhrase(phrase: string): PhraseEntry | null {
  const db = getDb();
  const words = normaliseKey(phrase).split(' ');

  // Try exact key first
  const exact = words.join(' ');
  if (db.has(exact)) return db.get(exact)!;

  // Try after stripping trailing placeholders
  const stripped = stripTrailingPlaceholders(words).join(' ');
  if (stripped !== exact && db.has(stripped)) return db.get(stripped)!;

  return null;
}

/**
 * Find all phrase-list matches in a plain-text string.
 * Uses a sliding window (longest match wins) over whitespace-tokenised words.
 * Returns matches sorted by start offset, non-overlapping (longest wins).
 */
export function findPhrasesInText(text: string): PhraseMatch[] {
  const db = getDb();
  // Tokenise: keep original casing for offset tracking
  const tokenRe = /[a-zA-Z']+/g;
  const tokens: Array<{ word: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }

  const matches: PhraseMatch[] = [];
  const used = new Set<number>(); // token indices already consumed

  // Max phrase length in tokens (longest phrase in db ≈ 8 words)
  const MAX_LEN = 10;

  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;

    // Try decreasing window lengths: prefer longest match
    for (let len = Math.min(MAX_LEN, tokens.length - i); len >= 2; len--) {
      const windowTokens = tokens.slice(i, i + len);
      const candidate = windowTokens.map(t => t.word.toLowerCase()).join(' ');
      const entry = db.get(candidate);
      if (entry) {
        // Check none of these token positions are already used
        const indices = Array.from({ length: len }, (_, k) => i + k);
        if (indices.some(idx => used.has(idx))) continue;

        matches.push({
          phrase: candidate,
          entry,
          start: windowTokens[0].start,
          end:   windowTokens[windowTokens.length - 1].end,
        });
        indices.forEach(idx => used.add(idx));
        break; // longest match consumed, move to next free token
      }
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/** Total number of phrases in the library. */
export function phraseCount(): number {
  return getDb().size;
}
