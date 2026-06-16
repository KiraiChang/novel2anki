import * as fs from 'fs';
import { getWordDefDb } from '../nlp/wordDefDb';

function escapeField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

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

export interface CsvToDefDbResult {
  saved:   number;
  skipped: number;
}

/**
 * CSV → SQLite：把 definition_en / definition_zh 寫入 word-def.db。
 * 跳過條件：definition_zh 為空、definition_en 為空、key 已存在。
 * source 取自 definition_zh_source 欄位。
 */
export function syncCsvToWordDefDb(
  csvPath: string,
  onProgress?: (cur: number, total: number) => void,
): CsvToDefDbResult {
  const db = getWordDefDb();
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { saved: 0, skipped: 0 };

  const headers = parseRow(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const iLemma  = idx('lemma');
  const iPos    = idx('pos');
  const iDefEn  = idx('definition_en');
  const iDefZh  = idx('definition_zh');
  const iSrc    = idx('definition_zh_source');
  if (iLemma < 0 || iPos < 0 || iDefEn < 0 || iDefZh < 0) return { saved: 0, skipped: 0 };

  const dataLines = lines.slice(1);
  let saved = 0;
  let skipped = 0;

  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseRow(dataLines[i]);
    const lemma  = (fields[iLemma]  ?? '').trim();
    const pos    = (fields[iPos]    ?? '').trim();
    const defEn  = (fields[iDefEn]  ?? '').trim();
    const defZh  = (fields[iDefZh]  ?? '').trim();
    const source = (iSrc >= 0 ? fields[iSrc] ?? '' : '').trim();

    // definition_zh 為空時不寫入
    if (!lemma || !pos || !defEn || !defZh) { skipped++; continue; }

    const inserted = db.set(lemma, pos, defEn, defZh, source);
    if (inserted) saved++; else skipped++;

    onProgress?.(i + 1, dataLines.length);
  }

  return { saved, skipped };
}

export interface DefDbToCsvResult {
  filled:    number;
  noMatch:   number;
  unchanged: number;
}

/**
 * SQLite → CSV：用 word-def.db 補填 CSV 中空白的 definition_zh。
 * 同步補填 definition_zh_source（若欄位存在）。
 */
export function syncWordDefDbToCsv(
  csvPath: string,
  onProgress?: (cur: number, total: number) => void,
): DefDbToCsvResult {
  const db = getWordDefDb();
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = splitLines(content);
  if (lines.length < 2) return { filled: 0, noMatch: 0, unchanged: 0 };

  const headers = parseRow(lines[0]);
  const idx = (name: string) => headers.indexOf(name);

  const iLemma = idx('lemma');
  const iPos   = idx('pos');
  const iDefEn = idx('definition_en');
  const iDefZh = idx('definition_zh');
  const iSrc   = idx('definition_zh_source');
  if (iLemma < 0 || iPos < 0 || iDefEn < 0 || iDefZh < 0) {
    return { filled: 0, noMatch: 0, unchanged: 0 };
  }

  const dataLines = lines.slice(1);
  let filled    = 0;
  let noMatch   = 0;
  let unchanged = 0;
  let anyChange = false;

  const updatedLines: string[] = [lines[0]];

  for (let i = 0; i < dataLines.length; i++) {
    const fields = parseRow(dataLines[i]);
    const lemma  = (fields[iLemma]  ?? '').trim();
    const pos    = (fields[iPos]    ?? '').trim();
    const defEn  = (fields[iDefEn]  ?? '').trim();
    const defZh  = (fields[iDefZh]  ?? '').trim();

    if (!lemma || !pos || !defEn || defZh !== '') {
      updatedLines.push(dataLines[i]);
      unchanged++;
      onProgress?.(i + 1, dataLines.length);
      continue;
    }

    const entry = db.get(lemma, pos, defEn);
    if (entry && entry.zh) {
      fields[iDefZh] = entry.zh;
      if (iSrc >= 0) fields[iSrc] = entry.source;
      updatedLines.push(fields.map(escapeField).join(','));
      filled++;
      anyChange = true;
    } else {
      updatedLines.push(dataLines[i]);
      noMatch++;
    }

    onProgress?.(i + 1, dataLines.length);
  }

  if (anyChange) {
    fs.writeFileSync(csvPath, updatedLines.join('\n'), 'utf-8');
  }

  return { filled, noMatch, unchanged };
}
