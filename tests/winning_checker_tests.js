// =============================================================================
// winning_checker_tests.js
// -----------------------------------------------------------------------------
// 中獎核對系統 · 複式 / 膽拖 全面測試案例集 + 執行器
//
// 執行： node tests/winning_checker_tests.js
// 產出：
//   tests/winning_checker_report.json   —— 機器可讀結果
//   tests/winning_checker_testcases.md   —— 人類可讀測試案例文件（交付物）
//
// 驗證方法：
//   每個案例同時跑「系統公式路徑 runCheck」與「獨立暴力列舉 bruteForce」，
//   斷言：(1) 公式路徑總注數 == 預期；(2) 公式路徑獎級集合 == 預期；
//         (3) 公式路徑每獎級注數 & 總獎金 == 暴力列舉（真值）。
//   異常 / 邊界案例則斷言系統回傳錯誤或記錄其「未做防護」的實際行為。
// =============================================================================
const fs = require('fs');
const path = require('path');
const C = require('./checker_core');

const { runCheck, bruteForce, STANDARD_PRIZES } = C;

// ---- 開獎資料建構 ----------------------------------------------------------
// DRAW_A：正選 1-6，特別 7（最常用基準）
const DRAW_A = { main_numbers: [1, 2, 3, 4, 5, 6], special_number: 7, prizes: STANDARD_PRIZES };
// DRAW_B：正選含較大號，特別置中
const DRAW_B = { main_numbers: [10, 20, 30, 40, 49, 1], special_number: 25, prizes: STANDARD_PRIZES };
// DRAW_C：缺少二/三獎金額的開獎資料（用來測試「獎金缺漏」行為）
const DRAW_C = {
  main_numbers: [1, 2, 3, 4, 5, 6], special_number: 7,
  prizes: {
    '頭獎': { amount: 16000000 },
    '四獎': { amount: 9600 }, '五獎': { amount: 640 },
    '六獎': { amount: 320 }, '七獎': { amount: 40 },
    // 二獎 / 三獎 故意留空
  },
};

const TIER_ORDER = ['頭獎', '二獎', '三獎', '四獎', '五獎', '六獎', '七獎'];

