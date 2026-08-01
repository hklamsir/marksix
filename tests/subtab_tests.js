// =============================================================================
// subtab_tests.js
// -----------------------------------------------------------------------------
// 「最新結果」子分頁自動切換邏輯 · 單元測試
//
// 執行： node tests/subtab_tests.js
// 驗證對象： js/subtab_core.js 的 shouldAutoShowNext(drawDateStr, now)
//   - 距離最新開獎結果時間 ≤ 18h → 顯示「最新開獎結果」(false)
//   - 距離最新開獎結果時間 >  18h → 顯示「下期攪珠」   (true)
//   開獎時間以 HKT(+08:00) 21:30 錨定。
// =============================================================================
const { shouldAutoShowNext, SUBTAB_AUTO_SWITCH_HOURS } = require('../js/subtab_core.js');

const dt = (s) => new Date(s);

// 以 2026-07-30 開獎為基準（21:30 HKT）
const D = '2026-07-30';

const CASES = [
  { id: 'S-01', desc: '開獎當下 (21:30) → 顯示最新結果',            date: D,    now: dt('2026-07-30T21:30:00+08:00'), expect: false },
  { id: 'S-02', desc: '18h 內 (次日 15:29) → 顯示最新結果',          date: D,    now: dt('2026-07-31T15:29:00+08:00'), expect: false },
  { id: 'S-03', desc: '恰滿 18h (次日 15:30) → 仍顯示最新結果',      date: D,    now: dt('2026-07-31T15:30:00+08:00'), expect: false },
  { id: 'S-04', desc: '超過 18h (次日 15:31) → 顯示下期攪珠',        date: D,    now: dt('2026-07-31T15:31:00+08:00'), expect: true  },
  { id: 'S-05', desc: '隔日同時刻 (48h) → 顯示下期攪珠',             date: D,    now: dt('2026-08-01T21:30:00+08:00'), expect: true  },
  { id: 'S-06', desc: '缺少日期 → 容錯顯示最新結果',                date: '',   now: dt('2026-07-31T00:00:00+08:00'), expect: false },
  { id: 'S-07', desc: '無效日期 → 容錯顯示最新結果',                date: 'xx', now: dt('2026-07-31T00:00:00+08:00'), expect: false },
];

let pass = 0, fail = 0;
for (const c of CASES) {
  let got, ok;
  try {
    got = shouldAutoShowNext(c.date, c.now);
    ok = (got === c.expect);
  } catch (e) {
    got = 'ERROR: ' + e.message;
    ok = false;
  }
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✓' : '✗'} ${c.id} ${c.desc}  (expect=${c.expect}, got=${got})`);
}

console.log(`\nSUBTAB_AUTO_SWITCH_HOURS = ${SUBTAB_AUTO_SWITCH_HOURS}`);
console.log(`通過 ${pass} / ${CASES.length}，失敗 ${fail}`);
process.exit(fail ? 1 : 0);
