// =============================================================================
// next_draw_schedule_test.js
// -----------------------------------------------------------------------------
// 排程／日曆測試 — 驗證「下期攪珠日程」資料合約與前端日曆渲染邏輯
//
// 對應決策：B（只解耦刷新，不做預測擴展）
//   原 bug：日曆雙月視窗內的未來月份（如 9 月）因賽馬會尚未發佈而留白。
//   本測試守護：
//     1) next_draw.json 資料合約（排序 / 含未來攪珠日 / 可算下期）
//     2) 前端 renderNextSchedule 渲染邏輯（資料存在時正確標記 draw / snowball）
//     3) recomputeNextDrawClient 下期計算（跨年重置 / 同年 +1）
//     4) 刷新解耦靜態守護（daily_update.py 中 fnd.main() 必須早於 new_count 早退）
//
// 注意：本測試「不」斷言 9 月一定出現——那需要預測擴展（見 ADR）。
//       只斷言「一旦資料存在，日曆能正確渲染」+「刷新機制每日運作」。
//
// 執行： node tests/next_draw_schedule_test.js
// =============================================================================
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const APP_JS = path.join(ROOT, 'js', 'app.js');
const NEXT_DRAW_JSON = path.join(ROOT, 'data', 'next_draw.json');
const DAILY_UPDATE_PY = path.join(ROOT, 'pipline', 'daily_update.py');

// ---- 從 app.js 抽取純函式（不執行整個 app.js，避免 DOM 依賴）------------
// renderNextSchedule / recomputeNextDrawClient 為純函式（不觸碰 document），
// 故可安全抽取其原始碼後 eval 執行，測試「真實部署的程式碼」而非副本。
function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`找不到函式 ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`無法配對 ${name} 的括號`);
}

const appSrc = fs.readFileSync(APP_JS, 'utf-8');
const renderNextSchedule = eval('(' + extractFunction(appSrc, 'renderNextSchedule') + ')');
const recomputeNextDrawClient = eval('(' + extractFunction(appSrc, 'recomputeNextDrawClient') + ')');

// ---- 1) next_draw.json 資料合約 -------------------------------------------
function testDataContract() {
  const data = JSON.parse(fs.readFileSync(NEXT_DRAW_JSON, 'utf-8'));
  assert.ok(data.schedule && Array.isArray(data.schedule), 'schedule 必須是陣列');
  assert.ok(data.schedule.length > 0, 'schedule 不得為空');

  for (let i = 1; i < data.schedule.length; i++) {
    assert.ok(
      data.schedule[i].date >= data.schedule[i - 1].date,
      `schedule 必須遞增排序（${data.schedule[i - 1].date} > ${data.schedule[i].date}）`
    );
  }
  for (const s of data.schedule) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.date), `日期格式錯誤: ${s.date}`);
    assert.strictEqual(typeof s.snowball, 'boolean', `snowball 必須是 boolean: ${s.date}`);
  }

  const latestDate = (data.meta && data.meta.latest_draw_date) || '';
  const future = data.schedule.filter((s) => s.date > latestDate);
  assert.ok(future.length > 0, '必須至少有 1 個晚於最新開獎日的未來攪珠日（否則無法算下期）');

  assert.ok(data.next_draw && data.next_draw.draw_date, 'next_draw.draw_date 必須存在');
}

// ---- 2) renderNextSchedule 渲染邏輯（用含未來月份的 fixture）-------------
function testRenderNextSchedule() {
  // 下期 2026-08-04 → 雙月視窗 = 8 月 + 9 月；fixture 含 9 月攪珠日，
  // 證明「資料存在時日曆能渲染未來月份」（原 bug 即 9 月留白）。
  const nextDate = '2026-08-04';
  const schedule = [
    { date: '2026-08-04', snowball: false },
    { date: '2026-08-06', snowball: true },
    { date: '2026-08-08', snowball: false },
    { date: '2026-09-01', snowball: false },
    { date: '2026-09-03', snowball: true },
    { date: '2026-09-05', snowball: false },
  ];
  const html = renderNextSchedule(schedule, nextDate);
  assert.ok(typeof html === 'string' && html.length > 0, '應回傳非空 HTML');

  // upcoming = date > nextDate → 8/6,8/8,9/1,9/3,9/5（5 個，8/4 等於被排除）
  const drawOnly = (html.match(/class="nd-cal-cell draw"/g) || []).length;
  const snow = (html.match(/class="nd-cal-cell draw snowball"/g) || []).length;
  assert.strictEqual(drawOnly, 3, `應有 3 個純 draw cell（實際 ${drawOnly}）`);
  assert.strictEqual(snow, 2, `應有 2 個 snowball cell（8/6,9/3）（實際 ${snow}）`);

  assert.ok(html.includes('2026年 8月'), '應含 8 月曆');
  assert.ok(html.includes('2026年 9月'), '應含 9 月曆（證明日曆能渲染未來月份）');
}

// ---- 3) recomputeNextDrawClient 下期計算 ---------------------------------
function testRecomputeNextDrawClient() {
  // 跨年：下期應重置為 27/001
  const nd = recomputeNextDrawClient('26/150', '2026-12-29', [
    { date: '2026-12-29', snowball: false },
    { date: '2027-01-02', snowball: true },
  ]);
  assert.ok(nd, '應回傳下期');
  assert.strictEqual(nd.draw_date, '2027-01-02', '下期應為 2027-01-02');
  assert.strictEqual(nd.draw_no, '27/001', '跨年應重置為 27/001');
  assert.strictEqual(nd.is_snowball, true, '應識別金多寶');

  // 同年：下期應 +1
  const nd2 = recomputeNextDrawClient('26/083', '2026-08-01', [
    { date: '2026-08-04', snowball: false },
  ]);
  assert.strictEqual(nd2.draw_no, '26/084', '同年應 +1');
  assert.strictEqual(nd2.draw_date, '2026-08-04');
}

// ---- 4) 刷新解耦靜態守護（避免有人把 fnd.main() 移回早退之後）----------
function testRefreshDecoupled() {
  const src = fs.readFileSync(DAILY_UPDATE_PY, 'utf-8');
  const callIdx = src.indexOf('fnd.main()');
  const earlyExitIdx = src.indexOf('if new_count == 0:');
  assert.ok(callIdx >= 0, 'daily_update.py 應呼叫 fetch_next_draw.main()');
  assert.ok(earlyExitIdx >= 0, 'daily_update.py 應有 new_count 早退邏輯');
  assert.ok(
    callIdx < earlyExitIdx,
    '下期攪珠刷新必須在 new_count 早退「之前」執行（與開獎結果更新解耦）'
  );
}

// ---- 執行器 ----------------------------------------------------------------
let passed = 0;
let failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n      ${e.message}`);
  }
}

console.log('=== next_draw 排程／日曆測試 ===');
run('資料合約 (next_draw.json)', testDataContract);
run('renderNextSchedule 渲染邏輯', testRenderNextSchedule);
run('recomputeNextDrawClient 下期計算', testRecomputeNextDrawClient);
run('刷新解耦靜態守護 (daily_update.py)', testRefreshDecoupled);
console.log(`\n結果: ${passed} 通過, ${failed} 失敗`);
process.exit(failed === 0 ? 0 : 1);
