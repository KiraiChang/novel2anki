import * as fs from 'fs';
import { WordToken, CefrLevel } from '../nlp/types';
import { VocabCard } from '../cards/types';

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
      fields.push(field);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return fields;
}

function splitLines(content: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') { current += '""'; i++; }
      else { inQuotes = !inQuotes; current += ch; }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      if (current.length > 0) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function readFirstLine(csvPath: string): string {
  try { return fs.readFileSync(csvPath, 'utf-8').split('\n')[0] ?? ''; }
  catch { return ''; }
}

export function isBeginnerCsv(csvPath: string): boolean {
  return readFirstLine(csvPath).includes('token_id');
}

export function isBeginnerWordsCsv(csvPath: string): boolean {
  const first = readFirstLine(csvPath);
  return first.includes('context_sentence') && !first.includes('token_id');
}

export function importBeginnerWords(csvPath: string): VocabCard[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return [];

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const cards: VocabCard[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const get = (col: string) => cols[idx[col]] ?? '';
    const definition = get('definition_zh').trim();
    if (!definition) continue;

    const exampleZh = get('context_sentence_zh').trim();
    cards.push({
      type: 'vocab',
      word: get('lemma'),
      definition_zh: definition,
      exampleFromText: get('context_sentence'),
      ...(exampleZh ? { exampleZh } : {}),
    });
  }

  return cards;
}

export function importBeginnerTokens(csvPath: string): WordToken[] {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return [];

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const tokens: WordToken[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const get = (col: string) => cols[idx[col]] ?? '';

    tokens.push({
      id: get('token_id'),
      lemma: get('lemma'),
      original: get('original'),
      pos: get('pos'),
      cefrLevel: (get('cefr_level') || 'UNKNOWN') as CefrLevel | 'UNKNOWN',
      globalFrequency: parseInt(get('global_frequency'), 10) || 0,
      coverageRank: parseInt(get('coverage_rank'), 10) || 0,
      bestSentence: get('best_sentence'),
      bestSentenceScore: 0,
      sourceChunkIndex: parseInt(get('source_chunk'), 10) || 0,
      sourceChapter: get('source_chapter') || undefined,
      definition_zh: get('definition_zh'),
    });
  }

  return tokens;
}

export function importBeginnerWordsFromFiles(csvPaths: string[]): VocabCard[] {
  interface RankedCard { card: VocabCard; coverageRank: number; }

  const seen = new Set<string>();
  const ranked: RankedCard[] = [];

  for (const csvPath of csvPaths) {
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = splitLines(content);
    if (lines.length < 2) continue;

    const headers = parseRow(lines[0]);
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const get = (col: string) => cols[idx[col]] ?? '';
      const lemma = get('lemma').trim();
      const definition = get('definition_zh').trim();

      if (!definition || !lemma || seen.has(lemma)) continue;
      seen.add(lemma);

      const exampleZh = get('context_sentence_zh').trim();
      ranked.push({
        card: {
          type: 'vocab' as const,
          word: lemma,
          definition_zh: definition,
          exampleFromText: get('context_sentence'),
          ...(exampleZh ? { exampleZh } : {}),
        },
        coverageRank: parseInt(get('coverage_rank'), 10) || 0,
      });
    }
  }

  ranked.sort((a, b) => a.coverageRank - b.coverageRank);
  return ranked.map(r => r.card);
}

export function mergeTokensToVocabCards(tokens: WordToken[]): VocabCard[] {
  return tokens
    .filter(t => t.definition_zh.trim().length > 0)
    .map(t => ({
      type: 'vocab' as const,
      word: t.lemma,
      definition_zh: t.definition_zh,
      exampleFromText: t.bestSentence,
    }));
}
