import * as fs from 'fs';
import * as path from 'path';
import { GeneratedCards, VocabCard, ClozeCard, CharacterCard, PlotCard } from '../cards/types';
import { ReadingCards } from '../cards/readingTypes';

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
      ${c.exampleZh ? `<div class="example-zh">${escapeHtml(c.exampleZh)}</div>` : ''}
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
        ${c.exampleZh ? `<div class="example-zh">${escapeHtml(c.exampleZh)}</div>` : ''}
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
  .example-zh {
    color: #888; font-size: 13px;
    border-left: 3px solid #aed6f1; padding-left: 10px; margin-top: 4px;
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

// ── Flash 單字卡模式 ─────────────────────────────────────────────────────────

interface FlashCard {
  primary: string;   // 大字（單字 / 人名 / 問題 / 克漏字句）
  secondary: string; // 小字（例句 / firstMention / ''）
  answer: string;    // 翻面後的答案
}

function buildFlashDeck(cards: GeneratedCards): Record<string, FlashCard[]> {
  return {
    vocab: cards.vocab.map(c => ({
      primary: c.word,
      secondary: c.exampleFromText,
      answer: (c.definition_zh || '（尚未填入定義）') + (c.exampleZh ? '\n\n' + c.exampleZh : ''),
    })),
    cloze: cards.cloze.map(c => ({
      primary: c.text.replace(/\{\{c\d+::([^}]+)\}\}/g, '___'),
      secondary: '',
      answer: (c.hint_zh ? '提示：' + c.hint_zh + '\n\n' : '') +
               c.text.replace(/\{\{c\d+::([^}]+)\}\}/g, '【$1】'),
    })),
    character: cards.character.map(c => ({
      primary: c.name,
      secondary: c.firstMention,
      answer: c.description_zh || '（尚未填入描述）',
    })),
    plot: cards.plot.map(c => ({
      primary: c.question_zh,
      secondary: '',
      answer: c.answer_zh,
    })),
  };
}

interface FlashTabConfig {
  id: string;
  label: string;
  color: string;
}

const STANDARD_TABS: FlashTabConfig[] = [
  { id: 'vocab',     label: '📚 詞彙',   color: '#3498db' },
  { id: 'cloze',     label: '✏️ 克漏字', color: '#27ae60' },
  { id: 'character', label: '🧑 人物',   color: '#9b59b6' },
  { id: 'plot',      label: '📖 情節',   color: '#e67e22' },
];

const READING_TABS: FlashTabConfig[] = [
  { id: 'terms',    label: '📚 術語',   color: '#0d47a1' },
  { id: 'causes',   label: '⚡ 因果',   color: '#e65100' },
  { id: 'chapters', label: '📖 章節',   color: '#1b5e20' },
  { id: 'themes',   label: '🎨 主題',   color: '#4a148c' },
];