// ---- 測試案例集 ------------------------------------------------------------
// expect.tiers：該案例「應有 >0 注」的獎級集合（預期）。
// bruteCompare=false：系統與暴力列舉刻意不同（用來突顯系統行為），僅比對預期。
const CASES = [
  // ===================== 複式投注 (multiple) =====================
  {
    id: 'M-01', cat: '複式-完全命中(含特別號碼)',
    desc: '7 個號碼含全部 6 個正選 + 特別號碼：驗證 頭獎/二獎 拆分',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 6, 7],
    expect: { tiers: ['頭獎', '二獎'], totalUnits: 7 },
  },
  {
    id: 'M-02', cat: '複式-完全命中(不含特別)',
    desc: '8 個號碼含全部 6 正選但不含特別：頭獎+三獎+五獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 6, 8, 9],
    expect: { tiers: ['頭獎', '三獎', '五獎'], totalUnits: 28 },
  },
  {
    id: 'M-03', cat: '複式-部分命中(5正選+特別)',
    desc: '7 碼含 5 正選 + 特別：二獎+三獎+四獎 交叉',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 8, 7],
    expect: { tiers: ['二獎', '三獎', '四獎'], totalUnits: 7 },
  },
  {
    id: 'M-04', cat: '複式-部分命中(4正選)',
    desc: '9 碼含 4 正選、無特別：五獎+七獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 10, 11, 12, 13, 14],
    expect: { tiers: ['五獎', '七獎'], totalUnits: 84 },
  },
  {
    id: 'M-05', cat: '複式-部分命中(3正選+特別)',
    desc: '9 碼含 3 正選 + 特別：六獎+七獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 10, 11, 12, 13, 14, 7],
    expect: { tiers: ['六獎', '七獎'], totalUnits: 84 },
  },
  {
    id: 'M-06', cat: '複式-完全未命中',
    desc: '10 碼全落在非開獎號：未中獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    expect: { tiers: [], totalUnits: 210 },
  },
  {
    id: 'M-07', cat: '複式-低於門檻(中2個)',
    desc: '10 碼僅中 2 正選、無特別：未達派彩門檻',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 11, 12, 13, 14, 15, 16, 17, 18],
    expect: { tiers: [], totalUnits: 210 },
  },
  {
    id: 'M-08', cat: '複式-全獎級覆蓋',
    desc: '10 碼含 6 正選 + 特別 + 3 雜碼：單案例覆蓋頭~七獎全部 7 級',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    expect: { tiers: ['頭獎', '二獎', '三獎', '四獎', '五獎', '六獎', '七獎'], totalUnits: 210 },
  },
  {
    id: 'M-09', cat: '複式-8碼含特別',
    desc: '8 碼含 6 正選 + 特別 + 1 雜：頭/二/三/四獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 6, 7, 20],
    expect: { tiers: ['頭獎', '二獎', '三獎', '四獎'], totalUnits: 28 },
  },
  {
    id: 'M-10', cat: '複式-9碼含特別(5正選)',
    desc: '9 碼含 5 正選 + 特別 + 3 雜：二~七獎(缺頭獎)',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 8, 9, 7, 10],
    expect: { tiers: ['二獎', '三獎', '四獎', '五獎', '六獎', '七獎'], totalUnits: 84 },
  },
  {
    id: 'M-11', cat: '複式-大池低命中',
    desc: '11 碼僅中 3 正選、無特別：僅七獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 11, 12, 13, 14, 15, 16, 17, 18],
    expect: { tiers: ['七獎'], totalUnits: 462 },
  },
  {
    id: 'M-12', cat: '複式-12碼完全命中',
    desc: '12 碼含 6 正選 + 6 雜、無特別：頭/三/五/七獎',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13],
    expect: { tiers: ['頭獎', '三獎', '五獎', '七獎'], totalUnits: 924 },
  },

  // ===================== 膽拖投注 (banker) =====================
  {
    id: 'B-01', cat: '膽拖-單膽(全中)+腳含全正選+特別',
    desc: '1 膽[1]全中；5 腳含餘 5 正選 + 特別：頭獎+二獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1], legNumbers: [2, 3, 4, 5, 6, 7],
    expect: { tiers: ['頭獎', '二獎'], totalUnits: 6 },
  },
  {
    id: 'B-02', cat: '膽拖-單膽(全中)+腳部分中(無特別)',
    desc: '1 膽[1]；5 腳含 3 正選 + 2 雜、無特別：五獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1], legNumbers: [2, 3, 4, 10, 11],
    expect: { tiers: ['五獎'], totalUnits: 1 },
  },
  {
    id: 'B-03', cat: '膽拖-單膽(全中)+腳含特別',
    desc: '1 膽[1]；5 腳含 3 正選 + 特別 + 1 雜：四獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1], legNumbers: [2, 3, 4, 7, 10],
    expect: { tiers: ['四獎'], totalUnits: 1 },
  },
  {
    id: 'B-04', cat: '膽拖-單膽(全中)+腳含特別+多雜',
    desc: '1 膽[1]；6 腳含 3 正選 + 特別 + 2 雜：四/五/六獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1], legNumbers: [2, 3, 4, 7, 20, 21],
    expect: { tiers: ['四獎', '五獎', '六獎'], totalUnits: 6 },
  },
  {
    id: 'B-05', cat: '膽拖-雙膽(全中)+腳含全正選+特別',
    desc: '2 膽[1,2]全中；5 腳含餘 4 正選 + 特別：頭獎+二獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2], legNumbers: [3, 4, 5, 6, 7],
    expect: { tiers: ['頭獎', '二獎'], totalUnits: 5 },
  },
  {
    id: 'B-06', cat: '膽拖-雙膽(1中1不中)+腳全正選',
    desc: '2 膽[1,9]；6 腳含 5 正選、無特別：三獎+五獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 9], legNumbers: [2, 3, 4, 5, 6, 10],
    expect: { tiers: ['三獎', '五獎'], totalUnits: 15 },
  },
  {
    id: 'B-07', cat: '膽拖-雙膽(全不中)+腳全正選',
    desc: '2 膽[8,9]全不中；6 腳含 6 正選：每注皆五獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [8, 9], legNumbers: [1, 2, 3, 4, 5, 6],
    expect: { tiers: ['五獎'], totalUnits: 15 },
  },
  {
    id: 'B-08', cat: '膽拖-三膽(全中)+腳含全正選+特別',
    desc: '3 膽[1,2,3]全中；4 腳含餘 3 正選 + 特別：頭獎+二獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3], legNumbers: [4, 5, 6, 7],
    expect: { tiers: ['頭獎', '二獎'], totalUnits: 4 },
  },
  {
    id: 'B-09', cat: '膽拖-三膽(全不中)+腳全正選',
    desc: '3 膽[8,9,10]全不中；5 腳含 5 正選：每注皆七獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [8, 9, 10], legNumbers: [1, 2, 3, 4, 5],
    expect: { tiers: ['七獎'], totalUnits: 10 },
  },
  {
    id: 'B-10', cat: '膽拖-四膽(全中)+腳含全正選+特別',
    desc: '4 膽[1,2,3,4]全中；3 腳含餘 2 正選 + 特別：頭獎+二獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3, 4], legNumbers: [5, 6, 7],
    expect: { tiers: ['頭獎', '二獎'], totalUnits: 3 },
  },
  {
    id: 'B-11', cat: '膽拖-五膽(全中)+腳含全正選+特別',
    desc: '5 膽[1,2,3,4,5]全中；2 腳含餘 1 正選 + 特別：頭獎+二獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3, 4, 5], legNumbers: [6, 7],
    expect: { tiers: ['頭獎', '二獎'], totalUnits: 2 },
  },
  {
    id: 'B-12', cat: '膽拖-五膽(全中)+腳無特別',
    desc: '5 膽[1,2,3,4,5]全中；1 腳[6]無特別：頭獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3, 4, 5], legNumbers: [6],
    expect: { tiers: ['頭獎'], totalUnits: 1 },
  },
  {
    id: 'B-13', cat: '膽拖-雙膽(全中)+腳部分中(無特別)',
    desc: '2 膽[1,2]；5 腳含 3 正選 + 2 雜、無特別：三獎+五獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2], legNumbers: [3, 4, 5, 8, 9],
    expect: { tiers: ['三獎', '五獎'], totalUnits: 5 },
  },
  {
    id: 'B-14', cat: '膽拖-三膽(全中)+腳僅特別',
    desc: '3 膽[1,2,3]全中；3 腳[特別,2雜]：六獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3], legNumbers: [7, 20, 21],
    expect: { tiers: ['六獎'], totalUnits: 1 },
  },
  {
    id: 'B-15', cat: '膽拖-三膽(1中2不中)+腳全正選',
    desc: '3 膽[1,8,9]；6 腳含 5 正選 + 1 雜：五獎+七獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 8, 9], legNumbers: [2, 3, 4, 5, 6, 20],
    expect: { tiers: ['五獎', '七獎'], totalUnits: 20 },
  },
  {
    id: 'B-16', cat: '膽拖-五膽(4中1不中)+腳含特別',
    desc: '5 膽[1,2,3,4,9]；3 腳[5,6,特別]：三獎+四獎',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3, 4, 9], legNumbers: [5, 6, 7],
    expect: { tiers: ['三獎', '四獎'], totalUnits: 3 },
  },

  // ===================== 邊界情況 (edge) =====================
  {
    id: 'E-01', cat: '邊界-空注單',
    desc: '複式傳入空號碼陣列：系統應回傳錯誤（最少 7 個）',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [],
    expect: { error: true },
  },
  {
    id: 'E-02', cat: '邊界-重複號碼',
    desc: '複式號碼池含重複 [1,1,...]：系統「未做去重」，重複號被當作不同號，導致中獎注數異常偏高',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 1, 2, 3, 4, 5, 6],
    expect: { tiers: ['頭獎'], totalUnits: 7 },
    note: '正確行為應先去重為 [1,2,3,4,5,6] → 頭獎×1；系統實際給頭獎×7，揭示缺少去重防護。',
  },
  {
    id: 'E-03', cat: '邊界-膽拖號碼重疊',
    desc: '膽[1] 與腳[1,2,3,4,5] 重疊：系統未偵測重疊，組合出現重複號',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1], legNumbers: [1, 2, 3, 4, 5],
    expect: { tiers: ['頭獎'], totalUnits: 1 },
    note: '系統未警告膽腳重疊；組合 [1,1,2,3,4,5] 含重複 1，仍判頭獎。',
  },
  {
    id: 'E-04', cat: '邊界-超出可選範圍',
    desc: '複式含 50（>49）：系統未做範圍校驗，靜默當作普通非中獎號',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 4, 5, 6, 50],
    expect: { tiers: ['頭獎', '三獎'], totalUnits: 7 },
    note: '50 不在 1–49，系統接受並視為未中獎號；正確應先拒絕越界號碼。',
  },

  // ===================== 異常輸入 (abnormal) =====================
  {
    id: 'A-01', cat: '異常-無效格式(字串混入)',
    desc: '複式號碼池混入字串 "x"：系統未做型別校驗，字串被當作未中獎號',
    betType: 'multiple', draw: DRAW_A,
    mainNumbers: [1, 2, 3, 'x', 5, 6, 7],
    expect: { tiers: ['二獎', '三獎', '四獎'], totalUnits: 7 },
    note: '字串 "x" 參與組合但永不中獎；系統未拋錯，揭示缺少型別/格式驗證。',
  },
  {
    id: 'A-02', cat: '異常-缺失必填欄位',
    desc: '膽拖模式無膽碼：系統應回傳錯誤（至少 1 個膽）',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [], legNumbers: [1, 2, 3, 4, 5],
    expect: { error: true },
  },
  {
    id: 'A-03', cat: '異常-膽碼超過限制',
    desc: '膽碼 6 個（>UI 上限 5）：UI 會攔截，但資料旁路時系統容許，need=0 視為單注全膽',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3, 4, 5, 6], legNumbers: [7, 8],
    expect: { tiers: ['頭獎'], totalUnits: 1 },
    note: 'checkerState 有 CHECKER_MAX_BANKERS=5 防護，但 doCheck 僅依 need 計算，未拒絕 6 膽；本例巧合中頭獎。',
  },
  {
    id: 'A-04', cat: '異常-腳碼數量不足',
    desc: '膽[1,2,3] 但腳為空：系統應回傳錯誤（需至少 3 腳）',
    betType: 'banker', draw: DRAW_A,
    bankerNumbers: [1, 2, 3], legNumbers: [],
    expect: { error: true },
  },
  {
    id: 'A-05', cat: '異常-獎金資料缺漏',
    desc: '開獎資料缺二/三獎金額，但號碼中二/三獎：系統因 amount 為 undefined 而「靜默捨棄」該獎級',
    betType: 'multiple', draw: DRAW_C,
    mainNumbers: [1, 2, 3, 4, 5, 6, 7],
    expect: { tiers: ['頭獎'], totalUnits: 7 },
    bruteCompare: false,
    note: '真值應含 二獎×6、三獎×1；因 checkerPrizeAmount 對二/三獎無保底，amount=undefined 被 `if(!amount) continue` 捨棄，僅計頭獎。建議二/三獎亦設保底或報錯。',
  },
];

