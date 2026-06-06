import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards } from '../cards/types';

const HEADERS = [
  'type', 'word', 'definition_zh', 'exampleFromText',
  'text', 'hint_zh', 'name', 'description_zh', 'firstMention',
  'question_zh', 'answer_zh', 'ai_hint',
];

function escapeField(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function row(fields: string[]): string {
  return fields.map(escapeField).join(',');
}

export function exportToCsv(cards: GeneratedCards, deckName: string, outputDir: string): string {
  const lines: string[] = [row(HEADERS)];

  for (const c of cards.vocab) {
    const hint = `請為英文單字「${c.word}」提供繁體中文定義，參考例句：${c.exampleFromText}`;
    lines.push(row([
      'vocab', c.word, c.definition_zh, c.exampleFromText,
      '', '', '', '', '', '', '', hint,
    ]));
  }

  for (const c of cards.cloze) {
    const hint = `請為此克漏字填入繁體中文提示說明，句子：${c.text}`;
    lines.push(row([
      'cloze', '', '', '', c.text, c.hint_zh,
      '', '', '', '', '', hint,
    ]));
  }

  for (const c of cards.character) {
    const hint = `請根據以下提及描述「${c.name}」的身份與特色（繁體中文）：${c.firstMention}`;
    lines.push(row([
      'character', '', '', '', '', '',
      c.name, c.description_zh, c.firstMention, '', '', hint,
    ]));
  }

  for (const c of cards.plot) {
    const hint = `請根據小說段落回答：${c.question_zh}`;
    lines.push(row([
      'plot', '', '', '', '', '', '', '', '',
      c.question_zh, c.answer_zh, hint,
    ]));
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${deckName}.csv`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}
