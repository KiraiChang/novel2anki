import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
import { Chunk } from '../cards/types';

const CHAPTER_PATTERN = /^[A-Z\s]{5,}$|^(chapter|part|book)\s+\w+/i;
const CHUNK_TARGET_CHARS = 3000;

export async function extractChunks(filePath: string): Promise<Chunk[]> {
  const buffer = fs.readFileSync(path.resolve(filePath));
  const data = await pdfParse(buffer);
  const fullText: string = data.text;

  const paragraphs = fullText
    .split(/\n{2,}/)
    .map((p: string) => p.replace(/\n/g, ' ').trim())
    .filter((p: string) => p.length > 20);

  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentChapter: string | undefined;
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (CHAPTER_PATTERN.test(paragraph.trim()) && paragraph.length < 80) {
      if (currentChunk.trim()) {
        chunks.push({ index: chunkIndex++, text: currentChunk.trim(), chapter: currentChapter });
        currentChunk = '';
      }
      currentChapter = paragraph.trim();
      continue;
    }

    currentChunk += (currentChunk ? '\n\n' : '') + paragraph;

    if (currentChunk.length >= CHUNK_TARGET_CHARS) {
      chunks.push({ index: chunkIndex++, text: currentChunk.trim(), chapter: currentChapter });
      currentChunk = '';
    }
  }

  if (currentChunk.trim()) {
    chunks.push({ index: chunkIndex++, text: currentChunk.trim(), chapter: currentChapter });
  }

  return chunks;
}
