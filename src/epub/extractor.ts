import * as path from 'path';
import { EPub } from 'epub2';
import { Chunk } from '../cards/types';

const CHUNK_TARGET_CHARS = 3000;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitIntoChunks(text: string, chapterTitle: string | undefined, startIndex: number): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(p => p.length > 20);

  const chunks: Chunk[] = [];
  let current = '';
  let idx = startIndex;

  for (const para of paragraphs) {
    current += (current ? '\n\n' : '') + para;
    if (current.length >= CHUNK_TARGET_CHARS) {
      chunks.push({ index: idx++, text: current.trim(), chapter: chapterTitle });
      current = '';
    }
  }
  if (current.trim()) {
    chunks.push({ index: idx++, text: current.trim(), chapter: chapterTitle });
  }
  return chunks;
}

export async function extractChunks(filePath: string): Promise<Chunk[]> {
  const epub = await EPub.createAsync(path.resolve(filePath));

  const allChunks: Chunk[] = [];
  let globalIndex = 0;

  for (const item of epub.spine.contents) {
    const id: string = item.id;
    const chapterTitle: string | undefined = epub.toc.find((t: { id: string; title: string }) => t.id === id)?.title;

    let html: string;
    try {
      html = await epub.getChapterAsync(id);
    } catch {
      continue;
    }

    const text = stripHtml(html);
    if (text.length < 50) continue;

    const chunks = splitIntoChunks(text, chapterTitle, globalIndex);
    allChunks.push(...chunks);
    globalIndex += chunks.length;
  }

  return allChunks;
}