const FLASH_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --accent: #3498db; }
html, body { height: 100%; }
body {
  font-family: 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif;
  background: #f0f4f8; color: #2c3e50;
  display: flex; flex-direction: column;
}
header {
  background: #2c3e50; color: #fff;
  padding: 14px 24px 0;
  position: sticky; top: 0; z-index: 10;
  box-shadow: 0 2px 10px rgba(0,0,0,.25);
}
.header-top { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
h1 { font-size: 17px; font-weight: 700; }
.meta { font-size: 11px; opacity: .55; }
.tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab {
  padding: 8px 18px; border: none; background: transparent;
  color: rgba(255,255,255,.6); font-size: 14px; cursor: pointer;
  border-bottom: 3px solid transparent; white-space: nowrap;
  transition: color .15s, border-color .15s; font-family: inherit;
}
.tab:hover { color: #fff; }
.tab.active { color: #fff; border-bottom-color: var(--tc, var(--accent)); }
.tab-n {
  display: inline-block; background: rgba(255,255,255,.18);
  border-radius: 10px; padding: 1px 7px; font-size: 11px; margin-left: 5px;
}
.tab.active .tab-n { background: rgba(255,255,255,.32); }
main {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; padding: 28px 16px 36px;
}
.progress { font-size: 14px; color: #999; margin-bottom: 14px; font-variant-numeric: tabular-nums; }
.card-wrap { width: 100%; max-width: 660px; perspective: 1200px; }
.flash-card {
  width: 100%; height: 280px; position: relative;
  cursor: pointer; outline: none;
}
.flash-card:focus .fc-inner { box-shadow: 0 0 0 3px rgba(52,152,219,.5); border-radius: 16px; }
.fc-inner {
  position: relative; width: 100%; height: 100%;
  transform-style: preserve-3d;
  transition: transform .42s cubic-bezier(.4,0,.2,1);
}
.flash-card.flipped .fc-inner { transform: rotateY(180deg); }
.fc-front, .fc-back {
  position: absolute; inset: 0; border-radius: 16px;
  padding: 28px 36px; backface-visibility: hidden;
  display: flex; flex-direction: column;
  justify-content: center; align-items: center; text-align: center;
  box-shadow: 0 4px 18px rgba(0,0,0,.11); overflow-y: auto;
}
.fc-front { background: #fff; border: 2px solid #e0e6f0; }
.fc-back  { background: #f0f7ff; border: 2px solid var(--accent); transform: rotateY(180deg); }
.fc-primary {
  font-size: 26px; font-weight: 700; color: #2c3e50;
  line-height: 1.45; word-break: break-word;
}
.fc-secondary {
  font-size: 13px; color: #888; font-style: italic;
  margin-top: 12px; line-height: 1.6; max-height: 80px; overflow-y: auto;
}
.fc-secondary:empty { display: none; }
.fc-flip-hint { font-size: 11px; color: #ccc; margin-top: auto; padding-top: 10px; }
.fc-answer {
  font-size: 18px; color: #2c3e50; line-height: 1.75;
  white-space: pre-line; text-align: center; word-break: break-word;
}
.nav {
  display: flex; align-items: center; gap: 10px; margin-top: 22px;
}
.nav-btn {
  padding: 10px 20px; border: 2px solid #dde; border-radius: 8px;
  background: #fff; font-size: 15px; cursor: pointer; color: #555;
  transition: all .15s; font-family: inherit;
}
.nav-btn:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); color: #fff; }
.nav-btn:disabled { opacity: .3; cursor: not-allowed; }
.nav-flip {
  border-color: var(--accent); color: var(--accent);
  font-weight: 600; padding: 10px 30px; min-width: 100px;
}
.nav-flip:hover:not(:disabled) { background: var(--accent); color: #fff; }
.kbd-hint { font-size: 11px; color: #c0c8d0; margin-top: 10px; }
`;

function buildFlashHtmlFromData(
  data: Record<string, FlashCard[]>,
  tabConfigs: FlashTabConfig[],
  deckName: string,
): string {
  const activeTabs = tabConfigs.filter(t => (data[t.id] ?? []).length > 0);
  const firstTab = activeTabs[0]?.id ?? tabConfigs[0]?.id ?? '';
  const colors = Object.fromEntries(tabConfigs.map(t => [t.id, t.color]));

  const tabButtons = activeTabs.map(t => {
    const count = (data[t.id] ?? []).length;
    const active = t.id === firstTab ? ' active' : '';
    return `<button class="tab${active}" data-tab="${t.id}" style="--tc:${t.color}">${escapeHtml(t.label)} <span class="tab-n">${count}</span></button>`;
  }).join('');

  const generated = new Date().toLocaleString('zh-TW', { hour12: false });

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(deckName)} — 單字卡</title>
<style>${FLASH_CSS}</style>
</head>
<body>
<header>
  <div class="header-top">
    <h1>${escapeHtml(deckName)}</h1>
    <div class="meta">${generated}</div>
  </div>
  <div class="tabs">${tabButtons}</div>
</header>
<main>
  <div class="progress"><span id="prog"></span></div>
  <div class="card-wrap">
    <div class="flash-card" id="fc" tabindex="0">
      <div class="fc-inner">
        <div class="fc-front">
          <div id="fc-primary" class="fc-primary"></div>
          <div id="fc-secondary" class="fc-secondary"></div>
          <div class="fc-flip-hint">點擊卡片 / 空白鍵 翻面 ▼</div>
        </div>
        <div class="fc-back">
          <div id="fc-answer" class="fc-answer"></div>
          <div class="fc-flip-hint">點擊卡片 / 空白鍵 翻回 ▲</div>
        </div>
      </div>
    </div>
  </div>
  <div class="nav">
    <button id="btn-prev" class="nav-btn" title="上一張 (←)">← 上一張</button>
    <button id="btn-flip" class="nav-btn nav-flip" title="翻面 (空白)">翻面</button>
    <button id="btn-next" class="nav-btn" title="下一張 (→)">下一張 →</button>
  </div>
  <div class="kbd-hint">← → 換頁 ｜ 空白鍵 / Enter 翻面</div>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const COLORS = ${JSON.stringify(colors)};
let tab = ${JSON.stringify(firstTab)}, idx = 0, flipped = false;

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function rend(s) { return esc(s).replace(/\\n/g,'<br>'); }

function render() {
  const cards = DATA[tab] || [];
  if (!cards.length) return;
  const c = cards[idx];
  document.getElementById('fc-primary').innerHTML = rend(c.primary);
  document.getElementById('fc-secondary').innerHTML = rend(c.secondary);
  document.getElementById('fc-answer').innerHTML = rend(c.answer);
  document.getElementById('prog').textContent = (idx + 1) + ' / ' + cards.length;
  document.getElementById('fc').classList.toggle('flipped', flipped);
  const color = COLORS[tab] || '#3498db';
  document.documentElement.style.setProperty('--accent', color);
  document.getElementById('btn-prev').disabled = idx === 0;
  document.getElementById('btn-next').disabled = idx === cards.length - 1;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
}

function flip() { flipped = !flipped; render(); }
function prev() { if (idx > 0) { idx--; flipped = false; render(); } }
function next() { if (idx < (DATA[tab]||[]).length - 1) { idx++; flipped = false; render(); } }
function switchTab(t) {
  if (!DATA[t] || !DATA[t].length) return;
  tab = t; idx = 0; flipped = false; render();
}

document.getElementById('fc').addEventListener('click', flip);
document.getElementById('btn-prev').addEventListener('click', prev);
document.getElementById('btn-flip').addEventListener('click', flip);
document.getElementById('btn-next').addEventListener('click', next);
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'ArrowRight') next();
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
});

render();
</script>
</body>
</html>`;
}

function buildFlashHtml(cards: GeneratedCards, deckName: string): string {
  return buildFlashHtmlFromData(buildFlashDeck(cards), STANDARD_TABS, deckName);
}

function buildReadingFlashHtml(cards: ReadingCards, deckName: string): string {
  const data: Record<string, FlashCard[]> = {
    terms: cards.terms.map(c => ({
      primary: c.word,
      secondary: c.exampleFromText,
      answer: c.definition_zh || '（尚未填入定義）',
    })),
    causes: cards.causes.map(c => ({
      primary: c.question_zh,
      secondary: '',
      answer: c.answer_zh,
    })),
    chapters: cards.chapters.map(c => ({
      primary: c.question_zh,
      secondary: '',
      answer: c.answer_zh,
    })),
    themes: cards.themes.map(c => ({
      primary: c.name,
      secondary: c.firstMention,
      answer: c.description_zh || '（尚未填入象徵意義）',
    })),
  };
  return buildFlashHtmlFromData(data, READING_TABS, deckName);
}

export function exportToFlashHtml(cards: GeneratedCards, deckName: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const outputPath = path.join(outputDir, `${safeName}-flash.html`);
  fs.writeFileSync(outputPath, buildFlashHtml(cards, deckName), 'utf-8');
  return outputPath;
}

export function exportReadingToFlashHtml(cards: ReadingCards, deckName: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const outputPath = path.join(outputDir, `${safeName}-reading-flash.html`);
  fs.writeFileSync(outputPath, buildReadingFlashHtml(cards, deckName), 'utf-8');
  return outputPath;
}

export function exportToHtml(cards: GeneratedCards, deckName: string, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = deckName.replace(/[/\\?%*:|"<>]/g, '-');
  const outputPath = path.join(outputDir, `${safeName}.html`);
  fs.writeFileSync(outputPath, buildHtml(cards, deckName), 'utf-8');
  return outputPath;
}
