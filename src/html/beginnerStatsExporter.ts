import * as fs from 'fs';
import * as path from 'path';
import { BeginnerWordStats } from '../csv/beginnerImporter';

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

export function exportBeginnerStatsToHtml(
  stats: BeginnerWordStats,
  deckName: string,
  outputDir: string,
): string {
  const translatedPct = stats.total > 0 ? Math.round(stats.translated / stats.total * 100) : 0;

  const cefrRows = CEFR_ORDER
    .filter(l => stats.cefrDist[l])
    .map(l => {
      const cnt = stats.cefrDist[l];
      const pct = Math.round(cnt / stats.total * 100);
      const color = CEFR_COLOR[l];
      return `<div class="cefr-row"><span class="badge" style="background:${color}">${esc(l)}</span><span class="cefr-count">${cnt.toLocaleString()} 個</span><div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${color}"></div></div><span class="cefr-pct">${pct}%</span></div>`;
    }).join('\n');

  const tableRows = stats.words.map(w => {
    const color = CEFR_COLOR[w.cefr] ?? '#9ca3af';
    const statusIcon = w.translated ? '✓' : '—';
    const statusClass = w.translated ? 'translated' : 'untranslated';
    const defCell = w.definition_zh ? `<span class="def">${esc(w.definition_zh)}</span>` : '<span class="empty">—</span>';
    return `<tr class="${statusClass}">
      <td class="num">${w.rank}</td>
      <td class="word">${esc(w.lemma)}</td>
      <td><span class="pos">${esc(w.pos)}</span></td>
      <td><span class="badge" style="background:${color}">${esc(w.cefr)}</span></td>
      <td class="num freq">${w.frequency.toLocaleString()}</td>
      <td>${defCell}</td>
      <td class="status ${statusClass}">${statusIcon}</td>
    </tr>`;
  }).join('\n');

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
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px}
.card-label{font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.card-value{font-size:28px;font-weight:700;color:#0f172a}
.card-sub{font-size:13px;color:#64748b;margin-top:4px}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px}
.section h2{font-size:15px;font-weight:600;margin-bottom:16px;color:#334155}
.cefr-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;color:#fff;font-size:11px;font-weight:700;min-width:48px;text-align:center}
.cefr-count{width:70px;text-align:right;color:#475569}
.bar-wrap{flex:1;background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden}
.bar{height:100%;border-radius:4px;transition:width .3s}
.cefr-pct{width:36px;text-align:right;color:#64748b;font-size:12px}
.controls{display:flex;gap:12px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
#search{padding:8px 12px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;width:220px;outline:none}
#search:focus{border-color:#6366f1}
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
.empty{color:#cbd5e1}
.status{text-align:center;font-size:16px}
.translated .status{color:#22c55e}
.untranslated .status{color:#cbd5e1}
.hidden{display:none}
</style>
</head>
<body>
<header>
  <h1>${esc(deckName)}</h1>
  <p>初學者字彙統計報告</p>
</header>
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
      <div class="card-label">未翻譯</div>
      <div class="card-value" style="color:${stats.total - stats.translated > 0 ? '#f97316' : '#cbd5e1'}">${(stats.total - stats.translated).toLocaleString()}</div>
      <div class="card-sub">${100 - translatedPct}% 待填入</div>
    </div>
  </div>

  <div class="section">
    <h2>CEFR 分佈</h2>
    ${cefrRows}
  </div>

  <div class="section">
    <h2>詞彙列表</h2>
    <div class="controls">
      <input id="search" type="text" placeholder="搜尋單字或定義…">
      <select id="cefrFilter">
        <option value="">所有 CEFR</option>
        ${CEFR_ORDER.filter(l => stats.cefrDist[l]).map(l => `<option value="${l}">${l}</option>`).join('')}
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
      <tbody id="tbody">
        ${tableRows}
      </tbody>
    </table>
  </div>
</div>
<script>
(function(){
  const rows = Array.from(document.querySelectorAll('#tbody tr'));
  const search = document.getElementById('search');
  const cefrFilter = document.getElementById('cefrFilter');
  const transFilter = document.getElementById('transFilter');
  const countLabel = document.getElementById('countLabel');
  let sortCol = 'rank', sortDir = 1;

  function getCell(tr, col) {
    const cells = tr.querySelectorAll('td');
    const map = { rank:0, word:1, pos:2, cefr:3, freq:4, def:5, status:6 };
    return cells[map[col]]?.textContent?.trim() ?? '';
  }

  function applyFilters() {
    const q = search.value.toLowerCase();
    const cefr = cefrFilter.value;
    const trans = transFilter.value;
    let visible = 0;
    rows.forEach(tr => {
      const word = getCell(tr, 'word').toLowerCase();
      const def = getCell(tr, 'def').toLowerCase();
      const trCefr = getCell(tr, 'cefr');
      const translated = tr.classList.contains('translated');
      const show =
        (!q || word.includes(q) || def.includes(q)) &&
        (!cefr || trCefr === cefr) &&
        (!trans || (trans === 'yes' ? translated : !translated));
      tr.classList.toggle('hidden', !show);
      if (show) visible++;
    });
    countLabel.textContent = '共 ' + visible.toLocaleString() + ' 筆';
  }

  function applySort() {
    const tbody = document.getElementById('tbody');
    const sorted = rows.slice().sort((a, b) => {
      let av = getCell(a, sortCol), bv = getCell(b, sortCol);
      const an = parseFloat(av), bn = parseFloat(bv);
      if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
      return av.localeCompare(bv, 'zh-TW') * sortDir;
    });
    sorted.forEach(tr => tbody.appendChild(tr));
    document.querySelectorAll('th').forEach(th => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.col === sortCol) th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    });
  }

  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) { sortDir *= -1; } else { sortCol = col; sortDir = 1; }
      applySort();
    });
  });

  search.addEventListener('input', applyFilters);
  cefrFilter.addEventListener('change', applyFilters);
  transFilter.addEventListener('change', applyFilters);
})();
</script>
</body>
</html>`;

  const slug = deckName.replace(/[^a-z0-9一-鿿]+/gi, '-').replace(/^-|-$/g, '');
  const filename = `${slug}-beginner-stats.html`;
  const outputPath = path.join(outputDir, filename);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}
