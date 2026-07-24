/* ============================================================
   香港六合彩資訊網站 - 應用程式
   Hong Kong Mark Six Information Website - Application
   ============================================================ */

// ==================== Data Store ====================
const Store = {
  draws: [], // 2002-2026 draws with prizes (49-number era)
  records: [], // 1976-2002 records (older eras)
  allData: [], // merged & normalized
  latestDraw: null,
  dataLoaded: false,
  updated: '',
};

// ==================== Utilities ====================

/** Get ball color class by number */
/** HKJC 官方號碼球配色(2026 官方 fun facts 確認): 紅17/藍16/綠16 */
const HKJC_RED_BALLS   = new Set([1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46]);
const HKJC_BLUE_BALLS  = new Set([3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48]);
const HKJC_GREEN_BALLS = new Set([5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49]);

function getBallColor(num) {
  if (HKJC_RED_BALLS.has(num))   return 'ball-red';
  if (HKJC_BLUE_BALLS.has(num))  return 'ball-blue';
  if (HKJC_GREEN_BALLS.has(num)) return 'ball-green';
  return 'ball-red'; // fallback (不應觸發)
}

/** Render a number ball */
function renderBall(num, sizeClass = '') {
  const cls = `ball ${getBallColor(num)} ${sizeClass}`;
  return `<span class="${cls}">${num}</span>`;
}

/** Render balls array with optional special */
function renderBalls(mainNumbers, specialNumber = null, sizeClass = '') {
  let html = mainNumbers.map(n => renderBall(n, sizeClass)).join('');
  if (specialNumber) {
    html += ` <span class="ball-plus">+</span> `;
    html += renderBall(specialNumber, 'ball-special ' + sizeClass);
  }
  return html;
}

/** Combination C(n, k) */
function combination(n, k) {
  if (k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = result * (n - i + 1) / i;
  }
  return Math.round(result);
}

/** Format currency */
function formatCurrency(amount) {
  if (!amount && amount !== 0) return '-';
  if (amount >= 100000000) {
    return 'HK$ ' + (amount / 100000000).toFixed(2) + ' 億';
  }
  return 'HK$ ' + amount.toLocaleString('zh-HK');
}

/** Format date */
function formatDate(dateStr) {
  if (!dateStr) return '日期不詳';
  const d = new Date(dateStr);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const w = weekdays[d.getDay()];
  return `${y}年${m}月${day}日（${w}）`;
}

/** Prize names mapping */
const PRIZE_NAMES = ['頭獎', '二獎', '三獎', '四獎', '五獎', '六獎', '七獎'];

// ==================== Data Loading ====================

/**
 * 載入資料,優先使用內嵌的全局變量 (window.DRAWS_DATA / window.RECORDS_DATA),
 * 沒有時才 fallback 到 fetch。這樣從 file:// 直接雙擊 index.html 也能正常載入。
 */
async function loadData() {
  // ---- 1. 優先:內嵌全局變量 (data/data.js) ----
  if (typeof window.DRAWS_DATA !== 'undefined' && typeof window.RECORDS_DATA !== 'undefined') {
    try {
      Store.draws = window.DRAWS_DATA.draws || [];
      Store.records = window.RECORDS_DATA.records || [];
      Store.updated = window.DRAWS_DATA.meta?.updated || '';
      finalizeDataLoad();
      console.log('✓ 資料載入完成 (內嵌模式,共 ' + Store.allData.length + ' 期)');
      return true;
    } catch (err) {
      console.error('內嵌資料解析失敗,fallback 到 fetch:', err);
      // 不直接 return false,嘗試 fetch
    }
  }

  // ---- 2. Fallback:fetch JSON (適用於未打包 data.js 的部署環境) ----
  try {
    const [res1, res2] = await Promise.all([
      fetch('data/draw_results_verified.json'),
      fetch('data/draw_results_1976_2002.json'),
    ]);

    if (!res1.ok || !res2.ok) {
      throw new Error('資料載入失敗');
    }

    const data1 = await res1.json();
    const data2 = await res2.json();

    Store.draws = data1.draws || [];
    Store.records = data2.records || [];
    Store.updated = data1.meta?.updated || '';

    finalizeDataLoad();
    console.log('✓ 資料載入完成 (fetch 模式,共 ' + Store.allData.length + ' 期)');
    return true;
  } catch (err) {
    console.error('Data loading error:', err);
    document.getElementById('headerUpdate').textContent = '資料載入失敗';
    return false;
  }
}

/** 資料載入完成後的共用收尾:去重合併 + 更新最新一期 + 更新 header */
function finalizeDataLoad() {
  // Normalize older records to match draw format
  const normalizedRecords = Store.records.map(r => ({
    draw_no: r.draw_no,
    date: r.draw_date,
    day_of_week: r.draw_date ? getDayOfWeek(r.draw_date) : '',
    main_numbers: r.main_numbers,
    special_number: r.special_number,
    is_snowball: r.snowball === 'Y' || r.snowball === true,
    prizes: null,
    date_source: r.date_source || 'unknown',
  }));

  // Merge & deduplicate: draws come first (newest, with prizes), older records supplement
  const seen = new Set();
  const merged = [];
  for (const d of Store.draws) {
    if (!seen.has(d.draw_no)) {
      seen.add(d.draw_no);
      merged.push(d);
    }
  }
  for (const r of normalizedRecords) {
    if (!seen.has(r.draw_no)) {
      seen.add(r.draw_no);
      merged.push(r);
    }
  }
  Store.allData = merged;

  // Latest draw — 找出 draw_no 最大的一期（與陣列排序方向無關）
  if (Store.draws.length > 0) {
    Store.latestDraw = Store.draws.reduce((latest, d) =>
      (!latest || d.draw_no > latest.draw_no) ? d : latest, null);
  }

  Store.dataLoaded = true;
  document.getElementById('headerUpdate').textContent =
    '資料更新：' + new Date(Store.updated).toLocaleDateString('zh-HK');
}

function getDayOfWeek(dateStr) {
  if (!dateStr) return '';
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return days[new Date(dateStr).getDay()];
}

/** Parse draw_no into sortable numeric value: "26/077" -> 2026077, "76/001" -> 1976001 */
function parseDrawNo(drawNo) {
  if (!drawNo) return 0;
  const parts = drawNo.split('/');
  if (parts.length !== 2) return 0;
  let yy = parseInt(parts[0]);
  const nnn = parseInt(parts[1]);
  // HK Mark Six: two-digit year; if > 50 assume 1900 + yy, else 2000 + yy
  const year = yy > 50 ? 1900 + yy : 2000 + yy;
  return year * 1000 + nnn;
}

// ==================== Navigation ====================

function initNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const module = tab.dataset.module;
      switchModule(module);
      // 手機版：點擊任一 tab 後自動收合選單
      const navInner = document.getElementById('navInner');
      const navToggle = document.getElementById('navToggle');
      if (navInner && navInner.classList.contains('open')) {
        navInner.classList.remove('open');
        if (navToggle) {
          navToggle.classList.remove('active');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });

  // 漢堡選單 toggle
  const navToggle = document.getElementById('navToggle');
  const navInner = document.getElementById('navInner');
  if (navToggle && navInner) {
    navToggle.addEventListener('click', () => {
      const isOpen = navInner.classList.toggle('open');
      navToggle.classList.toggle('active');
      navToggle.setAttribute('aria-expanded', isOpen);
    });
  }
}

