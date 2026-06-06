import * as fs from 'fs';
import * as path from 'path';
import {
  ReadingCards, ReadingTermCard, ReadingCauseCard,
  ReadingChapterCard, ReadingThemeCard,
} from '../cards/readingTypes';

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

function buildTermRows(terms: ReadingTermCard[], deckName: string): string[] {
  return terms.map(c => {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請說明「${c.word}」在本書中的含義與角色（非通用英文定義），限30字內。`,
      `出現次數：${c.frequency} 次`,
      `代表例句：${c.exampleFromText}`,
    ].join('\n');
    return row([
      'vocab', 'reading-term', deckName, c.word, c.definition_zh,
      c.exampleFromText, String(c.frequency), '', '', hint,
    ]);
  });
}

function buildCauseRows(causes: ReadingCauseCard[], deckName: string): string[] {
  return causes.map(c => {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請用繁體中文解釋以下因果關係，說明原因與結果，限50字內。`,
      `原文：${c.answer_zh}`,
    ].join('\n');
    return row([
      'plot', 'reading-cause', deckName, '', '',
      '', '', c.question_zh, c.answer_zh, hint,
    ]);
  });
}

function buildChapterRows(chapters: ReadingChapterCard[], deckName: string): string[] {
  return chapters.map(c => {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請根據以下章節的開頭與結尾，用繁體中文摘要這章的核心事件，限60字內。`,
      `章節內容：${c.answer_zh}`,
    ].join('\n');
    return row([
      'plot', 'reading-chapter', deckName, '', '',
      '', '', c.question_zh, c.answer_zh, hint,
    ]);
  });
}

function buildThemeRows(themes: ReadingThemeCard[], deckName: string): string[] {
  return themes.map(c => {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `「${c.name}」在本書中反覆出現（共 ${c.frequency} 次），請用繁體中文說明它在故事中象徵或代表什麼，限40字內。`,
      `代表例句：${c.firstMention}`,
    ].join('\n');
    return row([
      'character', 'reading-theme', deckName, c.name, c.description_zh,
      c.firstMention, String(c.frequency), '', '', hint,
    ]);
  });
}

function buildReadingRows(cards: ReadingCards, deckName: string): string[] {
  return [
    ...buildTermRows(cards.terms, deckName),
    ...buildCauseRows(cards.causes, deckName),
    ...buildChapterRows(cards.chapters, deckName),
    ...buildThemeRows(cards.themes, deckName),
  ];
}

export function exportReadingToCsv(
  cards: ReadingCards,
  deckName: string,
  outputDir: string,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const filePath = path.join(outputDir, `${safeName}-reading.csv`);
  const lines = buildReadingRows(cards, deckName);
  fs.writeFileSync(filePath, [row(HEADERS), ...lines].join('\n'), 'utf-8');
  return filePath;
}

export function exportReadingToCsvSplits(
  cards: ReadingCards,
  deckName: string,
  outputDir: string,
  chunkSize?: number,
): string[] {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');

  const sections = [
    { label: 'terms',    rows: buildTermRows(cards.terms, deckName) },
    { label: 'causes',   rows: buildCauseRows(cards.causes, deckName) },
    { label: 'chapters', rows: buildChapterRows(cards.chapters, deckName) },
    { label: 'themes',   rows: buildThemeRows(cards.themes, deckName) },
  ].filter(s => s.rows.length > 0);

  const typeDigits = Math.max(2, String(sections.length).length);
  const paths: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const { label, rows } = sections[i];
    const typeSeq = String(i + 1).padStart(typeDigits, '0');

    if (!chunkSize || rows.length <= chunkSize) {
      const filePath = path.join(outputDir, `${safeName}-reading-ch-${typeSeq}-${label}.csv`);
      fs.writeFileSync(filePath, [row(HEADERS), ...rows].join('\n'), 'utf-8');
      paths.push(filePath);
    } else {
      // 超過上限：細分為多個 part
      const parts: string[][] = [];
      for (let j = 0; j < rows.length; j += chunkSize) {
        parts.push(rows.slice(j, j + chunkSize));
      }
      const partDigits = Math.max(2, String(parts.length).length);
      for (let p = 0; p < parts.length; p++) {
        const partSeq = String(p + 1).padStart(partDigits, '0');
        const filePath = path.join(
          outputDir,
          `${safeName}-reading-ch-${typeSeq}-${partSeq}-${label}.csv`,
        );
        fs.writeFileSync(filePath, [row(HEADERS), ...parts[p]].join('\n'), 'utf-8');
        paths.push(filePath);
      }
    }
  }

  return paths;
}
