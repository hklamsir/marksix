// =============================================================================
// checker_core.js
// -----------------------------------------------------------------------------
// 中獎核對系統核心邏輯的「忠實副本」。
// 以下函數逐字抄錄自 js/app.js（於 2026-07-26 閱讀確認），用於在 Node 環境下
// 對「中獎核對系統」做單元測試，毋須瀏覽器 / DOM。
//
// 驗證策略：
//   1) runCheck()  —— 還原 app.js 的 doCheck 防護與 renderMultiCheckResult 的
//                      獎級聚合邏輯（「公式路徑 / 優化路徑」）。
//   2) bruteForce()—— 完全獨立、僅依賴 resolveCheckerPrizeTier + 逐注列舉
//                      （「暴力列舉 / 真值」）。
//   若兩者對每個獎級的注數與總獎金完全一致，即證明優化公式與特別號碼拆分邏輯正確。
// =============================================================================

// ---- 組合數 C(n, k)（app.js:78）-------------------------------------------
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

// ---- 依「中幾個正選 + 是否中特別」判斷獎級（app.js:1182）-----------------
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

// ---- 獎金（app.js:1193，略調簽名為 (prizes, tier)）----------------------
function checkerPrizeAmount(prizes, tier) {
  const P = prizes || {};
  if (tier === '頭獎') return P['頭獎']?.amount || 8000000;
  if (tier === '二獎') return P['二獎']?.amount;          // 無保底，缺資料會是 undefined
  if (tier === '三獎') return P['三獎']?.amount;          // 無保底，缺資料會是 undefined
  if (tier === '四獎') return 9600;
  if (tier === '五獎') return 640;
  if (tier === '六獎') return 320;
  if (tier === '七獎') return 40;
  return 0;
}

// ---- 複式分佈：超幾何分佈（app.js:1211）----------------------------------
function computeMultipleDistribution(pool, drawMain, chooseSize = 6) {
  const hit = pool.filter(n => drawMain.includes(n)).length;
  const miss = pool.length - hit;
  const dist = {};
  for (let k = 0; k <= chooseSize; k++) {
    const count = combination(hit, k) * combination(miss, chooseSize - k);
    if (count > 0) dist[k] = count;
  }
  return dist;
}

// ---- 膽拖分佈（app.js:1225）----------------------------------------------
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

// ---- 特別號碼拆分（app.js:1248）------------------------------------------
function splitDistributionBySpecial(pool, drawMain, specialNum, betType, bankers) {
  const hasSpecial = pool.includes(specialNum);
  if (!hasSpecial) {
    return { withSpecial: null, withoutSpecial: null };
  }
  if (betType === 'multiple') {
    const poolNoSpecial = pool.filter(n => n !== specialNum);
    return {
      withSpecial: computeMultipleDistribution(poolNoSpecial, drawMain, 5),
      withoutSpecial: computeMultipleDistribution(poolNoSpecial, drawMain, 6),
    };
  }
  // banker mode
  if (bankers.includes(specialNum)) {
    return { withSpecial: null, withoutSpecial: null };
  }
  const poolNoSpecial = pool.filter(n => n !== specialNum);
  const bankersNoSpecial = bankers;
  const legsNoSpecial = poolNoSpecial.filter(n => !bankers.includes(n));
  const need = 6 - bankers.length;
  const hitBanker = bankers.filter(n => drawMain.includes(n)).length;
  const hitLegTotal = legsNoSpecial.filter(n => drawMain.includes(n)).length;
  const missLegTotal = legsNoSpecial.length - hitLegTotal;

  const withSpecial = {};
  for (let j = 0; j <= need - 1; j++) {
    const count = combination(hitLegTotal, j) * combination(missLegTotal, need - 1 - j);
    if (count > 0) {
      const k = hitBanker + j;
      withSpecial[k] = (withSpecial[k] || 0) + count;
    }
  }
  const withoutSpecial = {};
  for (let j = 0; j <= need; j++) {
    const count = combination(hitLegTotal, j) * combination(missLegTotal, need - j);
    if (count > 0) {
      const k = hitBanker + j;
      withoutSpecial[k] = (withoutSpecial[k] || 0) + count;
    }
  }
  return { withSpecial, withoutSpecial };
}

// ---- 聚合（還原 renderMultiCheckResult 的獎級計帳，app.js:1439-1503）------
function aggregateResult(betType, fullPool, dist, totalUnits, split, draw, bankerNumbers) {
  const prizes = draw.prizes || {};
  const hasSplit = split && (split.withSpecial || split.withoutSpecial);
  const rows = [];
  let totalWinUnits = 0;
  let totalAmount = 0;

  if (hasSplit) {
    const tierMap = {};
    if (split.withSpecial) {
      for (let k = 6; k >= 3; k--) {
        const count = split.withSpecial[k] || 0;
        if (count <= 0) continue;
        const tier = resolveCheckerPrizeTier(k, true);
        if (!tier) continue;
        tierMap[tier] = (tierMap[tier] || 0) + count;
      }
    }
    if (split.withoutSpecial) {
      for (let k = 6; k >= 3; k--) {
        const count = split.withoutSpecial[k] || 0;
        if (count <= 0) continue;
        const tier = resolveCheckerPrizeTier(k, false);
        if (!tier) continue;
        tierMap[tier] = (tierMap[tier] || 0) + count;
      }
    }
    for (const [tier, count] of Object.entries(tierMap)) {
      const amount = checkerPrizeAmount(prizes, tier);
      if (!amount) continue;
      const subtotal = amount * count;
      totalWinUnits += count;
      totalAmount += subtotal;
      rows.push({ tier, count, amount, subtotal });
    }
  } else {
    let matchSpecial;
    if (split) {
      const specialInBanker = betType === 'banker' && bankerNumbers.includes(draw.special_number);
      matchSpecial = specialInBanker;
    } else {
      matchSpecial = fullPool.includes(draw.special_number);
    }
    for (let k = 6; k >= 3; k--) {
      const count = dist[k] || 0;
      if (count <= 0) continue;
      const tier = resolveCheckerPrizeTier(k, matchSpecial);
      if (!tier) continue;
      const amount = checkerPrizeAmount(prizes, tier);
      if (!amount) continue;
      const subtotal = amount * count;
      totalWinUnits += count;
      totalAmount += subtotal;
      rows.push({ k, tier, count, amount, subtotal });
    }
  }

  const tiers = {};
  for (const r of rows) tiers[r.tier] = (tiers[r.tier] || 0) + r.count;
  return { tiers, totalUnits, totalWinUnits, totalAmount, rows };
}

