import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from '../cards/types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 克漏字：{{c1::word}} → 可點擊的空格，點擊後顯示答案
function renderClozeInteractive(text: string): string {
  return escapeHtml(text).replace(
    /\{\{c\d+::([^}]+)\}\}/g,
    '<span class="blank-toggle" onclick="this.classList.toggle(\'open\')" title="點擊顯示答案">' +
      '<span class="blank-placeholder">＿＿＿</span>' +
      '<span class="blank-answer">$1</span>' +
    '</span>',
  );
}

// 比對頁面仍用靜態 mark 顯示
function renderClozeStatic(text: string): string {
  return escapeHtml(text).replace(/\{\{c\d+::([^}]+)\}\}/g, '<mark>$1</mark>');
}

function vocabSection(cards: VocabCard[], interactive = false): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => {
    if (!interactive) return `
    <div class="card vocab">
      <div class="word">${escapeHtml(c.word)}</div>
      <div class="definition">${escapeHtml(c.definition_zh)}</div>
      <div class="example">${escapeHtml(c.exampleFromText)}</div>
    </div>`;
    return `
    <div class="card vocab flip-card" tabindex="0" onclick="this.classList.toggle('revealed')" title="點擊顯示／隱藏中文">
      <div class="card-front">
        <div class="word">${escapeHtml(c.word)}</div>
        <div class="example">${escapeHtml(c.exampleFromText)}</div>
        <span class="toggle-hint">點擊顯示中文定義 ▼</span>
      </div>
      <div class="card-back">
        <div class="definition">${escapeHtml(c.definition_zh) || '<span class="empty">（尚未填入）</span>'}</div>
      </div>
    </div>`;
  }).join('');
  return `<section id="vocab"><h2>📚 詞彙卡（${cards.length} 張）</h2>${rows}</section>`;
}

function clozeSection(cards: ClozeCard[], interactive = false): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => `
    <div class="card cloze">
      <div class="cloze-text">${interactive ? renderClozeInteractive(c.text) : renderClozeStatic(c.text)}</div>
      ${c.hint_zh ? `<div class="hint">提示：${escapeHtml(c.hint_zh)}</div>` : ''}
      ${interactive ? '<div class="toggle-hint">點擊＿＿＿顯示答案</div>' : ''}
    </div>`).join('');
  return `<section id="cloze"><h2>✏️ 克漏字（${cards.length} 張）</h2>${rows}</section>`;
}

function characterSection(cards: CharacterCard[], interactive = false): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => {
    if (!interactive) return `
    <div class="card character">
      <div class="character-name">${escapeHtml(c.name)}</div>
      <div class="first-mention">${escapeHtml(c.firstMention)}</div>
      <div class="description">${escapeHtml(c.description_zh)}</div>
    </div>`;
    return `
    <div class="card character flip-card" tabindex="0" onclick="this.classList.toggle('revealed')" title="點擊顯示／隱藏中文">
      <div class="card-front">
        <div class="character-name">${escapeHtml(c.name)}</div>
        <div class="first-mention">${escapeHtml(c.firstMention)}</div>
        <span class="toggle-hint">點擊顯示中文描述 ▼</span>
      </div>
      <div class="card-back">
        <div class="description">${escapeHtml(c.description_zh) || '<span class="empty">（尚未填入）</span>'}</div>
      </div>
    </div>`;
  }).join('');
  return `<section id="character"><h2>🧑 人物概念卡（${cards.length} 張）</h2>${rows}</section>`;
}

function plotSection(cards: PlotCard[], interactive = false): string {
  if (cards.length === 0) return '';
  const rows = cards.map(c => {
    const qLines = escapeHtml(c.question_zh).replace(/\n/g, '<br>');
    const aContent = escapeHtml(c.answer_zh);
    if (!interactive) return `
    <div class="card plot">
      <div class="plot-q">${qLines}</div>
      <div class="plot-a">${aContent}</div>
    </div>`;
    // 判斷 answer 語言：含中文 → 摘要已翻譯；否則 → 英文原文
    const isChinese = /[一-鿿]/.test(c.answer_zh);
    const answerLabel = isChinese ? '中文摘要' : '英文原文';
    const toggleLabel = isChinese ? '切換英文／中文' : '顯示答案';
    return `
    <div class="card plot flip-card" tabindex="0" onclick="this.classList.toggle('revealed')" title="${toggleLabel}">
      <div class="card-front">
        <div class="plot-q">${qLines}</div>
        <span class="toggle-hint">${toggleLabel} ▼</span>
      </div>
      <div class="card-back">
        <div class="plot-label">${answerLabel}</div>
        <div class="plot-a">${aContent}</div>
      </div>
    </div>`;
  }).join('');
  return `<section id="plot"><h2>📖 情節問答（${cards.length} 張）</h2>${rows}</section>`;
}