// ---- 執行與斷言 ------------------------------------------------------------
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a), sb = new Set(b);
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}
function deepEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

const results = [];
let pass = 0, fail = 0;

for (const c of CASES) {
  const input = {
    betType: c.betType,
    mainNumbers: c.mainNumbers,
    bankerNumbers: c.bankerNumbers,
    legNumbers: c.legNumbers,
    draw: c.draw,
  };
  const formula = runCheck(input);
  const rec = {
    id: c.id, cat: c.cat, desc: c.desc,
    betType: c.betType,
    numbers: c.betType === 'banker'
      ? `膽[${c.bankerNumbers}] + 腳[${c.legNumbers}]`
      : `池[${c.mainNumbers}]`,
    draw: `正選[${c.draw.main_numbers}] 特別${c.draw.special_number}`,
    expectedTiers: c.expect.tiers || null,
    expectedTotalUnits: c.expect.totalUnits,
    error: c.expect.error || false,
    note: c.note || '',
    formulaTiers: null, formulaCounts: null, formulaTotalUnits: null,
    formulaTotalAmount: null, bruteTiers: null, bruteTotalAmount: null,
    checks: [], ok: true,
  };

  // 錯誤案例
  if (c.expect.error) {
    if (!formula.error) {
      rec.ok = false;
      rec.checks.push('FAIL: 預期回傳錯誤，但系統計算出結果 ' + JSON.stringify(formula.tiers));
    } else {
      rec.checks.push('PASS: 系統正確回傳錯誤 — ' + formula.error);
    }
    if (rec.ok) pass++; else fail++;
    results.push(rec);
    continue;
  }

  // 正常案例
  rec.formulaTotalUnits = formula.totalUnits;
  rec.formulaTiers = Object.keys(formula.tiers).sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
  rec.formulaCounts = formula.tiers;
  rec.formulaTotalAmount = formula.totalAmount;

  // 1) 總注數
  if (formula.totalUnits !== c.expect.totalUnits) {
    rec.ok = false;
    rec.checks.push(`FAIL: 總注數 ${formula.totalUnits} != 預期 ${c.expect.totalUnits}`);
  } else {
    rec.checks.push(`PASS: 總注數 = ${formula.totalUnits}`);
  }
  // 2) 獎級集合
  if (!sameSet(rec.formulaTiers, c.expect.tiers)) {
    rec.ok = false;
    rec.checks.push(`FAIL: 獎級集合 [${rec.formulaTiers}] != 預期 [${c.expect.tiers}]`);
  } else {
    rec.checks.push(`PASS: 獎級集合 = [${rec.formulaTiers}]`);
  }
  // 3) 公式 == 暴力列舉（真值）
  if (c.bruteCompare !== false) {
    const brute = bruteForce(input);
    rec.bruteTiers = Object.keys(brute.tiers).sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
    rec.bruteTotalAmount = brute.totalAmount;
    if (!deepEqual(formula.tiers, brute.tiers)) {
      rec.ok = false;
      rec.checks.push(`FAIL: 公式獎級注數 ${JSON.stringify(formula.tiers)} != 暴力列舉 ${JSON.stringify(brute.tiers)}`);
    } else {
      rec.checks.push('PASS: 公式獎級注數 == 暴力列舉（真值一致）');
    }
    if (formula.totalAmount !== brute.totalAmount) {
      rec.ok = false;
      rec.checks.push(`FAIL: 總獎金 ${formula.totalAmount} != 暴力列舉 ${brute.totalAmount}`);
    } else {
      rec.checks.push('PASS: 總獎金 == 暴力列舉');
    }
  } else {
    rec.checks.push('SKIP: 刻意不比對暴力列舉（系統行為觀察案例）');
  }

  if (rec.ok) pass++; else fail++;
  results.push(rec);
}

