import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from '../cards/types';

function escapHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// {{c1::word}} → <mark>word</mark>，其餘 cloze 標記一律展開
function renderCloze(text: string): string {
  return escapHtml(text).replace(/\{\{c\d+::([^}]+)\}\}/g, '<mark>$1</mark>');
}

function vocabSection(cards: VocabCard[]): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => `
    <div class="card vocab">
      <div class="word">${escapHtml(c.word)}</div>
      <div class="definition">${escapHtml(c.definition_zh)}</div>
      <div class="example">${escapHtml(c.exampleFromText)}</div>
    </div>`).join('');
  return `<section><h2>📚 詞彙卡（${cards.length} 張）</h2>${rows}</section>`;
}

function clozeSection(cards: ClozeCard[]): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => `
    <div class="card cloze">
      <div class="cloze-text">${renderCloze(c.text)}</div>
      <div class="hint">提示：${escapHtml(c.hint_zh)}</div>
    </div>`).join('');
  return `<section><h2>✏️ 克漏字（${cards.length} 張）</h2>${rows}</section>`;
}

function characterSection(cards: CharacterCard[]): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => `
    <div class="card character">
      <div class="character-name">${escapHtml(c.name)}</div>
      <div class="first-mention">${escapHtml(c.firstMention)}</div>
      <div class="description">${escapHtml(c.description_zh)}</div>
    </div>`).join('');
  return `<section><h2>🧑 人物概念卡（${cards.length} 張）</h2>${rows}</section>`;
}

function plotSection(cards: PlotCard[]): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => `
    <div class="card plot">
      <div class="plot-q">${escapHtml(c.question_zh)}</div>
      <div class="plot-a">${escapHtml(c.answer_zh)}</div>
    </div>`).join('');
  return `<section><h2>📖 情節問答（${cards.length} 張）</h2>${rows}</section>`;
}

function buildHtml(cards: GeneratedCards, deckName: string): string {
  const total = cards.vocab.length + cards.cloze.length + cards.character.length + cards.plot.length;
  const generated = new Date().toLocaleString('zh-TW', { hour12: false });

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapHtml(deckName)} — novel2anki 預覽</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif;
    font-size: 15px; line-height: 1.7; background: #f5f6fa; color: #2c3e50;
  }
  header {
    background: #2c3e50; color: #fff; padding: 28px 32px;
    position: sticky; top: 0; z-index: 10; box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
  header h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
  .meta { font-size: 13px; opacity: .75; }
  .stats { display: flex; gap: 20px; margin-top: 10px; flex-wrap: wrap; }
  .stat { background: rgba(255,255,255,.15); border-radius: 6px; padding: 4px 12px; font-size: 13px; }
  main { max-width: 860px; margin: 32px auto; padding: 0 16px 64px; }
  section { margin-bottom: 40px; }
  section h2 { font-size: 17px; font-weight: 700; margin-bottom: 14px;
    padding-bottom: 8px; border-bottom: 2px solid #dde; color: #34495e; }
  .card {
    background: #fff; border-radius: 10px; padding: 18px 22px;
    margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.07);
    border-left: 4px solid transparent;
  }
  /* vocab */
  .vocab { border-left-color: #3498db; }
  .word { font-size: 20px; font-weight: 700; color: #2980b9; margin-bottom: 6px; }
  .definition { color: #444; margin-bottom: 8px; }
  .example {
    color: #666; font-style: italic;
    border-left: 3px solid #aed6f1; padding-left: 10px; font-size: 14px;
  }
  /* cloze */
  .cloze { border-left-color: #2ecc71; }
  .cloze-text { font-size: 15px; margin-bottom: 8px; }
  mark { background: #d5f5e3; color: #1a7a3d; border-radius: 3px; padding: 0 3px; font-style: normal; }
  .hint { font-size: 13px; color: #888; }
  /* character */
  .character { border-left-color: #9b59b6; }
  .character-name { font-size: 18px; font-weight: 700; color: #8e44ad; margin-bottom: 6px; }
  .first-mention {
    font-size: 13px; color: #777; font-style: italic;
    border-left: 3px solid #d7bde2; padding-left: 10px; margin-bottom: 8px;
  }
  .description { color: #444; }
  /* plot */
  .plot { border-left-color: #e67e22; }
  .plot-q { font-weight: 700; color: #ca6f1e; margin-bottom: 8px; }
  .plot-a { color: #444; padding-left: 12px; border-left: 3px solid #f0b27a; }
  footer { text-align: center; font-size: 12px; color: #aaa; padding: 20px; }
</style>
</head>
<body>
<header>
  <h1>${escapHtml(deckName)}</h1>
  <div class="meta">由 novel2anki 產生 · ${generated}</div>
  <div class="stats">
    <span class="stat">📚 詞彙 ${cards.vocab.length}</span>
    <span class="stat">✏️ 克漏字 ${cards.cloze.length}</span>
    <span class="stat">🧑 人物 ${cards.character.length}</span>
    <span class="stat">📖 情節 ${cards.plot.length}</span>
    <span class="stat">合計 ${total} 張</span>
  </div>
</header>
<main>
${vocabSection(cards.vocab)}
${clozeSection(cards.cloze)}
${characterSection(cards.character)}
${plotSection(cards.plot)}
</main>
<footer>novel2anki · 克漏字以 <mark style="background:#d5f5e3;color:#1a7a3d;padding:0 3px;border-radius:3px">標記</mark> 顯示填空答案</footer>
</body>
</html>`;
}

export function exportToHtml(cards: GeneratedCards, deckName: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const outputPath = path.join(outputDir, `${safeName}.html`);
  fs.writeFileSync(outputPath, buildHtml(cards, deckName), 'utf-8');
  return outputPath;
}
