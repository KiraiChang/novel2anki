import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards } from '../cards/types';
import { EnrichedChunk } from '../nlp/types';

export interface ChunkResult {
  chunk: EnrichedChunk;
  cards: GeneratedCards;
}

const HEADERS = [
  'type', 'source_title', 'word', 'definition_zh', 'exampleFromText',
  'text', 'hint_zh', 'name', 'description_zh', 'firstMention',
  'question_zh', 'answer_zh', 'ai_hint',
];

const ROLE_PREFIX = '你是英文小說語言學習字卡製作助手，請協助製作 Anki 字卡。只回傳填入欄位的內容，不要加說明或標題。';

function escapeField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function row(fields: string[]): string {
  return fields.map(escapeField).join(',');
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
}

function buildCardRows(cards: GeneratedCards, deckName: string): string[] {
  const lines: string[] = [];

  for (const c of cards.vocab) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請為英文單字「${c.word}」提供繁體中文定義，限25字內；若有多個詞性請選最符合例句語意的那個。`,
      `參考例句：${c.exampleFromText}`,
    ].join('\n');
    lines.push(row(['vocab', deckName, c.word, c.definition_zh, c.exampleFromText, '', '', '', '', '', '', hint]));
  }

  for (const c of cards.cloze) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請為以下克漏字句子填入繁體中文提示說明，限15字內，說明填空處的語意角色（例如：表示「頻率」的副詞）。`,
      `句子：${c.text}`,
    ].join('\n');
    lines.push(row(['cloze', deckName, '', '', '', c.text, c.hint_zh, '', '', '', '', hint]));
  }

  for (const c of cards.character) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請根據以下原文描述「${c.name}」的身份與特色，回傳2至3句繁體中文說明；若無法從原文判斷身份，請回傳「（原文中為地名／概念）」。`,
      `原文：${c.firstMention}`,
    ].join('\n');
    lines.push(row(['character', deckName, '', '', '', '', '', c.name, c.description_zh, c.firstMention, '', hint]));
  }

  for (const c of cards.plot) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請用繁體中文摘要回答以下問題，限60字內，涵蓋主要事件；完成後將 answer_zh 欄的英文原文替換為此摘要。`,
      `問題：${c.question_zh}`,
      `段落原文：${c.answer_zh}`,
    ].join('\n');
    lines.push(row(['plot', deckName, '', '', '', '', '', '', '', '', c.question_zh, c.answer_zh, hint]));
  }

  return lines;
}

function writeCsv(filePath: string, cardLines: string[]): void {
  fs.writeFileSync(filePath, [row(HEADERS), ...cardLines].join('\n'), 'utf-8');
}

function mergeCards(results: ChunkResult[]): GeneratedCards {
  const merged: GeneratedCards = { vocab: [], cloze: [], character: [], plot: [] };
  for (const { cards } of results) {
    merged.vocab.push(...cards.vocab);
    merged.cloze.push(...cards.cloze);
    merged.character.push(...cards.character);
    merged.plot.push(...cards.plot);
  }
  return merged;
}

export function exportToCsv(cards: GeneratedCards, deckName: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${deckName}.csv`);
  writeCsv(filePath, buildCardRows(cards, deckName));
  return filePath;
}

export function exportToCsvSplits(
  results: ChunkResult[],
  deckName: string,
  outputDir: string,
  splitBy: 'chapter' | 'size',
  splitSize: number = 10,
): string[] {
  fs.mkdirSync(outputDir, { recursive: true });

  const groups: Array<{ name: string; results: ChunkResult[] }> = [];

  if (splitBy === 'chapter') {
    const seen = new Map<string, ChunkResult[]>();
    const order: string[] = [];
    for (const r of results) {
      const key = r.chunk.chapter ? slugify(r.chunk.chapter) : 'unnamed';
      if (!seen.has(key)) { seen.set(key, []); order.push(key); }
      seen.get(key)!.push(r);
    }
    for (const key of order) {
      groups.push({ name: `${deckName}-ch-${key}`, results: seen.get(key)! });
    }
  } else {
    for (let i = 0; i < results.length; i += splitSize) {
      const partNum = String(Math.floor(i / splitSize) + 1).padStart(2, '0');
      groups.push({ name: `${deckName}-part-${partNum}`, results: results.slice(i, i + splitSize) });
    }
  }

  return groups.map(({ name, results: g }) => {
    const filePath = path.join(outputDir, `${name}.csv`);
    writeCsv(filePath, buildCardRows(mergeCards(g), deckName));
    return filePath;
  });
}