// ---- 獎級覆蓋矩陣 ----------------------------------------------------------
const coverage = {};
for (const t of TIER_ORDER) coverage[t] = [];
coverage['未中獎'] = [];
for (const r of results) {
  if (r.expectedTiers === null) continue; // 錯誤案例
  if (r.expectedTiers.length === 0) { coverage['未中獎'].push(r.id); continue; }
  for (const t of r.expectedTiers) coverage[t].push(r.id);
}

// ---- 報表輸出 --------------------------------------------------------------
const jsonReport = {
  generatedAt: new Date().toISOString(),
  summary: { total: CASES.length, pass, fail },
  coverage,
  results,
};
const outJson = path.join(__dirname, 'winning_checker_report.json');
fs.writeFileSync(outJson, JSON.stringify(jsonReport, null, 2), 'utf8');

// Markdown 交付文件
const lines = [];
lines.push('# 中獎核對系統 · 複式 / 膽拖 全面測試案例');
lines.push('');
lines.push(`> 生成時間：${new Date().toLocaleString('zh-HK')} ｜ 測試案例數：${CASES.length} ｜ 通過：${pass} ／ 失敗：${fail}`);
lines.push('');
lines.push('## 一、獎級規則（對照基準）');
lines.push('');
lines.push('| 獎級 | 中獎條件 | 固定/計算獎金 |');
lines.push('| --- | --- | --- |');
lines.push('| 頭獎 | 中 6 個正選號碼 | 獎金基金 45%（保底 HK$8,000,000）|');
lines.push('| 二獎 | 中 5 正選 + 特別號碼 | 獎金基金 15% |');
lines.push('| 三獎 | 中 5 正選號碼 | 獎金基金 40% |');
lines.push('| 四獎 | 中 4 正選 + 特別號碼 | 固定 HK$9,600 |');
lines.push('| 五獎 | 中 4 正選號碼 | 固定 HK$640 |');
lines.push('| 六獎 | 中 3 正選 + 特別號碼 | 固定 HK$320 |');
lines.push('| 七獎 | 中 3 正選號碼 | 固定 HK$40 |');
lines.push('');
lines.push('## 二、測試案例明細');
lines.push('');
lines.push('基準開獎（DRAW_A）：正選 `[1,2,3,4,5,6]`，特別 `7`。');
lines.push('');
lines.push('| 編號 | 類別 | 投注類型 | 號碼組合 | 開獎號碼 | 預期中獎結果（獎級×注數） | 總中獎注數 | 備註 |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of results) {
  let resultCell;
  if (r.error) {
    resultCell = '系統回傳錯誤';
  } else {
    const tiers = Object.keys(r.formulaCounts).sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
    resultCell = tiers.map(t => `${t}×${r.formulaCounts[t]}`).join('、') || '未中獎';
  }
  const totalWin = r.error ? '—' : (Object.values(r.formulaCounts).reduce((a, b) => a + b, 0));
  lines.push(`| ${r.id} | ${r.cat} | ${r.betType} | ${r.numbers} | ${r.draw} | ${resultCell} | ${r.error ? '—' : totalWin} | ${r.note ? r.note : ''} |`);
}
lines.push('');
lines.push('## 三、獎級覆蓋矩陣');
lines.push('');
lines.push('| 獎級 | 覆蓋案例 |');
lines.push('| --- | --- |');
for (const t of [...TIER_ORDER, '未中獎']) {
  lines.push(`| ${t} | ${(coverage[t] || []).join(', ') || '（無）'} |`);
}
lines.push('');
lines.push('## 四、驗證方法與結論');
lines.push('');
lines.push('- 每個「正常」案例同時以系統優化公式路徑（`runCheck`，與 `js/app.js` 的 `doCheck` / `renderMultiCheckResult` 邏輯一致）與獨立暴力列舉（`bruteForce`，僅依 `resolveCheckerPrizeTier` 逐注分類）計算，二者每獎級注數與總獎金必須完全一致，以此確證超幾何分佈公式與「特別號碼拆分」邏輯正確。');
lines.push('- 錯誤 / 異常案例斷言系統按設計回傳錯誤或記錄其實際（未防護）行為。');
lines.push(`- 本次執行結果：**${pass}/${CASES.length} 通過，${fail} 失敗**。`);
lines.push('');
lines.push('## 五、發現的系統行為 / 建議');
lines.push('');
lines.push('1. **缺少號碼去重**（E-02）：重複號碼被視為不同號，會讓中獎注數異常偏高，建議投注前對號碼池 `Set` 去重。');
lines.push('2. **膽腳重疊未偵測**（E-03）：膽與腳含相同號會產生重複號組合，建議組合前檢查交集為空。');
lines.push('3. **號碼範圍未校驗**（E-04 / A-01）：接受 >49 或非數值，建議投注前驗證 `1≤n≤49` 且為整數。');
lines.push('4. **二/三獎金缺漏會靜默捨棄**（A-05）：`checkerPrizeAmount` 對二/三獎無保底，資料缺漏時中獎注數被「吃掉」而不報錯，建議補保底值或顯式警示。');
lines.push('5. **膽碼上限僅在 UI 攔截**（A-03）：`doCheck` 未拒絕 >5 膽的資料旁路輸入，建議在 `doCheck` 內也加 `bankerNumbers.length <= CHECKER_MAX_BANKERS` 防護。');
lines.push('');

const outMd = path.join(__dirname, 'winning_checker_testcases.md');
fs.writeFileSync(outMd, lines.join('\n'), 'utf8');

// ---- 控制台摘要 ------------------------------------------------------------
console.log(`\n==== 中獎核對測試 ====  共 ${CASES.length} 例，通過 ${pass}，失敗 ${fail}\n`);
for (const r of results) {
  const tag = r.ok ? '✅' : '❌';
  const detail = r.error ? 'ERROR' :
    Object.keys(r.formulaCounts).sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b))
      .map(t => `${t}×${r.formulaCounts[t]}`).join(' ') || '未中獎';
  console.log(`${tag} ${r.id}  [${r.betType}]  ${r.numbers}  =>  ${detail}`);
  if (!r.ok) r.checks.forEach(ch => console.log('     ' + ch));
}
console.log(`\n報告已寫入：\n  ${outJson}\n  ${outMd}\n`);

process.exit(fail === 0 ? 0 : 1);
