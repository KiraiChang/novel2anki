import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards } from '../cards/types';
import { scoreMention } from './exporter';

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
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

export function importFromCsv(csvPath: string): GeneratedCards {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { vocab: [], cloze: [], character: [], plot: [] };

  const headers = parseRow(lines[0]);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const result: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const get = (col: string) => cols[idx[col]] ?? '';
    const type = get('type');

    if (type === 'vocab') {
      result.vocab.push({ type: 'vocab', word: get('word'), definition_zh: get('definition_zh'), exampleFromText: get('exampleFromText') });
    } else if (type === 'cloze') {
      result.cloze.push({ type: 'cloze', text: get('text'), hint_zh: get('hint_zh') });
    } else if (type === 'character') {
      result.character.push({ type: 'character', name: get('name'), description_zh: get('description_zh'), firstMention: get('firstMention') });
    } else if (type === 'plot') {
      result.plot.push({ type: 'plot', question_zh: get('question_zh'), answer_zh: get('answer_zh') });
    }
  }
  return result;
}

export function resolveCsvPaths(input: string): string[] {
  try {
    if (fs.statSync(input).isDirectory()) {
      return fs.readdirSync(input)
        .filter(f => f.toLowerCase().endsWith('.csv'))
        .sort()
        .map(f => path.join(input, f));
    }
  } catch { /* 不是目錄或不存在，繼續往下判斷 */ }

  if (input.includes(',')) {
    return input.split(',').map(p => p.trim()).filter(Boolean);
  }

  return [input];
}

export function importFromCsvFiles(paths: string[]): GeneratedCards {
  const merged: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };
  for (const p of paths) {
    const cards = importFromCsv(p);
    merged.vocab.push(...cards.vocab);
    merged.cloze.push(...cards.cloze);
    merged.character.push(...cards.character);
    merged.plot.push(...cards.plot);
  }

  // 跨檔案依 name 去重，保留 firstMention 分數最高的那張
  const charMap = new Map<string, GeneratedCards['character'][number]>();
  for (const c of merged.character) {
    const existing = charMap.get(c.name);
    if (!existing || scoreMention(c.firstMention) > scoreMention(existing.firstMention)) {
      charMap.set(c.name, c);
    }
  }
  merged.character = [...charMap.values()];

  return merged;
}