// ---- 還原 doCheck 的防護 + 計算（app.js:1301）-----------------------------
function runCheck(input) {
  const { betType, draw } = input;
  const CHECKER_SINGLE_COUNT = 6;
  const CHECKER_MAX_BANKERS = 5;

  if (!draw || !draw.main_numbers || !Array.isArray(draw.main_numbers)) {
    return { error: '開獎資料格式異常' };
  }
  const mainNumbers = input.mainNumbers || [];
  const bankerNumbers = input.bankerNumbers || [];
  const legNumbers = input.legNumbers || [];

  if (betType === 'multiple') {
    if (mainNumbers.length < 7) {
      return { error: '複式投注最少需要選擇 7 個號碼' };
    }
    const dist = computeMultipleDistribution(mainNumbers, draw.main_numbers);
    const totalUnits = combination(mainNumbers.length, 6);
    const split = splitDistributionBySpecial(mainNumbers, draw.main_numbers, draw.special_number, 'multiple', []);
    return aggregateResult('multiple', mainNumbers, dist, totalUnits, split, draw, []);
  }

  if (betType === 'banker') {
    if (bankerNumbers.length < 1) {
      return { error: '請至少選擇 1 個膽碼' };
    }
    const need = 6 - bankerNumbers.length;
    if (legNumbers.length < need) {
      return { error: `腳碼數量不足，尚需最少 ${need} 個腳碼` };
    }
    const dist = computeBankerDistribution(bankerNumbers, legNumbers, draw.main_numbers);
    const totalUnits = combination(legNumbers.length, need);
    const fullPool = [...bankerNumbers, ...legNumbers];
    const split = splitDistributionBySpecial(fullPool, draw.main_numbers, draw.special_number, 'banker', bankerNumbers);
    return aggregateResult('banker', fullPool, dist, totalUnits, split, draw, bankerNumbers);
  }

  return { error: '不支援的投注類型' };
}

// ---- 獨立暴力列舉（真值）：只用 resolveCheckerPrizeTier -------------------
function* indexCombinations(n, k) {
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.slice();
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function bruteForce(input) {
  const { betType, draw } = input;
  const main = draw.main_numbers;
  const special = draw.special_number;
  const mainNumbers = input.mainNumbers || [];
  const bankerNumbers = input.bankerNumbers || [];
  const legNumbers = input.legNumbers || [];

  const combos = [];
  if (betType === 'multiple') {
    const n = mainNumbers.length;
    for (const sel of indexCombinations(n, 6)) {
      combos.push(sel.map(i => mainNumbers[i]));
    }
  } else if (betType === 'banker') {
    const need = 6 - bankerNumbers.length;
    const l = legNumbers.length;
    for (const sel of indexCombinations(l, need)) {
      combos.push([...bankerNumbers, ...sel.map(i => legNumbers[i])]);
    }
  } else {
    return {};
  }

  const tiers = {};
  let totalWinUnits = 0;
  for (const c of combos) {
    const matchMain = c.filter(x => main.includes(x)).length;
    const matchSpecial = c.includes(special);
    const tier = resolveCheckerPrizeTier(matchMain, matchSpecial);
    if (tier) {
      tiers[tier] = (tiers[tier] || 0) + 1;
      totalWinUnits++;
    }
  }
  const prizes = draw.prizes || {};
  let totalAmount = 0;
  for (const [tier, count] of Object.entries(tiers)) {
    const amt = checkerPrizeAmount(prizes, tier);
    if (amt) totalAmount += amt * count;
  }
  return { tiers, totalWinUnits, totalAmount };
}

// 標準獎金表（用於一般案例，讓二/三獎金額確定）
const STANDARD_PRIZES = {
  '頭獎': { amount: 16000000 },
  '二獎': { amount: 1500000 },
  '三獎': { amount: 90000 },
  '四獎': { amount: 9600 },
  '五獎': { amount: 640 },
  '六獎': { amount: 320 },
  '七獎': { amount: 40 },
};

module.exports = {
  combination,
  resolveCheckerPrizeTier,
  checkerPrizeAmount,
  computeMultipleDistribution,
  computeBankerDistribution,
  splitDistributionBySpecial,
  aggregateResult,
  runCheck,
  bruteForce,
  STANDARD_PRIZES,
};
