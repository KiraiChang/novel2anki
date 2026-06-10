import { buildProperNounSet, protectNames, restoreNames, NAME_SKIP } from '../../nlp/nameProtector';

// ── NAME_SKIP 大小寫不敏感 ─────────────────────────────────────────────────────

describe('NAME_SKIP — case-insensitive exclusions', () => {
  it('should store entries in lowercase', () => {
    // All entries should be lowercase
    for (const entry of NAME_SKIP) {
      expect(entry).toBe(entry.toLowerCase());
    }
  });

  it('should include common pronouns in lowercase', () => {
    expect(NAME_SKIP.has('his')).toBe(true);
    expect(NAME_SKIP.has('her')).toBe(true);
    expect(NAME_SKIP.has('him')).toBe(true);
    expect(NAME_SKIP.has('they')).toBe(true);
    expect(NAME_SKIP.has('their')).toBe(true);
    expect(NAME_SKIP.has('them')).toBe(true);
    expect(NAME_SKIP.has('our')).toBe(true);
    expect(NAME_SKIP.has('we')).toBe(true);
  });
});

// ── buildProperNounSet ────────────────────────────────────────────────────────

describe('buildProperNounSet — excludes pronouns regardless of case', () => {
  it('should NOT add "his" to names even if detected mid-sentence', () => {
    // "his" appears mid-sentence in uppercase (from sentence starting with capital H subject)
    const names = buildProperNounSet(['The sword fell from his hand.']);
    expect(names.has('his')).toBe(false);
    expect(names.has('His')).toBe(false);
  });

  it('should NOT add "Her" (possessive pronoun) when it appears mid-sentence', () => {
    const names = buildProperNounSet(['He took Her book.']);
    expect(names.has('Her')).toBe(false);
    expect(names.has('her')).toBe(false);
  });

  it('should NOT add "Their" or "They" from mid-sentence detection', () => {
    const names = buildProperNounSet(['The soldiers raised Their swords and They charged.']);
    expect(names.has('Their')).toBe(false);
    expect(names.has('They')).toBe(false);
  });

  it('should add genuine proper nouns appearing mid-sentence', () => {
    // mid-sentence 大寫偵測從索引 1 起，句首的名詞不在此範圍
    const names = buildProperNounSet(['The ranger Elbryan fought bravely.']);
    expect(names.has('Elbryan')).toBe(true);
  });

  it('should add mid-sentence capitalized names that are not in NAME_SKIP', () => {
    const names = buildProperNounSet(['She called to Jilseponie across the field.']);
    expect(names.has('Jilseponie')).toBe(true);
  });
});

// ── protectNames + restoreNames ───────────────────────────────────────────────

describe('protectNames — should not protect common pronouns', () => {
  it('should leave "his" untouched so translator can translate it', () => {
    const names = buildProperNounSet(['He raised his sword against the enemy.']);
    const { text } = protectNames('He raised his sword against the enemy.', names);
    expect(text).not.toContain('__PERSON_');
    expect(text).toContain('his');
  });

  it('should protect genuine proper nouns but not surrounding pronouns', () => {
    const names = new Set(['Elbryan']);
    const { text, restoreMap } = protectNames('Elbryan raised his sword.', names);
    expect(text).toContain('__PERSON_0__');
    expect(text).toContain('his');
    const restored = restoreNames(text, restoreMap);
    expect(restored).toBe('Elbryan raised his sword.');
  });
});
