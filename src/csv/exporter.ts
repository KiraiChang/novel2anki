import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards } from '../cards/types';

const HEADERS = [
  'type', 'source_title', 'word', 'definition_zh', 'exampleFromText',
  'text', 'hint_zh', 'name', 'description_zh', 'firstMention',
  'question_zh', 'answer_zh', 'ai_hint',
];

const ROLE_PREFIX = '你是英文小說語言學習字卡製作助手，請協助製作 Anki 字卡。只回傳填入欄位的內容，不要加說明或標題。';

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
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請為英文單字「${c.word}」提供繁體中文定義，限25字內；若有多個詞性請選最符合例句語意的那個。`,
      `參考例句：${c.exampleFromText}`,
    ].join('\n');
    lines.push(row([
      'vocab', deckName, c.word, c.definition_zh, c.exampleFromText,
      '', '', '', '', '', '', hint,
    ]));
  }

  for (const c of cards.cloze) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請為以下克漏字句子填入繁體中文提示說明，限15字內，說明填空處的語意角色（例如：表示「頻率」的副詞）。`,
      `句子：${c.text}`,
    ].join('\n');
    lines.push(row([
      'cloze', deckName, '', '', '', c.text, c.hint_zh,
      '', '', '', '', hint,
    ]));
  }

  for (const c of cards.character) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請根據以下原文描述「${c.name}」的身份與特色，回傳2至3句繁體中文說明；若無法從原文判斷身份，請回傳「（原文中為地名／概念）」。`,
      `原文：${c.firstMention}`,
    ].join('\n');
    lines.push(row([
      'character', deckName, '', '', '', '', '',
      c.name, c.description_zh, c.firstMention, '', hint,
    ]));
  }

  for (const c of cards.plot) {
    const hint = [
      ROLE_PREFIX,
      `書名：${deckName}`,
      `請用繁體中文摘要回答以下問題，限60字內，涵蓋主要事件；完成後將 answer_zh 欄的英文原文替換為此摘要。`,
      `問題：${c.question_zh}`,
      `段落原文：${c.answer_zh}`,
    ].join('\n');
    lines.push(row([
      'plot', deckName, '', '', '', '', '', '', '', '',
      c.question_zh, c.answer_zh, hint,
    ]));
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${deckName}.csv`);
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return filePath;
}
