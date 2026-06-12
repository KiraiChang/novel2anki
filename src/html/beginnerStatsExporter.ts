import * as fs from 'fs';
import * as path from 'path';
import { BeginnerWordStats, WordStat } from '../csv/beginnerImporter';

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'UNKNOWN'];

const CEFR_COLOR: Record<string, string> = {
  A1: '#22c55e', A2: '#84cc16',
  B1: '#3b82f6', B2: '#6366f1',
  C1: '#f97316', C2: '#ef4444',
  UNKNOWN: '#9ca3af',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fileChip(name: string): string {
  return `<span class="file-chip">${esc(name)}</span>`;
}

function badgeCell(cefr: string): string {
  const color = CEFR_COLOR[cefr] ?? '#9ca3af';
  return `<span class="badge" style="background:${color}">${esc(cefr)}</span>`;
}

function sentCell(s: string): string {
  return s ? `<span class="sent">${esc(s)}</span>` : '<span class="empty">—</span>';
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function exportMissingJson(words: WordStat[], outputPath: string): void {
  const missing = words.filter(w => !w.definition_en || !w.definition_zh || !w.word_zh);
  const missingEnCount   = missing.filter(w => !w.definition_en).length;
  const missingZhCount   = missing.filter(w => !w.definition_zh).length;
  const missingWordZhCount = missing.filter(w => !w.word_zh).length;
  const payload = {
    generated: new Date().toISOString(),
    missing_en_count: missingEnCount,
    missing_zh_count: missingZhCount,
    missing_word_zh_count: missingWordZhCount,
    words: missing.map(w => {
      const m: string[] = [];
      if (!w.definition_en) m.push('en');
      if (!w.definition_zh) m.push('zh');
      if (!w.word_zh)       m.push('word_zh');
      return { word: w.lemma, missing: m, definition_en: w.definition_en, definition_zh: w.definition_zh, word_zh: w.word_zh };
    }),
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
}

function exportMissingSentenceJson(words: WordStat[], outputPath: string): void {
  const result: Record<string, { en: string; zh: string; source: string }> = {};
  for (const w of words) {
    if (!w.context_sentence_zh && w.context_sentence) {
      result[fnv1a(w.context_sentence)] = { en: w.context_sentence, zh: '', source: '' };
    }
  }
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
}

function buildPerFileMissingTable(words: WordStat[]): string {
  const fileMap = new Map<string, { total: number; missingDefZh: number; missingCtxZh: number; missingDefEn: number }>();
  for (const w of words) {
    if (!fileMap.has(w.sourceFile)) fileMap.set(w.sourceFile, { total: 0, missingDefZh: 0, missingCtxZh: 0, missingDefEn: 0 });
    const e = fileMap.get(w.sourceFile)!;
    e.total++;
    if (!w.definition_zh) e.missingDefZh++;
    if (!w.context_sentence_zh) e.missingCtxZh++;
    if (!w.definition_en) e.missingDefEn++;
  }
  if (fileMap.size === 0) return '';
  const rows = [...fileMap.entries()].map(([file, s]) => `<tr>
      <td>${fileChip(file)}</td>
      <td class="num">${s.total.toLocaleString()}</td>
      <td class="num${s.missingDefZh > 0 ? ' warn-cell' : ''}">${s.missingDefZh.toLocaleString()}</td>
      <td class="num${s.missingCtxZh > 0 ? ' warn-cell' : ''}">${s.missingCtxZh.toLocaleString()}</td>
      <td class="num${s.missingDefEn > 0 ? ' warn-cell' : ''}">${s.missingDefEn.toLocaleString()}</td>
    </tr>`).join('\n');
  return `<div class="section">
    <h2>各 CSV 缺漏統計</h2>
    <p class="section-sub">各來源檔案的翻譯缺漏數量一覽。</p>
    <table>
      <thead><tr>
        <th>檔案</th>
        <th class="num">詞彙數</th>
        <th class="num">缺 definition_zh</th>
        <th class="num">缺例句中文</th>
        <th class="num">缺 definition_en</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function buildMissingDefZhRows(words: WordStat[]): string {
  return words
    .filter(w => !w.definition_zh)
    .map(w => `<tr>
      <td class="num">${w.rank}</td>
      <td class="word">${esc(w.lemma)}</td>
      <td><span class="pos">${esc(w.pos)}</span></td>
      <td>${badgeCell(w.cefr)}</td>
      <td class="sent-cell">${sentCell(w.context_sentence)}</td>
      <td>${fileChip(w.sourceFile)}</td>
    </tr>`).join('\n');
}

function buildMissingContextZhRows(words: WordStat[]): string {
  return words
    .filter(w => !w.context_sentence_zh)
    .map(w => `<tr>
      <td class="num">${w.rank}</td>
      <td class="word">${esc(w.lemma)}</td>
      <td>${w.definition_zh ? `<span class="def">${esc(w.definition_zh)}</span>` : '<span class="empty">—</span>'}</td>
      <td class="sent-cell">${sentCell(w.context_sentence)}</td>
      <td>${badgeCell(w.cefr)}</td>
      <td>${fileChip(w.sourceFile)}</td>
    </tr>`).join('\n');
}

function buildMissingDefEnRows(words: WordStat[]): string {
  return words
    .filter(w => !w.definition_en)
    .map(w => `<tr>
      <td class="num">${w.rank}</td>
      <td class="word">${esc(w.lemma)}</td>
      <td><span class="pos">${esc(w.pos)}</span></td>
      <td>${badgeCell(w.cefr)}</td>
      <td class="sent-cell">${sentCell(w.context_sentence)}</td>
      <td>${fileChip(w.sourceFile)}</td>
    </tr>`).join('\n');
}

function missingSection(opts: {
  title: string; subtitle: string; count: number;
  emptyMsg: string; anchorId: string; tableId: string; tbodyId: string;
  searchId: string; cefrId: string; cntId: string;
  cefrOptions: string; colHeaders: string; rows: string;
}): string {
  const { title, subtitle, count, emptyMsg, anchorId, tableId, tbodyId, searchId, cefrId, cntId, cefrOptions, colHeaders, rows } = opts;
  return `<div class="section" id="${anchorId}">
    <h2>${title} <span style="font-weight:400;color:#94a3b8;font-size:13px">（${count.toLocaleString()} 筆）</span></h2>
    <p class="section-sub">${subtitle}</p>
    ${count === 0
      ? `<div class="missing-zero">✓ ${emptyMsg}</div>`
      : `<div class="controls">
      <input type="text" id="${searchId}" placeholder="搜尋單字或例句…">
      <select id="${cefrId}">
        <option value="">所有 CEFR</option>
        ${cefrOptions}
      </select>
      <span class="count-label" id="${cntId}">${count.toLocaleString()} 筆</span>
    </div>
    <table id="${tableId}">
      <thead><tr>${colHeaders}</tr></thead>
      <tbody id="${tbodyId}">${rows}</tbody>
    </table>`}
  </div>`;
}

export interface BeginnerStatsExportResult {
  htmlPath: string;
  missingJsonPath: string | null;
  missingSentenceJsonPath: string | null;
}

export function exportBeginnerStatsToHtml(
  stats: BeginnerWordStats,
  deckName: string,
  outputDir: string,
): BeginnerStatsExportResult {
  const translatedPct  = stats.total > 0 ? Math.round(stats.translated / stats.total * 100) : 0;
  const missingDefZh   = stats.total - stats.translated;
  const missingDefEnPct  = stats.total > 0 ? Math.round(stats.missingDefEn    / stats.total * 100) : 0;
  const missingCtxZhPct  = stats.total > 0 ? Math.round(stats.missingContextZh / stats.total * 100) : 0;

  const cefrOptions = CEFR_ORDER.filter(l => stats.cefrDist[l])
    .map(l => `<option value="${l}">${l}</option>`).join('');

  const cefrRows = CEFR_ORDER
    .filter(l => stats.cefrDist[l])
    .map(l => {
      const cnt = stats.cefrDist[l];
      const pct = Math.round(cnt / stats.total * 100);
      const color = CEFR_COLOR[l];
      return `<div class="cefr-row"><span class="badge" style="background:${color}">${esc(l)}</span><span class="cefr-count">${cnt.toLocaleString()} 個</span><div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${color}"></div></div><span class="cefr-pct">${pct}%</span></div>`;
    }).join('\n');

  const perFileMissingTable = buildPerFileMissingTable(stats.words);

  const allTableRows = stats.words.map(w => {
    const statusIcon  = w.translated ? '✓' : '—';
    const statusClass = w.translated ? 'translated' : 'untranslated';
    const defCell     = w.definition_zh ? `<span class="def">${esc(w.definition_zh)}</span>` : '<span class="empty">—</span>';
    return `<tr class="${statusClass}">
      <td class="num">${w.rank}</td>
      <td class="word">${esc(w.lemma)}</td>
      <td><span class="pos">${esc(w.pos)}</span></td>
      <td>${badgeCell(w.cefr)}</td>
      <td class="num freq">${w.frequency.toLocaleString()}</td>
      <td>${defCell}</td>
      <td class="status ${statusClass}">${statusIcon}</td>
    </tr>`;
  }).join('\n');

  const defZhMissingSection = missingSection({
    title: '未翻譯單字（中文）',
    subtitle: '以下單字尚無中文翻譯，請至對應 CSV 填入 definition_zh 欄。',
    count: missingDefZh,
    emptyMsg: '所有單字均已翻譯',
    anchorId: 'sec-defzh',
    tableId: 'tbl-defzh', tbodyId: 'body-defzh',
    searchId: 'q-defzh', cefrId: 'cefr-defzh', cntId: 'cnt-defzh',
    cefrOptions,
    colHeaders: `
      <th data-col="rank" class="sorted-asc">排名</th>
      <th data-col="word">單字</th>
      <th data-col="pos">詞性</th>
      <th data-col="cefr">CEFR</th>
      <th data-col="sent" style="cursor:default">英文例句</th>
      <th data-col="file">來源檔案</th>`,
    rows: buildMissingDefZhRows(stats.words),
  });

  const ctxZhMissingSection = missingSection({
    title: '未翻譯例句（中文）',
    subtitle: '以下單字的英文例句尚無中文翻譯，請至對應 CSV 填入 context_sentence_zh 欄。',
    count: stats.missingContextZh,
    emptyMsg: '所有例句均已翻譯',
    anchorId: 'sec-ctxzh',
    tableId: 'tbl-ctxzh', tbodyId: 'body-ctxzh',
    searchId: 'q-ctxzh', cefrId: 'cefr-ctxzh', cntId: 'cnt-ctxzh',
    cefrOptions,
    colHeaders: `
      <th data-col="rank" class="sorted-asc">排名</th>
      <th data-col="word">單字</th>
      <th data-col="defzh">definition_zh</th>
      <th data-col="sent" style="cursor:default">英文例句</th>
      <th data-col="cefr">CEFR</th>
      <th data-col="file">來源檔案</th>`,
    rows: buildMissingContextZhRows(stats.words),
  });

  const defEnMissingSection = missingSection({
    title: '未翻譯英文解釋',
    subtitle: '以下單字尚無英文定義，請至對應 CSV 填入 definition_en 欄，或執行 --mw 自動預查。',
    count: stats.missingDefEn,
    emptyMsg: '所有單字均已有英文定義',
    anchorId: 'sec-defen',
    tableId: 'tbl-defen', tbodyId: 'body-defen',
    searchId: 'q-defen', cefrId: 'cefr-defen', cntId: 'cnt-defen',
    cefrOptions,
    colHeaders: `
      <th data-col="rank" class="sorted-asc">排名</th>
      <th data-col="word">單字</th>
      <th data-col="pos">詞性</th>
      <th data-col="cefr">CEFR</th>
      <th data-col="sent" style="cursor:default">英文例句</th>
      <th data-col="file">來源檔案</th>`,
    rows: buildMissingDefEnRows(stats.words),
  });

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deckName)} — 字彙統計</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f8fafc;color:#1e293b;font-size:14px}
header{background:#1e293b;color:#f1f5f9;padding:24px 32px}
header h1{font-size:22px;font-weight:700;margin-bottom:4px}
header p{color:#94a3b8;font-size:13px}
.container{max-width:1200px;margin:0 auto;padding:24px 32px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:28px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px}
.card-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.card-value{font-size:28px;font-weight:700;color:#0f172a}
.card-sub{font-size:13px;color:#64748b;margin-top:4px}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px}
.section h2{font-size:15px;font-weight:600;margin-bottom:4px;color:#334155}
.section-sub{font-size:12px;color:#94a3b8;margin-bottom:16px}
.cefr-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-size:11px;font-weight:700;min-width:48px;text-align:center}
.cefr-count{width:70px;text-align:right;color:#475569}
.bar-wrap{flex:1;background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden}
.bar{height:100%;border-radius:4px}
.cefr-pct{width:36px;text-align:right;color:#64748b;font-size:12px}
.controls{display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
.controls input[type=text]{padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;width:220px;outline:none}
.controls input[type=text]:focus{border-color:#6366f1}
select{padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;cursor:pointer;outline:none}
.count-label{margin-left:auto;font-size:13px;color:#64748b}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e2e8f0;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:#6366f1}
th.sorted-asc::after{content:" ▲"}
th.sorted-desc::after{content:" ▼"}
td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#f8fafc}
.num{text-align:right;color:#64748b;font-variant-numeric:tabular-nums;font-size:13px}
.freq{font-weight:600;color:#0f172a}
.word{font-weight:600;font-size:15px;color:#0f172a}
.pos{font-size:11px;color:#64748b;background:#f1f5f9;padding:2px 6px;border-radius:4px}
.def{color:#334155}
.sent{color:#475569;font-size:13px;line-height:1.5}
.sent-cell{max-width:420px}
.empty{color:#cbd5e1}
.status{text-align:center;font-size:16px}
.translated .status{color:#22c55e}
.untranslated .status{color:#cbd5e1}
.file-chip{display:inline-block;font-size:11px;color:#6366f1;background:#eef2ff;padding:2px 8px;border-radius:4px;white-space:nowrap}
.missing-zero{text-align:center;padding:32px;color:#94a3b8;font-size:13px}
.warn-cell{color:#f97316;font-weight:600}
.hidden{display:none}
.nav-bar{position:sticky;top:0;z-index:100;background:#fff;border-bottom:1px solid #e2e8f0;padding:10px 32px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nav-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;border:1px solid #e2e8f0;background:#f8fafc;color:#334155;cursor:pointer;transition:background .15s,border-color .15s}
.nav-btn:hover{background:#eef2ff;border-color:#6366f1;color:#6366f1}
.nav-btn .cnt{font-size:11px;background:#e2e8f0;color:#64748b;padding:1px 6px;border-radius:10px;line-height:1.4}
.nav-btn.warn .cnt{background:#fff3e0;color:#f97316}
#back-top{position:fixed;bottom:28px;right:28px;z-index:200;width:44px;height:44px;border-radius:50%;background:#1e293b;color:#f1f5f9;border:none;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;transition:opacity .2s}
#back-top.visible{opacity:1}
#back-top:hover{background:#334155}
</style>
</head>
<body>
<header id="top">
  <h1>${esc(deckName)}</h1>
  <p>初學者字彙統計報告</p>
</header>
<nav class="nav-bar">
  <a class="nav-btn${missingDefZh > 0 ? ' warn' : ''}" href="#sec-defzh">
    未翻譯單字（中文）<span class="cnt">${missingDefZh.toLocaleString()}</span>
  </a>
  <a class="nav-btn${stats.missingContextZh > 0 ? ' warn' : ''}" href="#sec-ctxzh">
    未翻譯例句（中文）<span class="cnt">${stats.missingContextZh.toLocaleString()}</span>
  </a>
  <a class="nav-btn${stats.missingDefEn > 0 ? ' warn' : ''}" href="#sec-defen">
    未翻譯英文解釋<span class="cnt">${stats.missingDefEn.toLocaleString()}</span>
  </a>
</nav>
<button id="back-top" title="回到頂端" onclick="window.scrollTo({top:0,behavior:'smooth'})">↑</button>
<div class="container">

  <div class="summary">
    <div class="card">
      <div class="card-label">詞彙總數</div>
      <div class="card-value">${stats.total.toLocaleString()}</div>
      <div class="card-sub">覆蓋率排名 #${stats.rankMin}–#${stats.rankMax}</div>
    </div>
    <div class="card">
      <div class="card-label">已翻譯</div>
      <div class="card-value" style="color:#22c55e">${stats.translated.toLocaleString()}</div>
      <div class="card-sub">${translatedPct}% 完成</div>
    </div>
    <div class="card">
      <div class="card-label">缺 definition_zh</div>
      <div class="card-value" style="color:${missingDefZh > 0 ? '#f97316' : '#cbd5e1'}">${missingDefZh.toLocaleString()}</div>
      <div class="card-sub">${100 - translatedPct}% 待填入</div>
    </div>
    <div class="card">
      <div class="card-label">缺 definition_en</div>
      <div class="card-value" style="color:${stats.missingDefEn > 0 ? '#f97316' : '#cbd5e1'}">${stats.missingDefEn.toLocaleString()}</div>
      <div class="card-sub">${missingDefEnPct}% 待填入</div>
    </div>
    <div class="card">
      <div class="card-label">缺例句中文</div>
      <div class="card-value" style="color:${stats.missingContextZh > 0 ? '#f97316' : '#cbd5e1'}">${stats.missingContextZh.toLocaleString()}</div>
      <div class="card-sub">${missingCtxZhPct}% 待填入</div>
    </div>
  </div>

  <div class="section">
    <h2>CEFR 分佈</h2>
    ${cefrRows}
  </div>

  ${perFileMissingTable}

  ${defZhMissingSection}

  ${ctxZhMissingSection}

  ${defEnMissingSection}

  <div class="section">
    <h2>完整詞彙列表</h2>
    <div class="controls">
      <input type="text" id="search" placeholder="搜尋單字或定義…">
      <select id="cefrFilter">
        <option value="">所有 CEFR</option>
        ${cefrOptions}
      </select>
      <select id="transFilter">
        <option value="">全部</option>
        <option value="yes">已翻譯</option>
        <option value="no">未翻譯</option>
      </select>
      <span class="count-label" id="countLabel">共 ${stats.words.length.toLocaleString()} 筆</span>
    </div>
    <table id="wordTable">
      <thead>
        <tr>
          <th data-col="rank" class="sorted-asc">排名</th>
          <th data-col="word">單字</th>
          <th data-col="pos">詞性</th>
          <th data-col="cefr">CEFR</th>
          <th data-col="freq">出現次數</th>
          <th data-col="def">定義</th>
          <th data-col="status">已譯</th>
        </tr>
      </thead>
      <tbody id="tbody">${allTableRows}</tbody>
    </table>
  </div>

</div>
<script>
(function(){

  // ── 通用表格：排序 + 搜尋 + CEFR 篩選 ───────────────────────────────
  function initTable(tbodyId, colMap, searchId, cefrSelId, cntId) {
    var tbody  = document.getElementById(tbodyId);
    if (!tbody) return;
    var rows   = Array.from(tbody.querySelectorAll('tr'));
    var search = document.getElementById(searchId);
    var cefrSel = document.getElementById(cefrSelId);
    var cntLbl  = document.getElementById(cntId);
    var sortCol = 'rank', sortDir = 1;

    function cell(tr, col) {
      var idx = colMap[col];
      return idx !== undefined ? (tr.querySelectorAll('td')[idx].textContent.trim() || '') : '';
    }

    function filter() {
      var q    = search ? search.value.toLowerCase() : '';
      var cefr = cefrSel ? cefrSel.value : '';
      var vis  = 0;
      rows.forEach(function(tr) {
        var word = cell(tr, 'word').toLowerCase();
        var sent = colMap['sent'] !== undefined ? cell(tr, 'sent').toLowerCase() : '';
        var defzh = colMap['defzh'] !== undefined ? cell(tr, 'defzh').toLowerCase() : '';
        var trCefr = cell(tr, 'cefr');
        var show = (!q || word.includes(q) || sent.includes(q) || defzh.includes(q)) &&
                   (!cefr || trCefr === cefr);
        tr.classList.toggle('hidden', !show);
        if (show) vis++;
      });
      if (cntLbl) cntLbl.textContent = vis.toLocaleString() + ' 筆';
    }

    function sort() {
      var sorted = rows.slice().sort(function(a, b) {
        var av = cell(a, sortCol), bv = cell(b, sortCol);
        var an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
        return av.localeCompare(bv, 'zh-TW') * sortDir;
      });
      sorted.forEach(function(tr) { tbody.appendChild(tr); });
      tbody.closest('table').querySelectorAll('th[data-col]').forEach(function(th) {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.col === sortCol) th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
      });
    }

    tbody.closest('table').querySelectorAll('th[data-col]').forEach(function(th) {
      th.addEventListener('click', function() {
        if (th.style.cursor === 'default') return;
        if (sortCol === th.dataset.col) { sortDir *= -1; } else { sortCol = th.dataset.col; sortDir = 1; }
        sort();
      });
    });
    if (search) search.addEventListener('input', filter);
    if (cefrSel) cefrSel.addEventListener('change', filter);
  }

  // 未翻譯單字：rank=0, word=1, pos=2, cefr=3, sent=4, file=5
  initTable('body-defzh', {rank:0,word:1,pos:2,cefr:3,sent:4,file:5},
            'q-defzh', 'cefr-defzh', 'cnt-defzh');

  // 未翻譯例句：rank=0, word=1, defzh=2, sent=3, cefr=4, file=5
  initTable('body-ctxzh', {rank:0,word:1,defzh:2,sent:3,cefr:4,file:5},
            'q-ctxzh', 'cefr-ctxzh', 'cnt-ctxzh');

  // 未翻譯英文解釋：rank=0, word=1, pos=2, cefr=3, sent=4, file=5
  initTable('body-defen', {rank:0,word:1,pos:2,cefr:3,sent:4,file:5},
            'q-defen', 'cefr-defen', 'cnt-defen');

  // ── 回到頂端按鈕：捲動超過 300px 才顯示 ───────────────────────────
  var backTop = document.getElementById('back-top');
  window.addEventListener('scroll', function() {
    backTop.classList.toggle('visible', window.scrollY > 300);
  });

  // ── 完整詞彙列表 ────────────────────────────────────────────────────
  var rows2   = Array.from(document.querySelectorAll('#tbody tr'));
  var search2 = document.getElementById('search');
  var cefrF   = document.getElementById('cefrFilter');
  var transF  = document.getElementById('transFilter');
  var cntLbl2 = document.getElementById('countLabel');
  var sortCol2 = 'rank', sortDir2 = 1;

  function cell2(tr, col) {
    var map = {rank:0,word:1,pos:2,cefr:3,freq:4,def:5,status:6};
    return tr.querySelectorAll('td')[map[col]].textContent.trim() || '';
  }

  function filter2() {
    var q = search2.value.toLowerCase();
    var cefr = cefrF.value, trans = transF.value;
    var vis = 0;
    rows2.forEach(function(tr) {
      var show =
        (!q || cell2(tr,'word').toLowerCase().includes(q) || cell2(tr,'def').toLowerCase().includes(q)) &&
        (!cefr || cell2(tr,'cefr') === cefr) &&
        (!trans || (trans === 'yes' ? tr.classList.contains('translated') : !tr.classList.contains('translated')));
      tr.classList.toggle('hidden', !show);
      if (show) vis++;
    });
    cntLbl2.textContent = '共 ' + vis.toLocaleString() + ' 筆';
  }

  function sort2() {
    var tbody2 = document.getElementById('tbody');
    var sorted = rows2.slice().sort(function(a, b) {
      var av = cell2(a, sortCol2), bv = cell2(b, sortCol2);
      var an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir2;
      return av.localeCompare(bv, 'zh-TW') * sortDir2;
    });
    sorted.forEach(function(tr) { tbody2.appendChild(tr); });
    document.querySelectorAll('#wordTable th').forEach(function(th) {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.col === sortCol2) th.classList.add(sortDir2 === 1 ? 'sorted-asc' : 'sorted-desc');
    });
  }

  document.querySelectorAll('#wordTable th[data-col]').forEach(function(th) {
    th.addEventListener('click', function() {
      if (sortCol2 === th.dataset.col) { sortDir2 *= -1; } else { sortCol2 = th.dataset.col; sortDir2 = 1; }
      sort2();
    });
  });
  search2.addEventListener('input', filter2);
  cefrF.addEventListener('change', filter2);
  transF.addEventListener('change', filter2);

})();
</script>
</body>
</html>`;

  const slug = deckName.replace(/[^a-z0-9一-鿿]+/gi, '-').replace(/^-|-$/g, '');
  fs.mkdirSync(outputDir, { recursive: true });

  const htmlPath             = path.join(outputDir, `${slug}-beginner-stats.html`);
  const missingJsonPath      = path.join(outputDir, `${slug}-missing.json`);
  const missingSentenceJsonPath = path.join(outputDir, `${slug}-missing-sentence.json`);

  fs.writeFileSync(htmlPath, html, 'utf-8');

  const hasMissing   = stats.words.some(w => !w.definition_en || !w.definition_zh || !w.word_zh);
  const hasMissingSent = stats.words.some(w => !w.context_sentence_zh && w.context_sentence);

  if (hasMissing)   exportMissingJson(stats.words, missingJsonPath);
  if (hasMissingSent) exportMissingSentenceJson(stats.words, missingSentenceJsonPath);

  return {
    htmlPath,
    missingJsonPath:         hasMissing     ? missingJsonPath      : null,
    missingSentenceJsonPath: hasMissingSent ? missingSentenceJsonPath : null,
  };
}
