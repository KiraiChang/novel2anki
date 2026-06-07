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
    const exampleZh = get('context_sentence_zh').trim();
    cards.push({
      type: 'vocab',
      word: get('lemma'),
      definition_zh: get('definition_zh').trim(),
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

      if (!lemma || seen.has(lemma)) continue;
      seen.add(lemma);

      const exampleZh = get('context_sentence_zh').trim();
      ranked.push({
        card: {
          type: 'vocab' as const,
          word: lemma,
          definition_zh: get('definition_zh').trim(),
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

export interface WordStat {
  lemma: string;
  pos: string;
  cefr: string;
  rank: number;
  frequency: number;
  translated: boolean;
  definition_zh: string;
}

export interface BeginnerWordStats {
  total: number;
  translated: number;
  cefrDist: Record<string, number>;
  rankMin: number;
  rankMax: number;
  words: WordStat[];
}

export function computeBeginnerWordStats(csvPaths: string[]): BeginnerWordStats {
  const seen = new Set<string>();
  let total = 0;
  let translated = 0;
  const cefrDist: Record<string, number> = {};
  let rankMin = Infinity;
  let rankMax = 0;
  const words: WordStat[] = [];

  for (const csvPath of csvPaths) {
    let content: string;
    try { content = fs.readFileSync(csvPath, 'utf-8'); } catch { continue; }
    const lines = splitLines(content);
    if (lines.length < 2) continue;

    const headers = parseRow(lines[0]);
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const get = (col: string) => cols[idx[col]] ?? '';
      const lemma = get('lemma').trim();
      if (!lemma || seen.has(lemma)) continue;
      seen.add(lemma);

      total++;
      const def = get('definition_zh').trim();
      if (def) translated++;
      const cefr = get('cefr_level').trim() || 'UNKNOWN';
      cefrDist[cefr] = (cefrDist[cefr] ?? 0) + 1;
      const rank = parseInt(get('coverage_rank'), 10) || 0;
      const frequency = parseInt(get('global_frequency'), 10) || 0;
      if (rank > 0) {
        rankMin = Math.min(rankMin, rank);
        rankMax = Math.max(rankMax, rank);
      }
      words.push({ lemma, pos: get('pos').trim(), cefr, rank, frequency, translated: !!def, definition_zh: def });
    }
  }

  words.sort((a, b) => a.rank - b.rank);
  return { total, translated, cefrDist, rankMin: isFinite(rankMin) ? rankMin : 0, rankMax, words };
}

export function mergeTokensToVocabCards(tokens: WordToken[]): VocabCard[] {
  return tokens.map(t => ({
    type: 'vocab' as const,
    word: t.lemma,
    definition_zh: t.definition_zh,
    exampleFromText: t.bestSentence,
  }));
}