function switchModule(moduleName) {
  // Update tabs
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.module === moduleName);
  });

  // Update modules
  document.querySelectorAll('.module').forEach(m => {
    m.classList.toggle('active', m.id === 'module-' + moduleName);
  });

  // Lazy init
  switch (moduleName) {
    case 'latest': renderLatest(); break;
    case 'history': renderHistory(); break;
    case 'checker':
      initChecker();
      // 確保比對按鈕事件已綁定（DOMContentLoaded 可能因動態渲染失效時作為備援）
      ensureCheckerEvents();
      break;
    case 'calculator': initCalculator(); break;
    case 'stats': renderStats(); break;
    case 'filter': initFilter(); break;
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== Module 1: Latest Draw ====================

function renderLatest() {
  if (!Store.dataLoaded) {
    document.getElementById('latestLoading').style.display = 'flex';
    return;
  }
  document.getElementById('latestLoading').style.display = 'none';
  document.getElementById('latestContent').style.display = 'block';

  const draw = Store.latestDraw;
  if (!draw) return;

  // Draw card
  const card = document.getElementById('latestDrawCard');
  const snowballHtml = draw.is_snowball
    ? '<span class="draw-snowball">❄️ 多寶獎金</span>'
    : '';

  card.innerHTML = `
    <div class="latest-draw-header">
      <div class="draw-info">
        <div class="draw-no">第 ${draw.draw_no} 期</div>
        <div class="draw-date">${formatDate(draw.date)}</div>
      </div>
      ${snowballHtml}
    </div>
    <div class="ball-display">
      ${renderBalls(draw.main_numbers, null, 'ball-lg')}
      <span class="ball-plus" style="font-size:1.5rem;margin:0 8px;">+</span>
      <span class="ball ball-special ball-lg" style="font-size:1.1rem;">${draw.special_number}</span>
    </div>
  `;

  // Prize detail card
  const prizeCard = document.getElementById('prizeDetailCard');
  let prizeHtml = `
    <div class="card-title">💰 派彩詳情</div>
    <div style="overflow-x:auto;">
    <table class="prize-table">
      <thead>
        <tr>
          <th>獎項</th>
          <th>中獎注數</th>
          <th>每注派彩 (HK$)</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (draw.prizes) {
    const pool = draw.prizes._pool;
    const unitBet = (pool?.unit_bet) || 10;
    for (const name of PRIZE_NAMES) {
      const p = draw.prizes[name];
      if (p) {
        const isJackpot = name === '頭獎' && pool?.jackpot > 0;
        // 中獎注數 = prize.winners / unit_bet
        const winningUnits = (p.winners / unitBet).toFixed(1);

        prizeHtml += `
          <tr class="${isJackpot ? 'highlight-row' : ''}">
            <td class="prize-label">${isJackpot ? '🌟 ' : ''}${name}</td>
            <td class="winners">${winningUnits}</td>
            <td class="amount">${formatCurrency(p.amount)}</td>
          </tr>
        `;
      }
    }

    // Pool info
    if (pool) {
      prizeHtml += `
        </tbody></table></div>
        <div class="pool-info">
          <span>📊 總投注額：<strong>${formatCurrency(pool.total_investment)}</strong></span>
          <span>🏆 累積多寶：<strong>${formatCurrency(pool.jackpot)}</strong></span>
          <span>💵 每注金額：<strong>HK$ ${unitBet}</strong></span>
        </div>
      `;
    } else {
      prizeHtml += '</tbody></table></div>';
    }
  } else {
    prizeHtml += '<tr><td colspan="3" class="text-center">暫無派彩資料</td></tr></tbody></table></div>';
  }

  prizeCard.innerHTML = prizeHtml;
}

// ==================== Module 2: History ====================

let historyState = {
  searchTerm: '',
  yearFilter: '',
  sortKey: 'draw_no',
  sortDir: 'desc',
  page: 1,
  pageSize: 30,
  filtered: [],
  allFiltered: [],
};

function renderHistory() {
  initHistoryFilters();
  applyHistoryFilters();
}

function initHistoryFilters() {
  // Guard against re-initialization
  if (document.getElementById('historySearch').dataset.initialized === '1') return;
  document.getElementById('historySearch').dataset.initialized = '1';
  // Populate year dropdown
  const years = new Set();
  Store.allData.forEach(d => {
    if (d.date) {
      years.add(new Date(d.date).getFullYear());
    } else {
      // Try to extract from draw_no
      const match = d.draw_no.match(/^(\d{2})\//);
      if (match) {
        let yy = parseInt(match[1]);
        years.add(yy > 70 ? 1900 + yy : 2000 + yy);
      }
    }
  });
  const sorted = [...years].sort((a, b) => b - a);
  const sel = document.getElementById('historyYearFilter');
  sel.innerHTML = '<option value="">全部年份</option>' +
    sorted.map(y => `<option value="${y}">${y} 年</option>`).join('');

  // Set search event
  const searchInput = document.getElementById('historySearch');
  searchInput.oninput = debounce(() => {
    historyState.searchTerm = searchInput.value.trim();
    historyState.page = 1;
    applyHistoryFilters();
  }, 300);

  // Year filter event
  sel.onchange = () => {
    historyState.yearFilter = sel.value;
    historyState.page = 1;
    applyHistoryFilters();
  };

  // Sort events
  document.querySelectorAll('#historyTable th[data-sort]').forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (historyState.sortKey === key) {
        historyState.sortDir = historyState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        historyState.sortKey = key;
        historyState.sortDir = 'desc';
      }
      historyState.page = 1;
      applyHistoryFilters();
    };
  });
}

function applyHistoryFilters() {
  let data = [...Store.allData];

  // Search filter
  if (historyState.searchTerm) {
    const term = historyState.searchTerm.toLowerCase();
    data = data.filter(d => {
      const dn = d.draw_no.toLowerCase();
      const dt = d.date ? d.date.toLowerCase() : '';
      return dn.includes(term) || dt.includes(term);
    });
  }

  // Year filter
  if (historyState.yearFilter) {
    const year = parseInt(historyState.yearFilter);
    data = data.filter(d => {
      if (d.date) {
        return new Date(d.date).getFullYear() === year;
      }
      const match = d.draw_no.match(/^(\d{2})\//);
      if (match) {
        let yy = parseInt(match[1]);
        yy = yy > 70 ? 1900 + yy : 2000 + yy;
        return yy === year;
      }
      return false;
    });
  }

  // Sort
  data.sort((a, b) => {
    let va, vb;
    switch (historyState.sortKey) {
      case 'draw_no':
        va = parseDrawNo(a.draw_no);
        vb = parseDrawNo(b.draw_no);
        break;
      case 'date':
        va = a.date || '0000-00-00';
        vb = b.date || '0000-00-00';
        break;
      case 'special_number':
        va = a.special_number || 0;
        vb = b.special_number || 0;
        break;
      default:
        va = parseDrawNo(a.draw_no);
        vb = parseDrawNo(b.draw_no);
    }
    let cmp = va > vb ? 1 : va < vb ? -1 : 0;
    return historyState.sortDir === 'asc' ? cmp : -cmp;
  });

  historyState.allFiltered = data;
  historyState.filtered = data;
  renderHistoryPage();
}

function renderHistoryPage() {
  const { filtered, page, pageSize } = historyState;
  const totalPages = Math.ceil(filtered.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageData = filtered.slice(start, start + pageSize);

  const tbody = document.getElementById('historyBody');
  tbody.innerHTML = '';

  if (pageData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:40px;">沒有符合條件的記錄</td></tr>';
  }

  pageData.forEach((d, idx) => {
    const globalIdx = start + idx;
    const row = document.createElement('tr');
    row.className = 'draw-row';
    row.dataset.idx = globalIdx;
    row.onclick = () => toggleExpandRow(globalIdx);
    row.innerHTML = `
      <td><strong>${d.draw_no || '-'}</strong></td>
      <td>${d.date ? formatDate(d.date) : (d.date_source === 'unavailable' ? '日期不詳' : '-')}</td>
      <td>${renderBalls(d.main_numbers, null, 'ball-sm')}</td>
      <td>${renderBall(d.special_number, 'ball-sm')}</td>
      <td style="text-align:right;">▶</td>
    `;
    tbody.appendChild(row);

    // Expand row
    const expandRow = document.createElement('tr');
    expandRow.className = 'expand-row';
    expandRow.id = 'expand-' + globalIdx;
    expandRow.innerHTML = `
      <td colspan="5" class="expand-cell">
        ${renderExpandContent(d)}
      </td>
    `;
    tbody.appendChild(expandRow);
  });

  // Pagination
  renderHistoryPagination(totalPages);
}

function renderExpandContent(draw) {
  let html = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
  html += `<strong>第 ${draw.draw_no} 期</strong>`;
  html += renderBalls(draw.main_numbers, draw.special_number, 'ball-sm');
  if (draw.is_snowball) html += ' <span class="draw-snowball">❄️ 多寶</span>';
  html += '</div>';

  if (draw.prizes) {
    const unitBet = (draw.prizes._pool?.unit_bet) || 10;
    html += '<div class="expand-prizes">';
    const tierClassMap = { '頭獎': 'prize-1st', '二獎': 'prize-2nd', '三獎': 'prize-3rd' };
    for (const name of PRIZE_NAMES) {
      const p = draw.prizes[name];
      if (p) {
        // 中獎注數 = prize.winners / unit_bet
        const winningUnits = (p.winners / unitBet).toFixed(1);
        const tierClass = tierClassMap[name] || 'prize-other';
        html += `
          <div class="expand-prize-item ${tierClass}">
            <div class="prize-name">${name}</div>
            <div class="prize-detail">
              ${formatCurrency(p.amount)} × ${winningUnits} 注
            </div>
          </div>`;
      }
    }
    html += '</div>';
  } else {
    html += '<p style="color:var(--text-light);font-size:0.85rem;">暫無派彩資料</p>';
  }

  return html;
}

function toggleExpandRow(idx) {
  const el = document.getElementById('expand-' + idx);
  if (el) {
    el.classList.toggle('show');
    // Toggle arrow
    const row = document.querySelector(`tr.draw-row[data-idx="${idx}"]`);
    if (row) {
      const arrow = row.querySelector('td:last-child');
      arrow.textContent = el.classList.contains('show') ? '▼' : '▶';
    }
  }
}

function renderHistoryPagination(totalPages) {
  const pag = document.getElementById('historyPagination');
  if (totalPages <= 1) {
    pag.innerHTML = '';
    return;
  }

  const { page } = historyState;
  let html = '';

  html += `<button ${page === 1 ? 'disabled' : ''} onclick="goToPage(1)">««</button>`;
  html += `<button ${page === 1 ? 'disabled' : ''} onclick="goToPage(${page - 1})">«</button>`;
  html += `<span class="page-info">第 ${page} / ${totalPages} 頁</span>`;
  html += `<button ${page === totalPages ? 'disabled' : ''} onclick="goToPage(${page + 1})">»</button>`;
  html += `<button ${page === totalPages ? 'disabled' : ''} onclick="goToPage(${totalPages})">»»</button>`;

  pag.innerHTML = html;
}

function goToPage(p) {
  historyState.page = p;
  renderHistoryPage();
  const el = document.getElementById('module-history');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==================== Module 4: Prize Checker ====================

let checkerState = {
  betType: 'single',      // 'single' | 'multiple' | 'banker'
  mainNumbers: [],        // 單式／複式：已選號碼池
  bankerNumbers: [],      // 膽拖：膽碼（每注必中選）
  legNumbers: [],         // 膽拖：腳碼（候選號碼）
  pickTarget: 'banker',   // 膽拖模式下，目前點擊要加入「膽碼」還是「腳碼」
};

const CHECKER_SINGLE_COUNT = 6;   // 單式必須剛好 6 個號碼
const CHECKER_MAX_BANKERS = 5;    // 膽拖的膽碼最多 5 個（至少要留 1 個名額給腳碼）

function initChecker() {
  const grid = document.getElementById('checkerGrid');
  if (!grid) return;

  ensureCheckerControls();

  if (grid.children.length === 0) {
    for (let i = 1; i <= 49; i++) {
      const btn = document.createElement('button');
      btn.className = 'number-btn';
      btn.setAttribute('data-num', i);
      // Color group via data attribute for CSS styling
      const group = getBallColorGroup(i);
      btn.setAttribute('data-ball-group', group);
      btn.textContent = i;
      btn.onclick = () => toggleCheckerNumber(i, btn);
      grid.appendChild(btn);
    }
  }

  updateCheckerDisplay();
}

function getBallColorGroup(num) {
  if (HKJC_RED_BALLS.has(num))   return 'red';
  if (HKJC_BLUE_BALLS.has(num))  return 'blue';
  if (HKJC_GREEN_BALLS.has(num)) return 'green';
  return 'red';
}

/** 取得號碼球對應的顏色值 (用於 Chart.js 等需要 CSS 色碼的場景) */
function getBallFgColor(num) {
  if (HKJC_RED_BALLS.has(num))   return '#d32f2f';
  if (HKJC_BLUE_BALLS.has(num))  return '#1565c0';
  if (HKJC_GREEN_BALLS.has(num)) return '#2e7d32';
  return '#d32f2f';
}

/** 動態插入「投注方式」選單、膽／腳切換按鈕與特別號碼下拉選單（若尚未存在） */
let _checkerControlsBuilt = false;
function ensureCheckerControls() {
  if (_checkerControlsBuilt) return;
  const grid = document.getElementById('checkerGrid');
  if (!grid) return;
  _checkerControlsBuilt = true;

  // 投注方式選單（單式 / 複式 / 膽拖）+ 全選按鈕
  grid.insertAdjacentHTML('beforebegin', `
    <div class="bet-type-selector" id="checkerBetTypeSelector">
      <button type="button" class="bet-type-btn active" data-type="single">單式</button>
      <button type="button" class="bet-type-btn" data-type="multiple">複式</button>
      <button type="button" class="bet-type-btn" data-type="banker">膽拖</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btnSelectAllChecker" style="margin-left:auto;">📋 全選</button>
    </div>
    <div class="bet-type-selector" id="checkerBankerLegToggle" style="display:none;">
      <button type="button" class="bet-type-btn active" data-target="banker">目前點選：膽碼</button>
      <button type="button" class="bet-type-btn" data-target="leg">目前點選：腳碼</button>
    </div>
    <div id="checkerUnitsPreview" class="checker-units-preview"></div>
  `);

  document.querySelectorAll('#checkerBetTypeSelector .bet-type-btn').forEach(btn => {
    btn.onclick = () => setCheckerBetType(btn.dataset.type);
  });
  document.querySelectorAll('#checkerBankerLegToggle .bet-type-btn').forEach(btn => {
    btn.onclick = () => {
      checkerState.pickTarget = btn.dataset.target;
      document.querySelectorAll('#checkerBankerLegToggle .bet-type-btn').forEach(b => {
        b.classList.toggle('active', b === btn);
      });
    };
  });

  // 全選按鈕
  const btnAll = document.getElementById('btnSelectAllChecker');
  if (btnAll) btnAll.onclick = selectAllChecker;
}

/** 切換投注方式時，重置目前已選的號碼 */
function setCheckerBetType(type) {
  checkerState.betType = type;
  checkerState.mainNumbers = [];
  checkerState.bankerNumbers = [];
  checkerState.legNumbers = [];
  checkerState.pickTarget = 'banker';

  document.querySelectorAll('#checkerBetTypeSelector .bet-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  const legToggle = document.getElementById('checkerBankerLegToggle');
  if (legToggle) legToggle.style.display = type === 'banker' ? 'flex' : 'none';

  updateCheckerDisplay();

  const resultDiv = document.getElementById('checkerResult');
  if (resultDiv) resultDiv.innerHTML =
    '<div class="result-none">請先選擇號碼，然後點擊「比對中獎」</div>';
}

function toggleCheckerNumber(num, btn) {
  const state = checkerState;

  if (state.betType === 'single') {
    if (state.mainNumbers.includes(num)) {
      state.mainNumbers = state.mainNumbers.filter(n => n !== num);
    } else if (state.mainNumbers.length < CHECKER_SINGLE_COUNT) {
      state.mainNumbers = [...state.mainNumbers, num];
    } else {
      alert(`單式投注只可選擇 ${CHECKER_SINGLE_COUNT} 個正選號碼，請先取消已選號碼`);
      return;
    }
  } else if (state.betType === 'multiple') {
    if (state.mainNumbers.includes(num)) {
      state.mainNumbers = state.mainNumbers.filter(n => n !== num);
    } else {
      state.mainNumbers = [...state.mainNumbers, num];
    }
  } else if (state.betType === 'banker') {
    if (state.bankerNumbers.includes(num)) {
      state.bankerNumbers = state.bankerNumbers.filter(n => n !== num);
    } else if (state.legNumbers.includes(num)) {
      state.legNumbers = state.legNumbers.filter(n => n !== num);
    } else if (state.pickTarget === 'banker') {
      if (state.bankerNumbers.length >= CHECKER_MAX_BANKERS) {
        alert(`膽碼最多只可選擇 ${CHECKER_MAX_BANKERS} 個（需保留至少 1 個名額給腳碼）`);
        return;
      }
      state.bankerNumbers = [...state.bankerNumbers, num];
    } else {
      state.legNumbers = [...state.legNumbers, num];
    }
  }

  updateCheckerDisplay();
}

/** 全選：依投注模式一鍵選取全部 49 個號碼 */
function selectAllChecker() {
  const state = checkerState;
  const type = state.betType;

  if (type === 'single') {
    // 單式：隨機選取 6 個（或直接選前 6 個以便快速測試）
    state.mainNumbers = [1, 2, 3, 4, 5, 6];
  } else if (type === 'multiple') {
    state.mainNumbers = [];
    for (let i = 1; i <= 49; i++) state.mainNumbers.push(i);
  } else if (type === 'banker') {
    state.bankerNumbers = [];
    state.legNumbers = [];
    state.specialNumber = null;
    // 膽拖全選：前 5 個為膽碼，其餘 44 個為腳碼
    for (let i = 1; i <= 5; i++) state.bankerNumbers.push(i);
    for (let i = 6; i <= 49; i++) state.legNumbers.push(i);
  }

  updateCheckerDisplay();
}

function updateCheckerDisplay() {
  const state = checkerState;
  const container = document.getElementById('checkerSelected');

  let html = '';
  if (state.betType === 'banker') {
    const sortedBanker = [...state.bankerNumbers].sort((a, b) => a - b);
    const sortedLeg = [...state.legNumbers].sort((a, b) => a - b);
    html += `<div class="checker-group-label">膽碼（${state.bankerNumbers.length}）</div>`;
    html += `<div class="selected-numbers">${sortedBanker.map(n => renderBall(n, 'ball-sm')).join('') ||
      '<span style="color:var(--text-light);">尚未選擇</span>'}</div>`;
    html += `<div class="checker-group-label">腳碼（${state.legNumbers.length}）</div>`;
    html += `<div class="selected-numbers">${sortedLeg.map(n => renderBall(n, 'ball-sm')).join('') ||
      '<span style="color:var(--text-light);">尚未選擇</span>'}</div>`;
  } else {
    const sorted = [...state.mainNumbers].sort((a, b) => a - b);
    html += sorted.map(n => renderBall(n, 'ball-sm')).join('');
    if (!html) html = '<span style="color:var(--text-light);">尚未選擇號碼</span>';
  }
  container.innerHTML = html;

  // Update grid button states
  document.querySelectorAll('#checkerGrid .number-btn').forEach(btn => {
    const n = parseInt(btn.getAttribute('data-num'));
    btn.classList.remove('selected', 'banker-selected', 'leg-selected');
    if (state.betType === 'banker') {
      if (state.bankerNumbers.includes(n)) btn.classList.add('banker-selected');
      else if (state.legNumbers.includes(n)) btn.classList.add('leg-selected');
    } else if (state.mainNumbers.includes(n)) {
      btn.classList.add('selected');
    }
  });

  updateCheckerUnitsPreview();
}

/** 即時顯示目前投注方式的注數（與投注金額計算機的邏輯一致） */
function updateCheckerUnitsPreview() {
  const el = document.getElementById('checkerUnitsPreview');
  if (!el) return;
  const state = checkerState;

  let text = '';
  if (state.betType === 'multiple') {
    const n = state.mainNumbers.length;
    if (n >= 7) {
      text = `複式 ${n} 個號碼 = C(${n},6) = ${combination(n, 6).toLocaleString()} 注`;
    } else if (n > 0) {
      text = `複式投注最少需選擇 7 個號碼（目前已選 ${n} 個）`;
    }
  } else if (state.betType === 'banker') {
    const b = state.bankerNumbers.length;
    const l = state.legNumbers.length;
    const need = 6 - b;
    if (b > 0 && need >= 0 && l >= need && need >= 0) {
      text = `膽拖 ${b} 膽 + ${l} 腳 = C(${l},${need}) = ${combination(l, need).toLocaleString()} 注`;
    } else if (b > 0) {
      text = `腳碼數量不足，尚需最少 ${Math.max(need, 0)} 個腳碼`;
    }
  }
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

/** 依「中幾個正選號碼」＋「是否中特別號碼」判斷獎級 */
function resolveCheckerPrizeTier(matchMain, matchSpecial) {
  if (matchMain === 6) return '頭獎';
  if (matchMain === 5 && matchSpecial) return '二獎';
  if (matchMain === 5) return '三獎';
  if (matchMain === 4 && matchSpecial) return '四獎';
  if (matchMain === 4) return '五獎';
  if (matchMain === 3 && matchSpecial) return '六獎';
  if (matchMain === 3) return '七獎';
  return null;
}

function checkerPrizeAmount(draw, tier) {
  if (tier === '頭獎') return draw.prizes?.['頭獎']?.amount || 8000000;
  if (tier === '二獎') return draw.prizes?.['二獎']?.amount;
  if (tier === '三獎') return draw.prizes?.['三獎']?.amount;
  if (tier === '四獎') return 9600;
  if (tier === '五獎') return 640;
  if (tier === '六獎') return 320;
  if (tier === '七獎') return 40;
  return 0;
}

/**
 * 複式投注：從已選的號碼池中，計算各「中幾個正選號碼」對應的注數分佈。
 * 用超幾何分佈的組合公式直接計算，不需逐注枚舉，號碼池再大也能即時算出。
 */
function computeMultipleDistribution(pool, drawMain) {
  const hit = pool.filter(n => drawMain.includes(n)).length; // 號碼池中命中正選的數目
  const miss = pool.length - hit;
  const dist = {};
  for (let k = 0; k <= 6; k++) {
    const count = combination(hit, k) * combination(miss, 6 - k);
    if (count > 0) dist[k] = count;
  }
  return dist;
}

/**
 * 膽拖投注：膽碼每注必選，只從腳碼中選出剩餘名額，同樣用組合公式直接計算分佈。
 */
function computeBankerDistribution(bankers, legs, drawMain) {
  const need = 6 - bankers.length;
  const hitBanker = bankers.filter(n => drawMain.includes(n)).length;
  const hitLeg = legs.filter(n => drawMain.includes(n)).length;
  const missLeg = legs.length - hitLeg;
  const dist = {};
  for (let j = 0; j <= need; j++) {
    const count = combination(hitLeg, j) * combination(missLeg, need - j);
    if (count > 0) {
      const k = hitBanker + j;
      dist[k] = (dist[k] || 0) + count;
    }
  }
  return dist;
}

function doCheck() {
  try {
    const resultDiv = document.getElementById('checkerResult');
    if (!resultDiv) {
      console.error('checkerResult element not found');
      return;
    }

    if (!Store.latestDraw) {
      resultDiv.innerHTML =
        '<div class="result-none">⚠️ 無法載入最新開獎結果，請確認資料已正確載入</div>';
      return;
    }

    const draw = Store.latestDraw;
    if (!draw.main_numbers || !Array.isArray(draw.main_numbers)) {
      resultDiv.innerHTML = '<div class="result-none">⚠️ 開獎資料格式異常</div>';
      return;
    }

    const state = checkerState;
    const unitBet = (draw.prizes?._pool?.unit_bet) || 10;

    // 自動偵測：用戶所選號碼中是否包含開獎的特別號碼
    const getUserNumbers = () => {
      if (state.betType === 'banker') return [...state.bankerNumbers, ...state.legNumbers];
      return state.mainNumbers;
    };
    const userNums = getUserNumbers();
    const matchSpecial = userNums.includes(draw.special_number);

    if (state.betType === 'single') {
      if (state.mainNumbers.length < CHECKER_SINGLE_COUNT) {
        alert(`請選擇 ${CHECKER_SINGLE_COUNT} 個正選號碼！`);
        return;
      }
      const matchMain = state.mainNumbers.filter(n => draw.main_numbers.includes(n)).length;
      renderSingleCheckResult(draw, state.mainNumbers, matchMain, matchSpecial, unitBet);
      return;
    }

    if (state.betType === 'multiple') {
      if (state.mainNumbers.length < 7) {
        alert('複式投注最少需要選擇 7 個號碼！（6 個或以下請使用「單式」）');
        return;
      }
      const dist = computeMultipleDistribution(state.mainNumbers, draw.main_numbers);
      const totalUnits = combination(state.mainNumbers.length, 6);
      renderMultiCheckResult(draw, state.mainNumbers, dist, totalUnits, matchSpecial, unitBet);
      return;
    }

    if (state.betType === 'banker') {
      const { bankerNumbers, legNumbers } = state;
      if (bankerNumbers.length < 1) {
        alert('請至少選擇 1 個膽碼！');
        return;
      }
      const need = 6 - bankerNumbers.length;
      if (legNumbers.length < need) {
        alert(`腳碼數量不足，尚需最少 ${need} 個腳碼！`);
        return;
      }
      const dist = computeBankerDistribution(bankerNumbers, legNumbers, draw.main_numbers);
      const totalUnits = combination(legNumbers.length, need);
      const fullPool = [...bankerNumbers, ...legNumbers];
      renderMultiCheckResult(draw, fullPool, dist, totalUnits, matchSpecial, unitBet);
      return;
    }
  } catch (err) {
    console.error('doCheck error:', err);
    const resultDiv = document.getElementById('checkerResult');
    if (resultDiv) {
      resultDiv.innerHTML = `<div class="error-msg">比對過程發生錯誤：${err.message}</div>`;
    }
  }
}

/** 單式比對結果（系統自動偵測特別號碼命中） */
function renderSingleCheckResult(draw, mainNumbers, matchMain, matchSpecial, unitBet) {
  const resultDiv = document.getElementById('checkerResult');
  const tier = resolveCheckerPrizeTier(matchMain, matchSpecial);
  const prizeAmount = tier ? checkerPrizeAmount(draw, tier) : null;
  const sortedMain = [...mainNumbers].sort((a, b) => a - b);
  const winningUnits = prizeAmount ? (prizeAmount / unitBet).toFixed(1) : '0.0';
  const specialNote = matchSpecial ? '<div style="color:var(--accent-dark);font-size:0.85rem;margin-top:4px;">🎯 你的號碼中包含特別號碼 <strong>' + draw.special_number + '</strong>！</div>' : '';

  if (tier) {
    const emoji = tier === '頭獎' ? '🎉🏆🎊' :
      (tier === '二獎' || tier === '三獎') ? '🎉' : '✨';
    resultDiv.innerHTML = `
      <div class="result-display">
        <div class="result-icon">${emoji}</div>
        <div class="result-level">恭喜！你中了<strong>${tier}</strong>！</div>
        <div class="result-amount">${formatCurrency(prizeAmount)}</div>
        <div style="color:var(--text-secondary);font-size:0.9rem;margin-top:4px;">
          相等於 <strong>${winningUnits}</strong> 注（每注 HK$ ${unitBet}）
        </div>
        ${specialNote}
        <div class="result-matched">
          <div class="matched-label">中獎比對詳情</div>
          <div>中 ${matchMain} 個正選號碼${matchSpecial ? ' + 特別號碼' : ''}</div>
          <div class="ball-row" style="justify-content:center;margin-top:8px;">
            你的號碼：${renderBalls(sortedMain, null, 'ball-sm')}
          </div>
          <div class="ball-row" style="justify-content:center;margin-top:8px;">
            開獎號碼：${renderBalls(draw.main_numbers, draw.special_number, 'ball-sm')}
          </div>
        </div>
      </div>`;
  } else {
    resultDiv.innerHTML = `
      <div class="result-display">
        <div class="result-icon">😔</div>
        <div class="result-level">未中獎</div>
        <p style="color:var(--text-secondary);margin-top:8px;">
          你中了 ${matchMain} 個正選號碼${matchSpecial ? ' + 特別號碼' : ''}，未達派彩門檻（最少需中 3 個）
        </p>
        ${specialNote}
        <div class="result-matched">
          <div class="ball-row" style="justify-content:center;margin-top:8px;">
            你的號碼：${renderBalls(sortedMain, null, 'ball-sm')}
          </div>
          <div class="ball-row" style="justify-content:center;margin-top:8px;">
            開獎號碼：${renderBalls(draw.main_numbers, draw.special_number, 'ball-sm')}
          </div>
        </div>
      </div>`;
  }
}

/** 複式／膽拖比對結果：依「中幾個正選號碼」分組列出每級的中獎注數與金額 */
function renderMultiCheckResult(draw, fullPool, dist, totalUnits, matchSpecial, unitBet) {
  const resultDiv = document.getElementById('checkerResult');
  const sortedPool = [...fullPool].sort((a, b) => a - b);

  const rows = [];
  let totalWinUnits = 0;
  let totalAmount = 0;

  for (let k = 6; k >= 3; k--) {
    const count = dist[k] || 0;
    if (count <= 0) continue;
    const tier = resolveCheckerPrizeTier(k, matchSpecial);
    if (!tier) continue;
    const amount = checkerPrizeAmount(draw, tier);
    if (!amount) continue;
    const subtotal = amount * count;
    totalWinUnits += count;
    totalAmount += subtotal;
    rows.push({ k, tier, count, amount, subtotal });
  }

  const specialNote = matchSpecial ? '<div class="matched-label" style="margin-top:8px;">🎯 你的號碼中包含特別號碼 <strong>' + draw.special_number + '</strong>，獎級已相應提升！</div>' : '';

  const ballsBlock = `
    <div class="ball-row" style="justify-content:center;margin-top:8px;">
      你的號碼：${renderBalls(sortedPool, null, 'ball-sm')}
    </div>
    <div class="ball-row" style="justify-content:center;margin-top:8px;">
      開獎號碼：${renderBalls(draw.main_numbers, draw.special_number, 'ball-sm')}
    </div>`;

  if (rows.length === 0) {
    resultDiv.innerHTML = `
      <div class="result-display">
        <div class="result-icon">😔</div>
        <div class="result-level">未中獎</div>
        <p style="color:var(--text-secondary);margin-top:8px;">
          共 ${totalUnits.toLocaleString()} 注，未達派彩門檻（最少需中 3 個正選號碼）
        </p>
        <div class="result-matched">${ballsBlock}</div>
      </div>`;
    return;
  }

  const rowsHtml = rows.map(r => `
    <div class="calc-breakdown-item">
      <span>${r.tier}（中 ${r.k} 個正選號碼${matchSpecial ? '＋特別號碼' : ''}）× ${r.count.toLocaleString()} 注</span>
      <span><strong>${formatCurrency(r.subtotal)}</strong></span>
    </div>`).join('');

  resultDiv.innerHTML = `
    <div class="result-display">
      <div class="result-icon">🎉</div>
      <div class="result-level">恭喜！複式／膽拖中獎！</div>
      <div class="result-amount">${formatCurrency(totalAmount)}</div>
      <div style="color:var(--text-secondary);font-size:0.9rem;margin-top:4px;">
        共 ${totalWinUnits.toLocaleString()} 注中獎（總投注 ${totalUnits.toLocaleString()} 注，每注 HK$ ${unitBet}）
      </div>
      ${specialNote}
      <div class="result-matched" style="text-align:left;">
        <div class="matched-label">中獎注數明細</div>
        ${rowsHtml}
      </div>
      <div class="result-matched">${ballsBlock}</div>
    </div>`;
}

function clearChecker() {
  checkerState.mainNumbers = [];
  checkerState.bankerNumbers = [];
  checkerState.legNumbers = [];
  updateCheckerDisplay();
  document.getElementById('checkerResult').innerHTML =
    '<div class="result-none">請先選擇號碼，然後點擊「比對中獎」</div>';
}

/** 確保比對按鈕的事件監聽器已正確綁定（備援機制） */
let _checkerEventsEnsured = false;
function ensureCheckerEvents() {
  if (_checkerEventsEnsured) return;
  _checkerEventsEnsured = true;
  const btnCheck = document.getElementById('btnCheck');
  const btnClear = document.getElementById('btnClearCheck');
  if (btnCheck) {
    // 移除舊監聽器避免重複綁定（使用新函數引用替換）
    btnCheck.replaceWith(btnCheck.cloneNode(true));
    document.getElementById('btnCheck').addEventListener('click', doCheck);
  }
  if (btnClear) {
    btnClear.replaceWith(btnClear.cloneNode(true));
    document.getElementById('btnClearCheck').addEventListener('click', clearChecker);
  }
}


// ==================== Module 5: Bet Calculator ====================

let calcMode = 'single';

/** 依範圍動態產生 <option>，避免在 HTML 中寫死上限（例如原本複式/腳碼被卡在 10 個） */
function populateNumberSelect(selectEl, min, max, suffix, keepValue) {
  if (!selectEl) return;
  const prevValue = keepValue !== undefined ? keepValue : parseInt(selectEl.value);
  let html = '';
  for (let i = min; i <= max; i++) {
    html += `<option value="${i}">${i}${suffix}</option>`;
  }
  selectEl.innerHTML = html;
  if (prevValue >= min && prevValue <= max) {
    selectEl.value = prevValue;
  }
}

/** 腳的可選範圍會隨「膽」的數量變動：最少 6-膽，最多 49-膽 */
function refreshLegCountOptions() {
  const legSelect = document.getElementById('legCount');
  if (!legSelect) return;
  const banker = parseInt(document.getElementById('bankerCount')?.value) || 1;
  const minLeg = Math.max(1, 6 - banker);
  const maxLeg = 49 - banker;
  populateNumberSelect(legSelect, minLeg, maxLeg, ' 腳');
}

function initCalculator() {
  // Bet type switch
  document.querySelectorAll('#betTypeSelector .bet-type-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#betTypeSelector .bet-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calcMode = btn.dataset.type;
      updateCalcForm();
    };
  });

  // 選項只需產生一次；之後保留使用者目前的選擇
  const multipleSelect = document.getElementById('multipleCount');
  if (multipleSelect && multipleSelect.options.length === 0) {
    populateNumberSelect(multipleSelect, 7, 49, ' 個號碼', 7);
  }
  const legSelect = document.getElementById('legCount');
  if (legSelect && legSelect.options.length === 0) {
    refreshLegCountOptions();
  }
  // 膽的數量改變時，腳的可選範圍要跟著調整
  const bankerSelect = document.getElementById('bankerCount');
  if (bankerSelect) bankerSelect.onchange = refreshLegCountOptions;

  document.getElementById('btnCalculate').onclick = doCalculate;

  // 初次初始化時套用目前模式（單式預設隱藏號碼選擇器）
  updateCalcForm();
}

function updateCalcForm() {
  const multipleGroup = document.getElementById('multipleGroup');
  const bankerGroup = document.getElementById('bankerGroup');
  const legGroup = document.getElementById('legGroup');

  multipleGroup.style.display = calcMode === 'multiple' ? 'block' : 'none';
  bankerGroup.style.display = calcMode === 'banker' ? 'block' : 'none';
  legGroup.style.display = calcMode === 'banker' ? 'block' : 'none';

  // 單式模式：顯示固定提示，確保號碼總數不可調整
  const existingInfo = document.getElementById('singleModeInfo');
  if (calcMode === 'single') {
    if (!existingInfo) {
      const infoEl = document.createElement('div');
      infoEl.id = 'singleModeInfo';
      infoEl.style.cssText = 'margin-top:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:0.9rem;color:var(--primary-light);';
      infoEl.innerHTML = '<strong>單式投注</strong>：固定選擇 <strong>6 個號碼</strong>，總注數 = 1 注';
      document.querySelector('#module-calculator .calc-form-section').insertBefore(
        infoEl, document.getElementById('btnCalculate')
      );
    }
    if (existingInfo) existingInfo.style.display = 'block';
  } else if (existingInfo) {
    existingInfo.style.display = 'none';
  }
}

function doCalculate() {
  let units = 0;
  let detail = '';

  if (calcMode === 'single') {
    units = 1;
    detail = '單式 1 注';
  } else if (calcMode === 'multiple') {
    const n = parseInt(document.getElementById('multipleCount').value);
    units = combination(n, 6);
    detail = `複式 ${n} 個號碼 = C(${n},6) = ${units.toLocaleString()} 注`;
  } else if (calcMode === 'banker') {
    const banker = parseInt(document.getElementById('bankerCount').value);
    const leg = parseInt(document.getElementById('legCount').value);
    const totalNums = banker + leg;
    if (totalNums < 6) {
      alert('膽 + 腳總數必須至少為 6！');
      return;
    }
    const needFromLeg = 6 - banker;
    if (needFromLeg > leg) {
      alert('腳的數量不足以組成 6 個號碼！');
      return;
    }
    units = combination(leg, needFromLeg);
    detail = `膽拖 ${banker} 膽 + ${leg} 腳 = C(${leg},${needFromLeg}) = ${units.toLocaleString()} 注`;
  }

  const unitPrice = 10;
  const total = units * unitPrice;

  document.getElementById('calcResult').innerHTML = `
    <div class="calc-summary">
      <div style="font-size:0.9rem;opacity:0.85;margin-bottom:8px;">投注金額</div>
      <div class="calc-total">HK$ ${total.toLocaleString()}</div>
      <div class="calc-detail">${detail}</div>
    </div>
    <div class="calc-breakdown" style="margin-top:12px;">
      <div class="calc-breakdown-item">
        <span>投注注數</span>
        <span><strong>${units.toLocaleString()} 注</strong></span>
      </div>
      <div class="calc-breakdown-item">
        <span>每注金額</span>
        <span>HK$ ${unitPrice}</span>
      </div>
      <div class="calc-breakdown-item">
        <span>總投注額</span>
        <span style="font-weight:700;color:var(--success);">HK$ ${total.toLocaleString()}</span>
      </div>
    </div>
  `;
}

// ==================== Module 6: Statistics ====================

let statsCharts = {};

// Shared font config — applied to all charts for consistent readability
const CHART_FONT = { family: 'Public Sans, Noto Sans TC, sans-serif', size: 13 };
const CHART_FONT_TITLE = { family: 'Lexend Mega, Noto Sans TC, sans-serif', size: 14, weight: '600' };
const CHART_FONT_LEGEND = { family: 'Public Sans, Noto Sans TC, sans-serif', size: 12 };
const CHART_FONT_TICKS = { family: 'Public Sans, Noto Sans TC, sans-serif', size: 11 };

// ────── Chart Tooltip 解說內容 ──────
const CHART_HELP = {
  chartFrequency: { title: '號碼出現頻率', p1: '統計 49 號碼時代所有開獎中每個號碼出現的總次數。', p2: '柱體顏色 = 號碼球官方配色 (紅/藍/綠)。柱越高代表該號碼歷史上越「熱」。', p3: 'Tips: 熱號 ≠ 未來必出，僅為歷史趨勢參考。' },
  chartOddEven: { title: '奇偶號碼比例', p1: '統計每期 6 個號碼中「偶數」的個數分布（0偶6奇 ~ 6偶0奇）。', p2: '理想隨機分布下 3偶3奇 機率最高(~36%)。偏極端(0偶或6偶)的組合較少見。', p3: 'Tips: 勾選此分佈可篩選特定奇偶比例的組合。' },
  chartSumRange: { title: '號碼總和範圍', p1: '每期 6 個主號碼加總後的分佈。最小值 = 21 (1+2+3+4+5+6)，最大值 = 279。', p2: '歷史上 80%+ 期數總和落在 100-200 之間。總和過低(<80)或過高(>220) 的組合極少出現。', p3: 'Tips: 選號時可用總和判斷「大小平衡」。' },
  chartBigSmall: { title: '大小號碼比例', p1: '以 24 為界：≤24 =「小號」、>24 =「大號」。統計每期 6 個號碼中大號的個數。', p2: '平衡比例 (3大3小 或 4大2小 / 2大4小) 最常見，合計佔約 80%。6大0小 或 0大6小 極少。', p3: 'Tips: 配合總和使用可縮小選號範圍。' },
  chartConsecutive: { title: '連號分布', p1: '統計每期 6 個號碼中，出現幾對「連續號碼」(如 11-12)。', p2: '0對連號最常見(~45%)，1對約35%，2對以上愈來愈少。4對以上連號=全部號碼幾乎相連，極罕見。', p3: 'Tips: 選號時可透過排除連號來減少組合數。' },
  chartSpan: { title: '號碼跨度分佈', p1: 'Span = 最大值 - 最小值。衡量 6 個號碼在 1-49 範圍中的「覆蓋寬度」。', p2: '跨度 30-45 最常見(~80%)。跨度過小(<15)代表 6 個號碼全擠在窄區，過大(46+)代表極端分散。', p3: 'Tips: 跨度 < 20 或 > 45 合計不到 5%，選號時可避開。' },
  chartAC: { title: 'AC 值分佈', p1: 'AC 值 (D - n + 1)：衡量號碼間的「不規則程度」。D = 排序後相鄰差絕對值總和。', p2: 'AC = 0 等於全連號(1,2,3,4,5,6)，歷史上從未出現。實際分佈集中在 25-39 (67.7%)，平均 30.5。', p3: 'Tips: AC < 10 或 > 40 合計不到 12%，避開可大幅減少無效組合。' },
  chartOmission: { title: '遺漏值排行', p1: '顯示每個號碼「距離最近一次開出」的期數。gap 越大代表該號碼越「冷」。', p2: '顏色分組：綠(gap≤5) = 近期熱號、黃(6-15) = 溫和、紅(>15) = 長期未出。', p3: 'Tips: 反向策略 — 高遺漏值號碼可能迎來「反彈」。正向策略 — 追熱號。' },
  chartMod3: { title: '除三餘數分佈', p1: '又稱「路公碼」。將 1-49 依 n%3 結果分為 3 路：餘0(16個)、餘1(17個)、餘2(16個)。', p2: '最常見為 2-2-2 (14.75%)。極端型如 5-1-0 (一路獨大) 或 0-0-6 (僅一路) 極罕見。', p3: 'Tips: 避開 ddd-5-1-0、0-0-6 等極端比例，選 2-2-2 或 1-2-3 附近組合最安全。' },
  chartHotCold: { title: '冷熱轉折趨勢', p1: '以 30 期為滑動窗口，計算「前 5 熱號」在下一期的命中個數百分比。', p2: '命中率穩定在 40-60% 表示熱號持續有效。持續下滑(低於 30%)可能預示冷號反彈。', p3: 'Tips: 觀察折線斜率。陡升 = 熱號集中爆發，陡降 = 冷號可能抬頭。' },
};

function renderChartTooltips() {
  document.querySelectorAll('.stats-card .chart-title').forEach(el => {
    // 只處理含有 data-chart 屬性的 (我們手動加入)
    if (el.querySelector('.info-icon')) return; // 已加入
    // Find the parent container to wrap
    const container = el.parentElement;
    const canvasId = container.querySelector('canvas')?.id;
    if (!canvasId || !CHART_HELP[canvasId]) return;
    const help = CHART_HELP[canvasId];

    // 替換 title 為 row 結構
    const originalText = el.textContent;
    el.innerHTML = '';
    el.className = 'chart-title chart-title-row';
    const span = document.createElement('span');
    span.textContent = originalText;
    el.appendChild(span);

    const icon = document.createElement('button');
    icon.className = 'info-icon';
    icon.textContent = '?';
    icon.setAttribute('aria-label', '查看 ' + help.title + ' 解說');
    icon.onclick = (e) => { e.stopPropagation(); toggleChartTooltip(icon, canvasId); };
    el.appendChild(icon);

    // Create tooltip element
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.id = 'tip-' + canvasId;
    tip.innerHTML = '<button class="close-btn" onclick="this.parentElement.classList.remove(\'show\')">x</button>' +
      '<strong>' + help.title + '</strong>' +
      '<p>' + help.p1 + '</p>' +
      '<p>' + help.p2 + '</p>' +
      '<p>' + help.p3 + '</p>';
    container.style.position = 'relative';
    container.appendChild(tip);
  });

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.chart-tooltip') && !e.target.closest('.info-icon')) {
      document.querySelectorAll('.chart-tooltip.show').forEach(t => t.classList.remove('show'));
    }
  });
}

function toggleChartTooltip(icon, canvasId) {
  const tip = document.getElementById('tip-' + canvasId);
  if (!tip) return;
  // Close others
  document.querySelectorAll('.chart-tooltip.show').forEach(t => { if (t !== tip) t.classList.remove('show'); });
  tip.classList.toggle('show');
  // Position relative to icon
  if (tip.classList.contains('show')) {
    const rect = icon.getBoundingClientRect();
    const parentRect = icon.closest('.stats-card').getBoundingClientRect();
    tip.style.top = (rect.bottom - parentRect.top + 6) + 'px';
    tip.style.left = (rect.left - parentRect.left - 250) + 'px';
    // Ensure tooltip doesn't overflow left
    if (parseFloat(tip.style.left) < 0) tip.style.left = '4px';
  }
}

function renderStats() {
  try {
    if (!Store.dataLoaded) {
      document.getElementById('statsLoading').style.display = 'flex';
      return;
    }
    document.getElementById('statsLoading').style.display = 'none';
    document.getElementById('statsContent').style.display = 'block';

    // Only use 49-number era data for stats
    const draws = Store.draws;

  // Destroy existing charts
  Object.values(statsCharts).forEach(c => c.destroy());
  statsCharts = {};

  // Frequency analysis
  const freq = new Array(50).fill(0);
  draws.forEach(d => {
    d.main_numbers.forEach(n => freq[n]++);
  });

  const freqSorted = [];
  for (let i = 1; i <= 49; i++) {
    freqSorted.push({ num: i, count: freq[i], pct: (freq[i] / draws.length * 100).toFixed(2) });
  }
  freqSorted.sort((a, b) => b.count - a.count);

  // Chart: Frequency
  const labels = freqSorted.map(f => f.num.toString());
  const data = freqSorted.map(f => f.count);
  const bgColors = freqSorted.map(f => getBallFgColor(f.num));

  const freqCtx = document.getElementById('chartFrequency').getContext('2d');
  const isSmallScreen = window.innerWidth < 768;
  statsCharts.freq = new Chart(freqCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '出現次數',
        data,
        backgroundColor: bgColors,
        borderRadius: isSmallScreen ? 0 : 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            font: { ...CHART_FONT_TICKS, size: isSmallScreen ? 9 : 11 },
            autoSkip: true,
            maxTicksLimit: isSmallScreen ? 16 : 49,
            maxRotation: isSmallScreen ? 90 : 0,
            minRotation: isSmallScreen ? 60 : 0,
          },
        },
        y: { beginAtZero: false, ticks: { font: { ...CHART_FONT_TICKS, size: 11 } } },
      },
    },
  });

  // Chart: Odd/Even distribution
  const oddEvenDist = { '0偶6奇': 0, '1偶5奇': 0, '2偶4奇': 0, '3偶3奇': 0, '4偶2奇': 0, '5偶1奇': 0, '6偶0奇': 0 };
  draws.forEach(d => {
    const evenCount = d.main_numbers.filter(n => n % 2 === 0).length;
    const key = `${evenCount}偶${6 - evenCount}奇`;
    oddEvenDist[key] = (oddEvenDist[key] || 0) + 1;
  });

  const oeCtx = document.getElementById('chartOddEven').getContext('2d');
  const oeKeys = Object.keys(oddEvenDist);
  statsCharts.oddEven = new Chart(oeCtx, {
    type: 'pie',
    data: {
      labels: oeKeys,
      datasets: [{ data: oeKeys.map(k => oddEvenDist[k]), backgroundColor: [
        '#d32f2f', '#e53935', '#fb8c00', '#43a047', '#1e88e5', '#1565c0', '#7b1fa2'
      ]}],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: CHART_FONT_LEGEND } },
      },
    },
  });

  // Chart: Sum range distribution
  const sumRanges = {};
  draws.forEach(d => {
    const sum = d.main_numbers.reduce((a, b) => a + b, 0);
    const range = Math.floor(sum / 20) * 20;
    const key = `${range}-${range + 19}`;
    sumRanges[key] = (sumRanges[key] || 0) + 1;
  });

  const sumKeys = Object.keys(sumRanges).sort((a, b) => parseInt(a) - parseInt(b));
  const sumCtx = document.getElementById('chartSumRange').getContext('2d');
  statsCharts.sum = new Chart(sumCtx, {
    type: 'bar',
    data: {
      labels: sumKeys,
      datasets: [{
        label: '期數',
        data: sumKeys.map(k => sumRanges[k]),
        backgroundColor: '#283593',
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: CHART_FONT_TICKS } },
        y: { beginAtZero: true, ticks: { font: CHART_FONT_TICKS } },
      },
    },
  });

  // Chart: Big/Small distribution (≤24 small, >24 big)
  const bsDist = { '0小6大': 0, '1小5大': 0, '2小4大': 0, '3小3大': 0, '4小2大': 0, '5小1大': 0, '6小0大': 0 };
  draws.forEach(d => {
    const smallCount = d.main_numbers.filter(n => n <= 24).length;
    const key = `${smallCount}小${6 - smallCount}大`;
    bsDist[key] = (bsDist[key] || 0) + 1;
  });

  const bsKeys = Object.keys(bsDist);
  const bsCtx = document.getElementById('chartBigSmall').getContext('2d');
  statsCharts.bigSmall = new Chart(bsCtx, {
    type: 'doughnut',
    data: {
      labels: bsKeys,
      datasets: [{ data: bsKeys.map(k => bsDist[k]), backgroundColor: [
        '#43a047', '#66bb6a', '#fb8c00', '#ffa726', '#1e88e5', '#42a5f5', '#ab47bc'
      ]}],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: CHART_FONT_LEGEND } },
      },
    },
  });

  // ── 連號分析 ──────────────────────────────────────────
  // 1. 每期連續號碼對數分佈（0對～5對）
  const consecutiveDist = { '0對連號': 0, '1對連號': 0, '2對連號': 0, '3對連號': 0, '4對連號': 0, '5對連號': 0 };
  // 2. 具體連號組合計數（如 "11-12"）
  const pairCounts = {}; // { "11-12": 37, "12-13": 42, ... }

  draws.forEach(d => {
    const sorted = [...d.main_numbers].sort((a, b) => a - b);
    let pairCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] === 1) {
        pairCount++;
        const key = `${sorted[i - 1]}-${sorted[i]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
    const label = `${pairCount}對連號`;
    consecutiveDist[label] = (consecutiveDist[label] || 0) + 1;
  });

  const consecutiveKeys = Object.keys(consecutiveDist);
  const consCtx = document.getElementById('chartConsecutive').getContext('2d');
  statsCharts.consecutive = new Chart(consCtx, {
    type: 'bar',
    data: {
      labels: consecutiveKeys,
      datasets: [{
        label: '期數',
        data: consecutiveKeys.map(k => consecutiveDist[k]),
        backgroundColor: ['#66bb6a', '#43a047', '#fb8c00', '#e65100', '#c62828', '#8e24aa'],
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: CHART_FONT_TICKS } },
        y: { beginAtZero: true, ticks: { font: CHART_FONT_TICKS }, title: { display: true, text: '期數', font: CHART_FONT_TITLE } },
      },
    },
  });

  // ═══════ 1. 號碼跨度分佈 (Span = max - min) ═══════
  const spanDist = new Array(49).fill(0);
  draws.forEach(d => {
    const m = d.main_numbers;
    spanDist[m[m.length - 1] - m[0]]++;
  });
  // Bin 為 5 跨度一桶,共 ~10 桶
  const spanBuckets = { '10以下': 0, '11-15': 0, '16-20': 0, '21-25': 0, '26-30': 0, '31-35': 0, '36-40': 0, '41-45': 0, '46+': 0 };
  spanDist.forEach((cnt, span) => {
    if (span <= 10) spanBuckets['10以下'] += cnt;
    else if (span <= 15) spanBuckets['11-15'] += cnt;
    else if (span <= 20) spanBuckets['16-20'] += cnt;
    else if (span <= 25) spanBuckets['21-25'] += cnt;
    else if (span <= 30) spanBuckets['26-30'] += cnt;
    else if (span <= 35) spanBuckets['31-35'] += cnt;
    else if (span <= 40) spanBuckets['36-40'] += cnt;
    else if (span <= 45) spanBuckets['41-45'] += cnt;
    else spanBuckets['46+'] += cnt;
  });
  const spanKeys = Object.keys(spanBuckets);
  const spanCtx = document.getElementById('chartSpan').getContext('2d');
  statsCharts.span = new Chart(spanCtx, {
    type: 'bar',
    data: { labels: spanKeys, datasets: [{ label: '期數', data: spanKeys.map(k => spanBuckets[k]), backgroundColor: '#FFDE59', borderColor: '#000', borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { ...CHART_FONT_TICKS, size: isSmallScreen ? 9 : 11 }, maxRotation: 45, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { font: CHART_FONT_TICKS }, title: { display: true, text: '期數', font: CHART_FONT_TITLE } },
      },
    },
  });

  // ═══════ 2. AC 值分佈 (算術複雜度) ═══════
  // 標準中文樂透 AC 值: AC = D - (n-1), D 為排序後相鄰差絕對值總和, n=6
  // AC 範圍: 0(全連號)~48(1,2,3,4,5,49), 典型分佈 25-35
  const acDist = { '0-4': 0, '5-9': 0, '10-14': 0, '15-19': 0, '20-24': 0, '25-29': 0, '30-34': 0, '35-39': 0, '40+': 0 };
  draws.forEach(d => {
    const m = [...d.main_numbers].sort((a, b) => a - b);
    let D = 0;
    for (let i = 1; i < m.length; i++) D += Math.abs(m[i] - m[i - 1]);
    const ac = D - 5;
    if (ac <= 4) acDist['0-4']++;
    else if (ac <= 9) acDist['5-9']++;
    else if (ac <= 14) acDist['10-14']++;
    else if (ac <= 19) acDist['15-19']++;
    else if (ac <= 24) acDist['20-24']++;
    else if (ac <= 29) acDist['25-29']++;
    else if (ac <= 34) acDist['30-34']++;
    else if (ac <= 39) acDist['35-39']++;
    else acDist['40+']++;
  });
  const acKeys = Object.keys(acDist);
  const acCtx = document.getElementById('chartAC').getContext('2d');
  statsCharts.ac = new Chart(acCtx, {
    type: 'bar',
    data: { labels: acKeys, datasets: [{ label: '期數', data: acKeys.map(k => acDist[k]), backgroundColor: '#2563EB', borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: CHART_FONT_TICKS, maxRotation: 45, minRotation: 0 } },
        y: { beginAtZero: true, ticks: { font: CHART_FONT_TICKS }, title: { display: true, text: '期數', font: CHART_FONT_TITLE } },
      },
    },
  });

  // ═══════ 3. 遺漏值排行 (Omission / Gap) ═══════
  // 從最新一期往前推,計算每個號碼距上次出現的期數
  const sortedDraws = [...draws].sort((a, b) => (a.date < b.date ? 1 : -1));
  const omission = new Array(50).fill(0);
  const lastSeen = new Array(50).fill(-1);
  sortedDraws.forEach((d, idx) => {
    d.main_numbers.forEach(n => { lastSeen[n] = idx; });
  });
  // 距離「最近一次出現到最新一期」的期數
  sortedDraws.forEach((d, idx) => {
    d.main_numbers.forEach(n => {
      const gap = idx - lastSeen[n];
      if (gap >= 0 && gap < 50) omission[gap]++;
    });
  });
  // 重算: 只統計每個號碼當前遺漏
  const currentOmission = [];
  for (let n = 1; n <= 49; n++) {
    let gap = 0;
    for (let i = 0; i < sortedDraws.length; i++) {
      if (sortedDraws[i].main_numbers.includes(n)) { gap = i; break; }
      if (i === sortedDraws.length - 1) gap = sortedDraws.length;
    }
    currentOmission.push({ num: n, gap });
  }
  currentOmission.sort((a, b) => b.gap - a.gap);
  // 取前 25 個遺漏最多的號碼
  const topOmit = currentOmission.slice(0, 25).reverse();
  const omitCtx = document.getElementById('chartOmission').getContext('2d');
  statsCharts.omission = new Chart(omitCtx, {
    type: 'bar',
    data: {
      labels: topOmit.map(o => o.num),
      datasets: [{
        label: '遺漏期數',
        data: topOmit.map(o => o.gap),
        backgroundColor: topOmit.map(o => o.gap > 15 ? '#FF5757' : o.gap > 5 ? '#FFDE59' : '#16A34A'),
        borderColor: '#000', borderWidth: 1,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { font: CHART_FONT_TICKS }, title: { display: true, text: '期數', font: CHART_FONT_TITLE } },
        y: { ticks: { font: CHART_FONT_TICKS } },
      },
    },
  });

  // ═══════ 4. 除三餘數分佈 (路公碼) ═══════
  // 統計每期 3 個餘數各佔幾個 (mod 3)
  const mod3Dist = {};  // key 如 "2-2-2", value 為期數
  draws.forEach(d => {
    let c0 = 0, c1 = 0, c2 = 0;
    d.main_numbers.forEach(n => {
      const r = n % 3;
      if (r === 0) c0++;
      else if (r === 1) c1++;
      else c2++;
    });
    const key = `${c0}-${c1}-${c2}`;
    mod3Dist[key] = (mod3Dist[key] || 0) + 1;
  });
  // 排序: 按 c0, c1, c2 順序
  const mod3Keys = Object.keys(mod3Dist).sort((a, b) => {
    const [a0, a1, a2] = a.split('-').map(Number);
    const [b0, b1, b2] = b.split('-').map(Number);
    return (a0 - b0) || (a1 - b1) || (a2 - b2);
  });
  const mod3Ctx = document.getElementById('chartMod3').getContext('2d');
  statsCharts.mod3 = new Chart(mod3Ctx, {
    type: 'bar',
    data: { labels: mod3Keys, datasets: [{ label: '期數', data: mod3Keys.map(k => mod3Dist[k]), backgroundColor: mod3Keys.map(k => k.split('-').map(Number).join(',') === '2,2,2' ? '#FFDE59' : '#2563EB'), borderColor: '#000', borderWidth: 1 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { ...CHART_FONT_TICKS, size: isSmallScreen ? 8 : 11 }, maxRotation: 60, minRotation: 30 } },
        y: { beginAtZero: true, ticks: { font: CHART_FONT_TICKS }, title: { display: true, text: '期數', font: CHART_FONT_TITLE } },
      },
    },
  });

  // ═══════ 5. 冷熱轉折趨勢 (Top 5 熱號命中率) ═══════
  // 滾動窗口 30 期, 每期找當前 Top 5 熱號, 看下期是否中 (命中率)
  const hotColdData = [];
  for (let i = 30; i < sortedDraws.length; i++) {
    const window = sortedDraws.slice(i - 30, i);
    const freq = new Array(50).fill(0);
    window.forEach(d => d.main_numbers.forEach(n => freq[n]++));
    const top5 = [];
    for (let n = 1; n <= 49; n++) top5.push({ num: n, count: freq[n] });
    top5.sort((a, b) => b.count - a.count);
    const hot5 = top5.slice(0, 5).map(t => t.num);
    const next = sortedDraws[i];
    const hits = next.main_numbers.filter(n => hot5.includes(n)).length;
    hotColdData.push({ x: i, y: hits, rate: hits / 5 * 100 });
  }
  // 取最近 60 個資料點 (避免過密)
  const recentHC = hotColdData.slice(-60);
  const hcCtx = document.getElementById('chartHotCold').getContext('2d');
  statsCharts.hotcold = new Chart(hcCtx, {
    type: 'line',
    data: {
      labels: recentHC.map(d => '期' + d.x),
      datasets: [
        {
          label: '命中率 (%)',
          data: recentHC.map(d => d.rate.toFixed(1)),
          borderColor: '#000',
          backgroundColor: 'rgba(255,222,89,0.3)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: isSmallScreen ? 0 : 2,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font: { ...CHART_FONT_TICKS, size: 9 }, maxTicksLimit: isSmallScreen ? 8 : 20, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, max: 100, ticks: { font: CHART_FONT_TICKS, callback: v => v + '%' }, title: { display: true, text: 'Top5 命中率', font: CHART_FONT_TITLE } },
      },
    },
  });

  // ── 熱門連號排行榜 ────────────────────────────────────
  const pairList = Object.entries(pairCounts)
    .map(([pair, count]) => ({ pair, count, pct: (count / draws.length * 100).toFixed(2) }))
    .sort((a, b) => b.count - a.count);
  const totalPairs = pairList.reduce((sum, p) => sum + p.count, 0);
  const topPairs = pairList.slice(0, 20);
  const maxPairCount = topPairs.length > 0 ? topPairs[0].count : 1;

  const consBody = document.getElementById('consecutiveBody');
  consBody.innerHTML = topPairs.map((p, i) => {
    const [n1, n2] = p.pair.split('-').map(Number);
    const occupancy = (p.count / totalPairs * 100).toFixed(1);
    const barWidth = (p.count / maxPairCount * 100).toFixed(0);
    return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <span class="pair-cell">
            ${renderBall(n1, 'ball-xs')} <span style="color:var(--text-light);">—</span> ${renderBall(n2, 'ball-xs')}
          </span>
        </td>
        <td><strong>${p.count.toLocaleString()}</strong></td>
        <td>${p.pct}%</td>
        <td>
          <div class="consecutive-bar-bg">
            <div class="consecutive-bar-fill" style="width:${barWidth}%;"></div>
          </div>
          <span style="font-size:0.7rem;color:var(--text-light);">${occupancy}%</span>
        </td>
      </tr>`;
  }).join('');

    renderChartTooltips(); // 在圖表渲染完成後加入問號解說按鈕

  } catch (err) {
    console.error('renderStats error:', err);
    document.getElementById('statsLoading').style.display = 'none';
    const statsContent = document.getElementById('statsContent');
    if (statsContent) {
      statsContent.innerHTML = '<div class="error-msg">統計資料載入時發生錯誤，請重新整理頁面後再試。</div>';
      statsContent.style.display = 'block';
    }
  }
}

// ==================== Module 7: Number Filter ====================

function initFilter() {
  if (document.getElementById('excludeGrid').children.length > 0) return;

  // Exclude grid
  const grid = document.getElementById('excludeGrid');
  for (let i = 1; i <= 49; i++) {
    const btn = document.createElement('button');
    btn.className = 'exclude-btn';
    btn.setAttribute('data-num', i);
    btn.setAttribute('data-ball-group', getBallColorGroup(i));
    btn.textContent = i;
    btn.onclick = () => {
      btn.classList.toggle('excluded');
    };
    grid.appendChild(btn);
  }

  // Clear exclude
  document.getElementById('btnClearExclude').onclick = () => {
    document.querySelectorAll('#excludeGrid .exclude-btn').forEach(b => b.classList.remove('excluded'));
  };

  // Small range label
  document.getElementById('smallRange').oninput = function () {
    document.getElementById('smallRangeLabel').textContent = this.value;
  };

  // Frequency slider label
  document.getElementById('minFreqRange').oninput = function () {
    document.getElementById('minFreqLabel').textContent = this.value;
  };

  // 填充熱門連號下拉選單
  populateHotConsecutiveSelect();

  // Filter button（debounce 避免頻繁觸發）
  document.getElementById('btnFilter').onclick = debounce(doFilter, 500);
}

/** 從全部開獎記錄中提取 top 15 熱門連號對，填入下拉選單 */
function populateHotConsecutiveSelect() {
  const select = document.getElementById('hotConsecutiveSelect');
  if (!select) return;
  const draws = Store.draws;
  if (!draws || draws.length === 0) return;

  const pairCounts = {};
  draws.forEach(d => {
    const sorted = [...d.main_numbers].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] === 1) {
        const key = `${sorted[i - 1]}-${sorted[i]}`;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  });

  const topPairs = Object.entries(pairCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  for (const [pair, count] of topPairs) {
    const opt = document.createElement('option');
    opt.value = pair;
    opt.textContent = `${pair}（${count} 次）`;
    select.appendChild(opt);
  }
}

function doFilter() {
  // 顯示載入中狀態
  const container = document.getElementById('filterResults');
  container.innerHTML = '<div class="loading">正在篩選號碼組合…</div>';

  // 讓 loading UI 先渲染後才開始計算
  setTimeout(() => {
    doFilterCore();
  }, 50);
}

function doFilterCore() {
  const container = document.getElementById('filterResults');
  const excluded = [];
  document.querySelectorAll('#excludeGrid .exclude-btn.excluded').forEach(b => {
    excluded.push(parseInt(b.getAttribute('data-num')));
  });

  const minSmall = parseInt(document.getElementById('smallRange').value);
  const sumMin = parseInt(document.getElementById('sumMin').value) || 0;
  const sumMax = parseInt(document.getElementById('sumMax').value) || 279;

  // 讀取奇偶分布勾選框：保留被勾選的奇偶比例
  const allowedOEDist = new Set();
  for (let e = 0; e <= 6; e++) {
    const cb = document.getElementById('oe' + e);
    if (cb && cb.checked) allowedOEDist.add(e);
  }
  // 若全部取消勾選，等同於不限
  const enforceOE = allowedOEDist.size > 0 && allowedOEDist.size < 7;

  // 讀取熱門連號下拉（若選擇了指定連號對，則只保留包含該對的組合）
  const hotPair = document.getElementById('hotConsecutiveSelect')?.value || '';

  // 讀取頻率 slider（至少出現 N 次）
  const minFreq = parseInt(document.getElementById('minFreqRange').value);

  // 讀取相隔期數 checkbox：任意勾選即啟用過濾
  const recentThresholds = [];
  if (document.getElementById('gapRecent10')?.checked) recentThresholds.push(10);
  if (document.getElementById('gapRecent15')?.checked) recentThresholds.push(15);
  if (document.getElementById('gapRecent20')?.checked) recentThresholds.push(20);

  const coldThresholds = [];
  if (document.getElementById('gapCold30')?.checked) coldThresholds.push(30);
  if (document.getElementById('gapCold40')?.checked) coldThresholds.push(40);
  if (document.getElementById('gapCold50')?.checked) coldThresholds.push(50);

  const isGapActive = recentThresholds.length > 0 || coldThresholds.length > 0;

  // ── 計算每號碼的頻率與相隔期數 ──
  const draws = Store.draws;
  const freqMap = new Array(50).fill(0);
  const gapMap = new Array(50).fill(-1);
  draws.forEach((d, idx) => {
    d.main_numbers.forEach(n => {
      freqMap[n]++;
      if (gapMap[n] === -1) gapMap[n] = idx;
    });
  });

  // 讀取連號排除勾選框：只要被勾選的 N，就排除連號對數 ≥ N 的組合
  const excludedConsecutive = new Set();
  const consCheckboxes = [
    { id: 'excludeConsec4', val: 4 },
    { id: 'excludeConsec3', val: 3 },
    { id: 'excludeConsec2', val: 2 },
    { id: 'excludeConsec1', val: 1 },
  ];
  for (const cb of consCheckboxes) {
    const el = document.getElementById(cb.id);
    if (el && el.checked) excludedConsecutive.add(cb.val);
  }

  // ── 讀取 AC 值勾選 ──
  const allowedAC = new Set();
  const acCheckboxes = ['ac0','ac1','ac2','ac3','ac4'];
  const acRanges = [ [0,9], [10,19], [20,29], [30,39], [40,99] ];
  acCheckboxes.forEach((id, i) => {
    const cb = document.getElementById(id);
    if (cb && cb.checked) { allowedAC.add(i); }
  });
  const enforceAC = allowedAC.size > 0 && allowedAC.size < 5;

  // ── 讀取 mod3 類型勾選 ──
  const allowedMod3 = new Set();
  if (document.getElementById('modBal')?.checked) allowedMod3.add(0);   // 2-2-2
  if (document.getElementById('modSlight')?.checked) allowedMod3.add(1); // 1-2-3 variation
  if (document.getElementById('modMid')?.checked) allowedMod3.add(2);    // 1-1-4, 3-3-0
  if (document.getElementById('modExtreme')?.checked) allowedMod3.add(3); // 5-1-0, 0-0-6
  const enforceMod3 = allowedMod3.size > 0 && allowedMod3.size < 4;

  // Available numbers — 先用排除、頻率、相隔期數過濾
  const available = [];
  const isFreqActive = minFreq > 150;

  for (let i = 1; i <= 49; i++) {
    if (excluded.includes(i)) continue;

    // 頻率過濾：號碼的出現次數必須 ≥ minFreq
    if (isFreqActive && freqMap[i] < minFreq) continue;

    // 相隔期數過濾：號碼必須滿足任一被勾選的條件
    if (isGapActive) {
      const gap = gapMap[i];
      let pass = false;
      for (const t of recentThresholds) { if (gap <= t) { pass = true; break; } }
      if (!pass) {
        for (const t of coldThresholds) { if (gap >= t) { pass = true; break; } }
      }
      if (!pass) continue;
    }

    available.push(i);
  }

  if (available.length < 6) {
    document.getElementById('filterResults').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div><div>可用號碼少於 6 個，請減少排除號碼</div></div>';
    return;
  }

  const n = available.length;
  const totalCombos = combination(n, 6);
  const MAX_COMBOS = 3000;
  const combos = [];
  const seen = new Set();

  // Small pool: generate all combos; large pool: random sampling
  if (totalCombos <= MAX_COMBOS) {
    // Generate all combinations in order
    const indices = new Array(6).fill(0);
    for (let i = 0; i < 6; i++) indices[i] = i;

    while (true) {
      const combo = indices.map(i => available[i]);
      const sum = combo.reduce((a, b) => a + b, 0);
      const evenCount = combo.filter(x => x % 2 === 0).length;
      const smallCount = combo.filter(x => x <= 24).length;

      if ((!enforceOE || allowedOEDist.has(evenCount)) && smallCount >= minSmall &&
          sum >= sumMin && sum <= sumMax &&
          passesConsecutiveFilter(combo, excludedConsecutive) &&
          passesHotPairFilter(combo, hotPair)) {
        combos.push([...combo]);
        if (combos.length >= MAX_COMBOS) break;
      }

      // Generate next combination
      let i;
      for (i = 5; i >= 0; i--) {
        if (indices[i] !== i + n - 6) break;
      }
      if (i < 0) break;
      indices[i]++;
      for (let j = i + 1; j < 6; j++) {
        indices[j] = indices[j - 1] + 1;
      }
    }
  } else {
    // Fast random pick w/ pre-allocated array, inlined stats
    const nPool = available.length;
    let attempts = MAX_COMBOS * 3;
    while (combos.length < MAX_COMBOS && attempts-- > 0) {
      const pick = new Array(6);
      const t = new Array(6);
      for (let i = 0; i < 6; i++) {
        let r;
        do { r = Math.floor(Math.random() * nPool); } while (t.includes(r));
        t[i] = r;
        pick[i] = available[r];
      }
      pick.sort((a, b) => a - b);
      const key = pick.join(',');
      if (seen.has(key)) continue;
      seen.add(key);

      let sum = 0, evenCount = 0, smallCount = 0;
      for (let i = 0; i < 6; i++) {
        const v = pick[i];
        sum += v;
        if (v % 2 === 0) evenCount++;
        if (v <= 24) smallCount++;
      }

      if ((!enforceOE || allowedOEDist.has(evenCount)) && smallCount >= minSmall &&
          sum >= sumMin && sum <= sumMax &&
          passesConsecutiveFilter(pick, excludedConsecutive) &&
          passesHotPairFilter(pick, hotPair) &&
          (!enforceAC || passesACFilter(pick, acRanges, allowedAC)) &&
          (!enforceMod3 || passesMod3Filter(pick, allowedMod3))) {
        combos.push(pick);
      }
    }
  }

  renderFilterResults(combos, totalCombos);
}

function passesConsecutiveFilter(combo, excludedSet) {
  if (excludedSet.size === 0) return true;
  // combo 傳入時已排序，不重複排序
  let pairs = 0;
  for (let i = 1; i < combo.length; i++) {
    if (combo[i] - combo[i - 1] === 1) pairs++;
  }
  for (const threshold of excludedSet) {
    if (pairs >= threshold) return false;
  }
  return true;
}

/** 若指定了熱門連號對（如 "11-12"），只保留包含該對的組合 */
function passesHotPairFilter(combo, hotPair) {
  if (!hotPair) return true;
  const [a, b] = hotPair.split('-').map(Number);
  return combo.includes(a) && combo.includes(b);
}

/** 檢查組合的 AC 值是否在允許區間內 */
function passesACFilter(combo, acRanges, allowedAC) {
  let D = 0;
  for (let i = 1; i < combo.length; i++) D += Math.abs(combo[i] - combo[i - 1]);
  const ac = D - 5;
  for (const ri of allowedAC) {
    if (ac >= acRanges[ri][0] && ac <= acRanges[ri][1]) return true;
  }
  return false;
}

/** 檢查組合的 mod3 類型是否在允許集內
 *  0=平衡型(2-2-2), 1=略偏型(1/2/3 交錯), 2=中度偏(1-1-4/3-3-0), 3=極端型(5-1-0/0-0-6) */
function passesMod3Filter(combo, allowedMod3) {
  let c0 = 0, c1 = 0, c2 = 0;
  combo.forEach(n => {
    const r = n % 3;
    if (r === 0) c0++; else if (r === 1) c1++; else c2++;
  });
  const type = classifyMod3(c0, c1, c2);
  return allowedMod3.has(type);
}
function classifyMod3(c0, c1, c2) {
  if (c0 === 2 && c1 === 2 && c2 === 2) return 0;
  const max = Math.max(c0, c1, c2);
  const min = Math.min(c0, c1, c2);
  if (min === 0 && max >= 5) return 3; // 極端: 5-1-0, 0-0-6 etc
  if (min === 0) return 2;             // 中度: 0-3-3, 4-2-0 etc
  if (min <= 1 && max >= 4) return 2;  // 中度: 1-1-4, 4-1-1 etc
  return 1;                             // 略偏: 1-2-3, 2-1-3 etc
}

// 分批渲染用全域狀態
const filterRenderState = { allCombos: null, totalCombos: 0, shown: 0 };
const FILTER_BATCH_SIZE = 100;

function renderFilterResults(combos, totalCombos) {
  const container = document.getElementById('filterResults');

  if (combos.length === 0) {
    filterRenderState.allCombos = null;
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div>沒有符合條件的號碼組合</div>
        <p style="color:var(--text-light);">請放寬篩選條件後再試</p>
      </div>`;
    return;
  }

  // 儲存全域狀態以支援分批載入
  filterRenderState.allCombos = combos;
  filterRenderState.totalCombos = totalCombos;
  filterRenderState.shown = 0;

  // 首次只渲染第一段摘要 + 前三行
  appendFilterBatch(container, null);
}

function appendFilterBatch(containerEl, nextStart) {
  const { allCombos, totalCombos, shown } = filterRenderState;
  if (!allCombos) return;

  const start = nextStart != null ? nextStart : 0;
  const batch = allCombos.slice(start, start + FILTER_BATCH_SIZE);
  const newShown = start + batch.length;
  const hasMore = newShown < allCombos.length;

  const batchHtml = batch.map(c => `
    <div class="combo-item">
      ${renderBalls(c, null, 'ball-xs')}
      <span class="combo-count">總和: ${c.reduce((a, b) => a + b, 0)}</span>
    </div>`).join('');

  if (start === 0) {
    // 首次渲染：建立完整結構
    containerEl.innerHTML = `
      <div class="combo-summary">
        找到
        <strong>${allCombos.length.toLocaleString()}</strong> 個符合條件的組合
        ${totalCombos <= FILTER_BATCH_SIZE * 50
          ? `（共 ${totalCombos.toLocaleString()} 個可能組合）`
          : `（從 ${totalCombos.toLocaleString()} 個可能組合中隨機抽樣 ${allCombos.length.toLocaleString()} 組）`}
        ${allCombos.length > FILTER_BATCH_SIZE
          ? `｜已顯示 <span id="filterShownCount">${newShown.toLocaleString()}</span> 組`
          : ''}
      </div>
      <div class="combo-list" id="filterComboList">
        ${batchHtml}
      </div>
      ${hasMore ? `<div class="combo-load-more-wrap" id="filterLoadMoreWrap">
        <button class="btn btn-secondary btn-sm" id="btnLoadMore">載入更多（餘 ${(allCombos.length - newShown).toLocaleString()} 組）</button>
      </div>` : ''}
    `;

    // 綁定載入更多按鈕
    const loadBtn = document.getElementById('btnLoadMore');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => {
        appendFilterBatch(containerEl, newShown);
      });
    }
  } else {
    // 追加 batch
    const list = document.getElementById('filterComboList');
    if (list) list.insertAdjacentHTML('beforeend', batchHtml);

    const shownSpan = document.getElementById('filterShownCount');
    if (shownSpan) shownSpan.textContent = (newShown).toLocaleString();

    const loadWrap = document.getElementById('filterLoadMoreWrap');
    if (loadWrap) {
      if (hasMore) {
        const btn = document.getElementById('btnLoadMore');
        if (btn) btn.textContent = `載入更多（餘 ${(allCombos.length - newShown).toLocaleString()} 組）`;
      } else {
        loadWrap.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:8px;">已顯示全部組別</p>';
      }
    }
  }

  filterRenderState.shown = newShown;
}

// ==================== Utility: Debounce ====================

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ==================== Init ====================

document.addEventListener('DOMContentLoaded', async () => {
  // 動態設置 --nav-height 為實際 header 高度，確保 nav 黏在 header 正下方
  const syncNavOffset = () => {
    const header = document.querySelector('.header');
    if (!header) return;
    const h = header.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--nav-height', h + 'px');
  };
  syncNavOffset();
  window.addEventListener('resize', syncNavOffset);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(syncNavOffset);
    const header = document.querySelector('.header');
    if (header) ro.observe(header);
  }

  initNavigation();

  // Event bindings — with null checks and backup via ensureCheckerEvents
  const btnCheck = document.getElementById('btnCheck');
  const btnClear = document.getElementById('btnClearCheck');
  if (btnCheck) btnCheck.addEventListener('click', doCheck);
  if (btnClear) btnClear.addEventListener('click', clearChecker);

  // Fetch window globals for onclick handlers
  window.goToPage = goToPage;

  // Load data
  const success = await loadData();
  if (success) {
    renderLatest();
  } else {
    const el = document.getElementById('latestLoading');
    if (el) el.innerHTML = '<div class="error-msg">資料載入失敗，請檢查網路連線後重新整理頁面。</div>';
  }
});
