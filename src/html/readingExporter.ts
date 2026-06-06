import * as fs from 'fs';
import * as path from 'path';
import { ReadingCards } from '../cards/readingTypes';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}

const CSS = `
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f5f5f5; color: #222; }
header { background: #1a237e; color: #fff; padding: 1.2rem 2rem; }
header h1 { font-size: 1.4rem; }
header p  { font-size: 0.85rem; opacity: 0.8; margin-top: 0.25rem; }
.section { max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
.section h2 { font-size: 1.1rem; font-weight: 700; color: #1a237e;
              border-bottom: 2px solid #1a237e; padding-bottom: 0.4rem; margin-bottom: 1rem; }
.section .count { font-size: 0.8rem; color: #666; font-weight: normal; margin-left: 0.5rem; }
.card { background: #fff; border-radius: 8px; padding: 1rem 1.2rem;
        margin-bottom: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,.1);
        cursor: pointer; transition: box-shadow .15s; }
.card:hover { box-shadow: 0 3px 8px rgba(0,0,0,.15); }
.card-front { display: flex; align-items: baseline; gap: 0.75rem; }
.card-word  { font-size: 1.2rem; font-weight: 700; color: #1a237e; }
.card-freq  { font-size: 0.75rem; color: #888; }
.card-example { font-size: 0.85rem; color: #555; margin-top: 0.35rem;
                font-style: italic; line-height: 1.5; }
.card-back  { display: none; margin-top: 0.75rem; padding-top: 0.75rem;
              border-top: 1px solid #e0e0e0; font-size: 0.9rem; color: #333; line-height: 1.6; }
.card.revealed .card-back { display: block; }
.card-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
              letter-spacing: .05em; padding: 0.15rem 0.5rem; border-radius: 99px;
              margin-bottom: 0.5rem; display: inline-block; }
.label-term    { background: #e3f2fd; color: #0d47a1; }
.label-cause   { background: #fff3e0; color: #e65100; }
.label-chapter { background: #e8f5e9; color: #1b5e20; }
.label-theme   { background: #f3e5f5; color: #4a148c; }
.question { font-weight: 600; font-size: 0.95rem; }
.answer   { white-space: pre-wrap; font-size: 0.85rem; color: #555;
            font-style: italic; margin-top: 0.5rem; }
.toggle-hint { font-size: 0.75rem; color: #aaa; margin-top: 0.5rem; }
</style>`;

function termSection(cards: ReadingCards['terms']): string {
  if (cards.length === 0) return '';
  const items = cards.map(c => `
    <div class="card" onclick="this.classList.toggle('revealed')">
      <div class="card-label label-term">術語</div>
      <div class="card-front">
        <span class="card-word">${escHtml(c.word)}</span>
        <span class="card-freq">出現 ${c.frequency} 次</span>
      </div>
      <div class="card-example">${escHtml(c.exampleFromText)}</div>
      <div class="card-back">${c.definition_zh ? escHtml(c.definition_zh) : '<em style="color:#aaa">（尚未填入定義）</em>'}</div>
      <div class="toggle-hint">點擊顯示 / 隱藏解釋</div>
    </div>`).join('');
  return `<div class="section">
    <h2>關鍵術語 <span class="count">${cards.length} 張</span></h2>${items}</div>`;
}

function causeSection(cards: ReadingCards['causes']): string {
  if (cards.length === 0) return '';
  const items = cards.map(c => `
    <div class="card" onclick="this.classList.toggle('revealed')">
      <div class="card-label label-cause">因果事件</div>
      <div class="question">${escHtml(c.question_zh)}</div>
      <div class="card-back">
        <div class="answer">${escHtml(c.answer_zh)}</div>
      </div>
      <div class="toggle-hint">點擊顯示 / 隱藏原文</div>
    </div>`).join('');
  return `<div class="section">
    <h2>因果事件 <span class="count">${cards.length} 張</span></h2>${items}</div>`;
}

function chapterSection(cards: ReadingCards['chapters']): string {
  if (cards.length === 0) return '';
  const items = cards.map(c => `
    <div class="card" onclick="this.classList.toggle('revealed')">
      <div class="card-label label-chapter">章節脈絡</div>
      <div class="question">${escHtml(c.question_zh)}</div>
      <div class="card-back">
        <div class="answer">${escHtml(c.answer_zh)}</div>
      </div>
      <div class="toggle-hint">點擊顯示 / 隱藏首尾句</div>
    </div>`).join('');
  return `<div class="section">
    <h2>章節脈絡 <span class="count">${cards.length} 張</span></h2>${items}</div>`;
}

function themeSection(cards: ReadingCards['themes']): string {
  if (cards.length === 0) return '';
  const items = cards.map(c => `
    <div class="card" onclick="this.classList.toggle('revealed')">
      <div class="card-label label-theme">主題意象</div>
      <div class="card-front">
        <span class="card-word">${escHtml(c.name)}</span>
        <span class="card-freq">出現 ${c.frequency} 次</span>
      </div>
      <div class="card-example">${escHtml(c.firstMention)}</div>
      <div class="card-back">${c.description_zh ? escHtml(c.description_zh) : '<em style="color:#aaa">（尚未填入象徵意義）</em>'}</div>
      <div class="toggle-hint">點擊顯示 / 隱藏解析</div>
    </div>`).join('');
  return `<div class="section">
    <h2>主題意象 <span class="count">${cards.length} 張</span></h2>${items}</div>`;
}

export function exportReadingToHtml(
  cards: ReadingCards,
  deckName: string,
  outputDir: string,
): string {
  const total = cards.terms.length + cards.causes.length +
    cards.chapters.length + cards.themes.length;

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(deckName)} — 讀書理解字卡</title>
${CSS}
</head>
<body>
<header>
  <h1>${escHtml(deckName)} — 讀書理解字卡</h1>
  <p>共 ${total} 張 ／ 術語 ${cards.terms.length} ／ 因果 ${cards.causes.length} ／ 章節 ${cards.chapters.length} ／ 主題 ${cards.themes.length}</p>
</header>
${termSection(cards.terms)}
${causeSection(cards.causes)}
${chapterSection(cards.chapters)}
${themeSection(cards.themes)}
</body>
</html>`;

  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${deckName}-reading.html`);
  fs.writeFileSync(filePath, html, 'utf-8');
  return filePath;
}
