import * as fs from 'fs';
import * as path from 'path';
import { WordToken } from '../nlp/types';
import { buildProperNounSet, saveNamesFile } from '../nlp/nameProtector';

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
  'lemma', 'pos', 'cefr_level', 'coverage_rank', 'global_frequency', 'definition_en', 'context_sentence', 'context_sentence_zh', 'definition_zh',
];

export function exportBeginnerWordsSplit(
  tokens: WordToken[],
  outputDir: string,
  deckName: string,
  splitSize: number,
  cutoffIndex?: number
): string[] {
  const tokensToExport = cutoffIndex !== undefined ? tokens.slice(0, cutoffIndex) : tokens;
  const slug = deckName.replace(/[^a-z0-9一-鿿]+/gi, '-').replace(/^-|-$/g, '');
  const total = Math.ceil(tokensToExport.length / splitSize);
  const pad = String(total).length;
  fs.mkdirSync(outputDir, { recursive: true });

  const paths: string[] = [];
  for (let i = 0; i < tokensToExport.length; i += splitSize) {
    const chunk = tokensToExport.slice(i, i + splitSize);
    const partNum = String(Math.floor(i / splitSize) + 1).padStart(pad < 2 ? 2 : pad, '0');
    const filename = `${slug}-beginner-words-part-${partNum}.csv`;
    const outputPath = path.join(outputDir, filename);

    const lines: string[] = [row(WORDS_HEADERS)];
    for (const token of chunk) {
      lines.push(row([
        token.lemma,
        token.pos,
        token.cefrLevel,
        String(token.coverageRank),
        String(token.globalFrequency),
        '',               // definition_en：留空供 MW 預查填入
        token.bestSentence,
        '',               // context_sentence_zh：留空供翻譯填入
        token.definition_zh,
      ]));
    }
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    paths.push(outputPath);
  }
  return paths;
}

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
      String(token.globalFrequency),
      '',               // definition_en：留空供 MW 預查填入
      token.bestSentence,
      '',               // context_sentence_zh：留空供翻譯填入
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

// 從所有 token 的 bestSentence 提取人名，輸出到 *-beginner-names.txt
// 使用者可在翻譯前確認與修改，--deepl 時自動讀取
export function exportBeginnerNamesFile(
  tokens: WordToken[],
  deckName: string,
  outputDir: string,
): string {
  const sentences = tokens.map(t => t.bestSentence).filter(Boolean);
  const names = buildProperNounSet(sentences);
  const slug = deckName.replace(/[^a-z0-9一-鿿]+/gi, '-').replace(/^-|-$/g, '');
  const outputPath = path.join(outputDir, `${slug}-beginner-names.txt`);
  fs.mkdirSync(outputDir, { recursive: true });
  saveNamesFile(names, outputPath);
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
