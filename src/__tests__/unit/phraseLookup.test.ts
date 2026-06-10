jest.mock('fs');

import * as fs from 'fs';
import type { PhraseMatch } from '../../nlp/phraseLookup';

// ── Mock phrase database ───────────────────────────────────────────────────────
const MOCK_PHRASES: Record<string, object> = {
  'in terms of':        { opal_spoken: true, opal_written: true, opl_level: 'A2' },
  'for example':        { opal_spoken: true, opl_level: 'A1' },
  'as a result':        { opal_written: true, opl_level: 'A2' },
  'as a result of':     { opal_written: true, opl_level: 'A2' },
  'on the other hand':  { opal_written: true, opl_level: 'B1' },
  'get on':             { opl_level: 'A1' },
  'depend on':          { opl_level: 'A1' },
  'look forward to':    { opl_level: 'A2' },
  'take into account':  { opal_written: true },
  'in order to':        { opal_spoken: true, opal_written: true },
  'make sense':         { opl_level: 'A2' },
};

(fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(MOCK_PHRASES));

// Import after mock is set up (module-level singleton reads fs on first call)
import { lookupPhrase, findPhrasesInText, phraseCount } from '../../nlp/phraseLookup';

// ── lookupPhrase ──────────────────────────────────────────────────────────────

describe('lookupPhrase', () => {
  it('should return entry for exact phrase match', () => {
    // Given — phrase exists in the library
    // When
    const result = lookupPhrase('in terms of');
    // Then
    expect(result).toEqual({ opal_spoken: true, opal_written: true, opl_level: 'A2' });
  });

  it('should be case-insensitive', () => {
    // Given — phrase stored in lowercase
    // When
    const result = lookupPhrase('In Terms Of');
    // Then
    expect(result).toEqual({ opal_spoken: true, opal_written: true, opl_level: 'A2' });
  });

  it('should strip trailing pronoun placeholder before lookup', () => {
    // Given — "depend on sb/sth" is stored as "depend on"; user passes "depend on you"
    // When
    const result = lookupPhrase('depend on you');
    // Then — "you" stripped, matches "depend on"
    expect(result).toEqual({ opl_level: 'A1' });
  });

  it('should strip trailing reflexive pronoun before lookup', () => {
    // Given — "look forward to sth" stored as "look forward to"; user passes "look forward to it"
    // When
    const result = lookupPhrase('look forward to it');
    // Then
    expect(result).toEqual({ opl_level: 'A2' });
  });

  it('should return null for unknown phrase', () => {
    // Given — phrase not in library
    // When
    const result = lookupPhrase('completely made up phrase');
    // Then
    expect(result).toBeNull();
  });
});

// ── findPhrasesInText ─────────────────────────────────────────────────────────

describe('findPhrasesInText', () => {
  it('should find a known phrase in a sentence', () => {
    // Given — sentence contains "for example"
    const text = 'Students can learn in many ways, for example through reading.';
    // When
    const matches: PhraseMatch[] = findPhrasesInText(text);
    // Then
    const match = matches.find(m => m.phrase === 'for example');
    expect(match).toBeDefined();
    expect(match!.entry).toEqual({ opal_spoken: true, opl_level: 'A1' });
    expect(text.slice(match!.start, match!.end)).toBe('for example');
  });

  it('should prefer longest match when a shorter phrase is a prefix', () => {
    // Given — "as a result of" is longer than "as a result"; both in db
    const text = 'As a result of the storm, power went out.';
    // When
    const matches: PhraseMatch[] = findPhrasesInText(text);
    // Then — should match the longer form, not the shorter
    expect(matches.some(m => m.phrase === 'as a result of')).toBe(true);
    expect(matches.some(m => m.phrase === 'as a result')).toBe(false);
  });

  it('should return multiple non-overlapping matches', () => {
    // Given — sentence with two known phrases
    const text = 'In terms of style, on the other hand, simplicity wins.';
    // When
    const matches: PhraseMatch[] = findPhrasesInText(text);
    // Then
    const phrases = matches.map(m => m.phrase);
    expect(phrases).toContain('in terms of');
    expect(phrases).toContain('on the other hand');
  });

  it('should return empty array for text with no known phrases', () => {
    // Given — text with no library phrases
    const text = 'The cat sat on the mat.';
    // When
    const matches: PhraseMatch[] = findPhrasesInText(text);
    // Then
    expect(matches).toHaveLength(0);
  });

  it('should return matches sorted by start offset', () => {
    // Given — two phrases in reverse order of input
    const text = 'In order to succeed, make sense of the rules.';
    // When
    const matches: PhraseMatch[] = findPhrasesInText(text);
    // Then — sorted by start position
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i].start).toBeGreaterThanOrEqual(matches[i - 1].start);
    }
  });
});

// ── phraseCount ───────────────────────────────────────────────────────────────

describe('phraseCount', () => {
  it('should return total number of phrases in library', () => {
    // Given — mock db has 11 phrases
    // When
    const n = phraseCount();
    // Then
    expect(n).toBe(11);
  });
});
