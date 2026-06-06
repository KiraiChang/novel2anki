import * as fs from 'fs';
import * as path from 'path';
import { ReadingCards } from '../cards/readingTypes';

const ROLE_PREFIX = '你是英文小說語言學習字卡製作助手，請協助製作 Anki 字卡。只回傳填入欄位的內容，不要加說明或標題。';

const HEADERS = [
  'type', 'cardClass', 'source_title', 'word_or_name', 'definition_zh',
  'exampleFromText', 'frequency', 'question_zh', 'answer_zh', 'ai_hint',
];

function escapeField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function row(fields: string[]): string {
  return fields.map(escapeField).join(',');
}

function buildReadingRows(cards: ReadingCards, deckName: string): string[] {
  const lines: string[] = [];

  for (const c of cards.terms) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請說明「${c.word}」在本書中的含義與角色（非通用英文定義），限30字內。`,
      `出現次數：${c.frequency} 次`,
      `代表例句：${c.exampleFromText}`,
    ].join('\n');
    lines.push(row([
      'vocab', 'reading-term', deckName, c.word, c.definition_zh,
      c.exampleFromText, String(c.frequency), '', '', hint,
    ]));
  }

  for (const c of cards.causes) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請用繁體中文解釋以下因果關係，說明原因與結果，限50字內。`,
      `原文：${c.answer_zh}`,
    ].join('\n');
    lines.push(row([
      'plot', 'reading-cause', deckName, '', '',
      '', '', c.question_zh, c.answer_zh, hint,
    ]));
  }

  for (const c of cards.chapters) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請根據以下章節的開頭與結尾，用繁體中文摘要這章的核心事件，限60字內。`,
      `章節內容：${c.answer_zh}`,
    ].join('\n');
    lines.push(row([
      'plot', 'reading-chapter', deckName, '', '',
      '', '', c.question_zh, c.answer_zh, hint,
    ]));
  }

  for (const c of cards.themes) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `「${c.name}」在本書中反覆出現（共 ${c.frequency} 次），請用繁體中文說明它在故事中象徵或代表什麼，限40字內。`,
      `代表例句：${c.firstMention}`,
    ].join('\n');
    lines.push(row([
      'character', 'reading-theme', deckName, c.name, c.description_zh,
      c.firstMention, String(c.frequency), '', '', hint,
    ]));
  }

  return lines;
}

export function exportReadingToCsv(
  cards: ReadingCards,
  deckName: string,
  outputDir: string,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${deckName}-reading.csv`);
  const lines = buildReadingRows(cards, deckName);
  fs.writeFileSync(filePath, [row(HEADERS), ...lines].join('\n'), 'utf-8');
  return filePath;
}
