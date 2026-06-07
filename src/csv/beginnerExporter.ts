import * as fs from 'fs';
import * as path from 'path';
import { WordToken } from '../nlp/types';

const HEADERS = [
  'token_id', 'lemma', 'original', 'pos', 'cefr_level', 'global_frequency',
  'coverage_rank', 'best_sentence', 'source_chunk', 'source_chapter',
  'definition_zh', 'ai_hint',
];

const ROLE_PREFIX = '你是英文學習助手，請協助翻譯英文單字。只回傳填入欄位的內容，不要加說明或標題。';

function escapeField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function row(fields: string[]): string {
  return fields.map(escapeField).join(',');
}

function buildAiHint(token: WordToken, deckName: string): string {
  return [
    ROLE_PREFIX,
    `書名：${deckName}`,
    `請為英文單字「${token.lemma}」提供繁體中文定義，限20字內；請選最符合例句語意的詞性與含義。`,
    `詞性：${token.pos}`,
    `CEFR 等級：${token.cefrLevel}`,
    `參考例句：${token.bestSentence}`,
  ].join('\n');
}

const WORDS_HEADERS = [
  'lemma', 'pos', 'cefr_level', 'coverage_rank', 'context_sentence', 'definition_zh',
];

export function exportBeginnerWordsToCsv(
  tokens: WordToken[],
  outputDir: string,
  deckName: string,
  cutoffIndex?: number
): string {
  const tokensToExport = cutoffIndex !== undefined ? tokens.slice(0, cutoffIndex) : tokens;
  const lines: string[] = [row(WORDS_HEADERS)];

  for (const token of tokensToExport) {
    lines.push(row([
      token.lemma,
      token.pos,
      token.cefrLevel,
      String(token.coverageRank),
      token.bestSentence,
      token.definition_zh,
    ]));
  }

  const slug = deckName.replace(/[^a-z0-9一-鿿]+/gi, '-').replace(/^-|-$/g, '');
  const filename = `${slug}-beginner-words.csv`;
  const outputPath = path.join(outputDir, filename);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  return outputPath;
}

export function exportBeginnerTokensToCsv(
  tokens: WordToken[],
  deckName: string,
  outputDir: string,
  cutoffIndex?: number
): string {
  const tokensToExport = cutoffIndex !== undefined ? tokens.slice(0, cutoffIndex) : tokens;
  const lines: string[] = [row(HEADERS)];

  for (const token of tokensToExport) {
    lines.push(row([
      token.id,
      token.lemma,
      token.original,
      token.pos,
      token.cefrLevel,
      String(token.globalFrequency),
      String(token.coverageRank),
      token.bestSentence,
      String(token.sourceChunkIndex),
      token.sourceChapter ?? '',
      token.definition_zh,
      buildAiHint(token, deckName),
    ]));
  }

  const slug = deckName.replace(/[^a-z0-9一-鿿]+/gi, '-').replace(/^-|-$/g, '');
  const filename = `${slug}-beginner-tokens.csv`;
  const outputPath = path.join(outputDir, filename);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  return outputPath;
}