function buildStatLinks(cards: GeneratedCards): string {
  const items = [
    { id: 'vocab',     label: '📚 詞彙',  count: cards.vocab.length },
    { id: 'cloze',     label: '✏️ 克漏字', count: cards.cloze.length },
    { id: 'character', label: '🧑 人物',   count: cards.character.length },
    { id: 'plot',      label: '📖 情節',   count: cards.plot.length },
  ];
  const total = items.reduce((s, i) => s + i.count, 0);
  const links = items
    .filter(i => i.count > 0)
    .map(i => `<a class="stat" href="#${i.id}">${i.label} ${i.count}</a>`)
    .join('');
  return links + `<span class="stat stat-total">合計 ${total} 張</span>`;
}

const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
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
  .stats { display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .stat {
    background: rgba(255,255,255,.15); border-radius: 6px; padding: 4px 12px; font-size: 13px;
    color: #fff; text-decoration: none; transition: background .15s;
  }
  a.stat:hover { background: rgba(255,255,255,.3); }
  .stat-total { opacity: .7; cursor: default; }
  main { max-width: 860px; margin: 32px auto; padding: 0 16px 64px; }
  section { margin-bottom: 40px; }
  section h2 { font-size: 17px; font-weight: 700; margin-bottom: 14px;
    padding-bottom: 8px; border-bottom: 2px solid #dde; color: #34495e; }
  .card {
    background: #fff; border-radius: 10px; padding: 18px 22px;
    margin-bottom: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.07);
    border-left: 4px solid transparent;
  }
  /* ── 互動卡片 ── */
  .flip-card { cursor: pointer; user-select: none; transition: box-shadow .15s; }
  .flip-card:hover { box-shadow: 0 3px 10px rgba(0,0,0,.13); }
  .flip-card:focus { outline: 2px solid #3498db; outline-offset: 2px; }
  .card-back { display: none; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ddd; }
  .flip-card.revealed .card-back { display: block; }
  .flip-card.revealed .toggle-hint { opacity: 0; }
  .toggle-hint { font-size: 12px; color: #aaa; margin-top: 6px; display: block; transition: opacity .15s; }
  .empty { color: #bbb; font-style: italic; }
  /* ── vocab ── */
  .vocab { border-left-color: #3498db; }
  .word { font-size: 20px; font-weight: 700; color: #2980b9; margin-bottom: 6px; }
  .definition { color: #444; margin-bottom: 4px; }
  .example {
    color: #666; font-style: italic;
    border-left: 3px solid #aed6f1; padding-left: 10px; font-size: 14px;
  }
  /* ── cloze ── */
  .cloze { border-left-color: #2ecc71; }
  .cloze-text { font-size: 15px; margin-bottom: 8px; }
  mark { background: #d5f5e3; color: #1a7a3d; border-radius: 3px; padding: 0 3px; font-style: normal; }
  .hint { font-size: 13px; color: #888; }
  .blank-toggle {
    display: inline-block; cursor: pointer; border-radius: 4px;
    background: #eaf3ff; border: 1px dashed #7fb3e8; padding: 0 6px; transition: background .15s;
  }
  .blank-toggle:hover { background: #d0e8ff; }
  .blank-answer { display: none; font-weight: 700; color: #1a7a3d; }
  .blank-placeholder { color: #7fb3e8; letter-spacing: 2px; }
  .blank-toggle.open .blank-placeholder { display: none; }
  .blank-toggle.open .blank-answer { display: inline; }
  .blank-toggle.open { background: #d5f5e3; border-color: #2ecc71; }
  /* ── character ── */
  .character { border-left-color: #9b59b6; }
  .character-name { font-size: 18px; font-weight: 700; color: #8e44ad; margin-bottom: 6px; }
  .first-mention {
    font-size: 13px; color: #777; font-style: italic;
    border-left: 3px solid #d7bde2; padding-left: 10px; margin-bottom: 4px;
  }
  .description { color: #444; }
  /* ── plot ── */
  .plot { border-left-color: #e67e22; }
  .plot-q { color: #2c3e50; white-space: pre-line; line-height: 1.6; }
  .plot-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .plot-a { color: #444; padding-left: 12px; border-left: 3px solid #f0b27a; white-space: pre-line; }
  footer { text-align: center; font-size: 12px; color: #aaa; padding: 20px; }
`;

function buildHtml(cards: GeneratedCards, deckName: string): string {
  const generated = new Date().toLocaleString('zh-TW', { hour12: false });
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(deckName)} — novel2anki 預覽</title>
<style>${SHARED_CSS}</style>
</head>
<body>
<header>
  <h1>${escapeHtml(deckName)}</h1>
  <div class="meta">由 novel2anki 產生 · ${generated}</div>
  <div class="stats">${buildStatLinks(cards)}</div>
</header>
<main>
${vocabSection(cards.vocab, true)}
${clozeSection(cards.cloze, true)}
${characterSection(cards.character, true)}
${plotSection(cards.plot, true)}
</main>
<footer>novel2anki · 詞彙／人物／情節卡點擊翻面 · 克漏字點擊空格顯示答案</footer>
</body>
</html>`;
}

function buildComparisonHtml(
  deeplCards: GeneratedCards,
  otherCards: GeneratedCards,
  otherLabel: string,
  deckName: string,
): string {
  const generated = new Date().toLocaleString('zh-TW', { hour12: false });
  const deeplTotal = deeplCards.vocab.length + deeplCards.cloze.length + deeplCards.character.length + deeplCards.plot.length;
  const otherTotal = otherCards.vocab.length + otherCards.cloze.length + otherCards.character.length + otherCards.plot.length;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(deckName)} — novel2anki 比對預覽</title>
<style>
  ${SHARED_CSS}
  .mode-block { margin-bottom: 48px; }
  .mode-header {
    font-size: 16px; font-weight: 700; padding: 10px 16px; border-radius: 8px;
    margin-bottom: 18px; display: flex; align-items: center; gap: 10px;
  }
  .mode-header.deepl { background: #eaf4fb; color: #1a6ea8; border-left: 5px solid #3498db; }
  .mode-header.other { background: #fef9ed; color: #8a5e0a; border-left: 5px solid #e67e22; }
  .mode-count { font-size: 13px; opacity: .7; margin-left: auto; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(deckName)}</h1>
  <div class="meta">novel2anki 比對預覽 · ${generated}</div>
</header>
<main>
  <div class="mode-block">
    <div class="mode-header deepl">🔵 DeepL 翻譯<span class="mode-count">${deeplTotal} 張</span></div>
    ${vocabSection(deeplCards.vocab)}
    ${clozeSection(deeplCards.cloze)}
    ${characterSection(deeplCards.character)}
    ${plotSection(deeplCards.plot)}
  </div>
  <div class="mode-block">
    <div class="mode-header other">🟠 ${escapeHtml(otherLabel)}<span class="mode-count">${otherTotal} 張</span></div>
    ${vocabSection(otherCards.vocab)}
    ${clozeSection(otherCards.cloze)}
    ${characterSection(otherCards.character)}
    ${plotSection(otherCards.plot)}
  </div>
</main>
<footer>novel2anki 比對預覽</footer>
</body>
</html>`;
}

export function exportToComparisonHtml(
  deeplCards: GeneratedCards,
  otherCards: GeneratedCards,
  otherLabel: string,
  deckName: string,
  outputDir: string,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const outputPath = path.join(outputDir, `${safeName}-compare.html`);
  fs.writeFileSync(outputPath, buildComparisonHtml(deeplCards, otherCards, otherLabel, deckName), 'utf-8');
  return outputPath;
}

export function exportToHtml(cards: GeneratedCards, deckName: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const outputPath = path.join(outputDir, `${safeName}.html`);
  fs.writeFileSync(outputPath, buildHtml(cards, deckName), 'utf-8');
  return outputPath;
}
