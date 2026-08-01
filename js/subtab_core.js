/* ============================================================
 * 子分頁自動切換 · 純邏輯模組 (subtab_core.js)
 * ------------------------------------------------------------
 * 供瀏覽器 (window/subtab_core.js 腳本) 與 Node 測試 (require) 共用。
 * 不含任何 DOM 依賴，確保可單元測試。
 *
 * 規則：依「最新開獎結果時間」決定首頁「最新結果」模組的預設子分頁。
 *   - 距離最新開獎結果時間 ≤ 18 小時 → 顯示「最新開獎結果」
 *   - 距離最新開獎結果時間 >  18 小時 → 顯示「下期攪珠」
 *
 * 開獎時間以香港時間 (HKT, +08:00) 21:30 錨定，與 js/app.js 的
 * startNextCountdown / recomputeNextDrawClient 時區處理一致。
 * ============================================================ */

/** 自動切換閾值（小時）：超過此值即改顯示「下期攪珠」 */
const SUBTAB_AUTO_SWITCH_HOURS = 18;

/**
 * 判斷是否應顯示「下期攪珠」子分頁。
 * @param {string} drawDateStr 最新開獎日期，格式 'YYYY-MM-DD'（如 '2026-07-30'）
 * @param {Date}   now         要比較的當下時間（預設為 new Date()，便於測試注入）
 * @returns {boolean} true=顯示下期攪珠；false=顯示最新開獎結果
 */
function shouldAutoShowNext(drawDateStr, now = new Date()) {
  // 容錯：缺少日期或無法解析時，預設顯示「最新開獎結果」（安全值）
  if (!drawDateStr) return false;
  const resultTime = new Date(drawDateStr + 'T21:30:00+08:00');
  if (isNaN(resultTime.getTime())) return false;

  const diffMs = now.getTime() - resultTime.getTime();
  return diffMs > SUBTAB_AUTO_SWITCH_HOURS * 3600 * 1000;
}

// 同時支援 Node (require) 與瀏覽器 (全域腳本)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SUBTAB_AUTO_SWITCH_HOURS, shouldAutoShowNext };
}
