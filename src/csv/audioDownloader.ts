import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getWordAudioDb } from '../nlp/wordAudioDb';

export function getDefaultAudioDir(): string {
  const base = process.env['WORD_CACHE_PATH'] ?? path.join(os.homedir(), '.novel2anki');
  return path.join(path.resolve(base), 'audio');
}

export type AudioDownloadStatus = 'downloaded' | 'skipped' | 'no-url' | 'error';

export interface AudioDownloadResult {
  downloaded: number;
  skipped:    number;
  noUrl:      number;
  errors:     number;
}

// ── minimal CSV parser (lemma column only) ──────────────────────────────────

function splitLines(content: string): string[] {
  const lines: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') {
      if (inQ && content[i + 1] === '"') { cur += '""'; i++; }
      else { inQ = !inQ; cur += ch; }
    } else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      if (cur.length > 0) lines.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let f = ''; i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { f += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else f += line[i++];
      }
      fields.push(f);
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

function collectLemmas(csvPaths: string[]): string[] {
  const seen = new Set<string>();
  for (const csvPath of csvPaths) {
    let content: string;
    try { content = fs.readFileSync(csvPath, 'utf-8'); } catch { continue; }
    const lines = splitLines(content);
    if (lines.length < 2) continue;
    const headers = parseRow(lines[0]);
    const lemmaIdx = headers.indexOf('lemma');
    if (lemmaIdx === -1) continue;
    for (let i = 1; i < lines.length; i++) {
      const cols = parseRow(lines[i]);
      const lemma = (cols[lemmaIdx] ?? '').trim().toLowerCase();
      if (lemma) seen.add(lemma);
    }
  }
  return Array.from(seen);
}

// ── public API ───────────────────────────────────────────────────────────────

export async function downloadBeginnerAudio(
  csvPaths: string[],
  audioDir?: string,
  onProgress?: (done: number, total: number, meta: { word: string; status: AudioDownloadStatus }) => void,
): Promise<AudioDownloadResult> {
  const dir = audioDir ?? getDefaultAudioDir();
  fs.mkdirSync(dir, { recursive: true });

  const words   = collectLemmas(csvPaths);
  const audioDb = getWordAudioDb();
  let downloaded = 0, skipped = 0, noUrl = 0, errors = 0;

  for (let i = 0; i < words.length; i++) {
    const word     = words[i];
    const destPath = path.join(dir, `${word}.mp3`);

    if (fs.existsSync(destPath)) {
      skipped++;
      onProgress?.(i + 1, words.length, { word, status: 'skipped' });
      continue;
    }

    const url = audioDb.get(word);
    if (!url) {
      noUrl++;
      onProgress?.(i + 1, words.length, { word, status: 'no-url' });
      continue;
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
      downloaded++;
      onProgress?.(i + 1, words.length, { word, status: 'downloaded' });
    } catch {
      errors++;
      onProgress?.(i + 1, words.length, { word, status: 'error' });
    }
  }

  return { downloaded, skipped, noUrl, errors };
}
