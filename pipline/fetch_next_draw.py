#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_next_draw.py
==================
計算「下期六合彩攪珠」資料並輸出 data/next_draw.json。

資料來源：
  1) 攪珠日程表 — 香港賽馬會 Sitecore GraphQL (MarksixFixtures)，
     提供每個月的「一般攪珠日期」(NormalDrawDates) 與
     「金多寶攪珠日期」(SnowballDrawDates)。
  2) 最新一期開獎 — 本地 data/draw_results_verified.json（由 daily_update.py 維護）。

計算邏輯：
  * 下期攪珠日期 = 日程表中「晚於最新一期開獎日」的第一個攪珠日。
  * 下期攪珠期數 = 最新一期期數 + 1；若跨年則重置為 01/001。
  * 是否金多寶   = 該日期是否落在 SnowballDrawDates。

輸出 data/next_draw.json 結構：
{
  "meta": {
    "generated": "<ISO8601>",
    "source": "hkjc_sitecore_schedule + local_verified",
    "latest_draw_no": "26/079",
    "latest_draw_date": "2026-07-23",
    "schedule_years": ["2025","2026"]
  },
  "schedule": [ {"date":"2026-07-25","snowball":false}, ... ],  // 未來全部攪珠日
  "next_draw": {
    "draw_no": "26/080",
    "draw_date": "2026-07-25",
    "day_of_week": "六",
    "is_snowball": false,
    "snowball_name": null,
    "sales_close": "21:15",
    "draw_time": "21:30",
    "estimated_jackpot": null,
    "status": "ok"
  }
}

用法：
  python pipline/fetch_next_draw.py            # 正常執行
  python pipline/fetch_next_draw.py --dry-run # 試執行,不寫入
"""

import argparse
import json
import os
import ssl
import sys
import urllib.request
from datetime import date, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# 路徑
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
VERIFIED_JSON = DATA_DIR / "draw_results_verified.json"
OUTPUT_JSON = DATA_DIR / "next_draw.json"

# ---------------------------------------------------------------------------
# Sitecore GraphQL 設定（取自 bet.hkjc.com/Config/GlobalConfig.js）
# ---------------------------------------------------------------------------
SITECORE_EP = "https://consvc.hkjc.com/JCBW/api/graph"
SITECORE_APIKEY = "{FF2309B7-E8BB-49B2-82A7-36AE0B48F171}"
SCHEDULE_PATH = "/sitecore/content/Sites/JCBW/NextDrawSchedule/Schedule"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

WEEKDAY_MAP = {0: "一", 1: "二", 2: "三", 3: "四", 4: "五", 5: "六", 6: "日"}

# 六合彩標準時間（HKJC 官方）：攪珠日投注截止 21:15，攪珠 21:30（HKT）
SALES_CLOSE = "21:15"
DRAW_TIME = "21:30"

SCHEDULE_QUERY = """
query MarksixFixtures($path: String!, $lang: String!) {
  item(path: $path, language: $lang) {
    years: children {
      year: name
      months: children {
        key: name
        month: field(name: "DrawMonth") { value }
        dates: field(name: "NormalDrawDates") {
          ... on MultilistField { date: targetItems { value: name } }
        }
        snowballs: field(name: "SnowballDrawDates") {
          ... on MultilistField { date: targetItems { value: name } }
        }
      }
    }
  }
}"""


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def get_day_of_week(d: date) -> str:
    return WEEKDAY_MAP[d.weekday()]


# ---------------------------------------------------------------------------
# 1) 讀取最新一期
# ---------------------------------------------------------------------------
def load_latest_draw() -> tuple[str, str, dict, dict]:
    """回傳 (最新期數, 開獎日期, 最新一期 完整prizes字典, _pool 獎金池)。"""
    if not VERIFIED_JSON.exists():
        raise RuntimeError(f"找不到 {VERIFIED_JSON}，請先執行 daily_update.py")
    with VERIFIED_JSON.open("r", encoding="utf-8") as f:
        data = json.load(f)
    draws = data.get("draws") or []
    if not draws:
        raise RuntimeError("draw_results_verified.json 無開獎資料")
    # 期數字串 "YY/NNN" 在同為兩位年 + 三位序號(零填充)下,字典序即時間序
    latest = max(draws, key=lambda x: x.get("draw_no", ""))
    prizes = latest.get("prizes") or {}
    pool = prizes.get("_pool") or {}
    return latest["draw_no"], (latest.get("date") or "")[:10], prizes, pool


# ---------------------------------------------------------------------------
# 2) 抓取攪珠日程表
# ---------------------------------------------------------------------------
def fetch_schedule() -> list[dict]:
    """從 Sitecore GraphQL 抓取攪珠日程表,回傳排序後的日期清單
       [{date:'YYYY-MM-DD', snowball:bool}, ...]（含過去與未來）。"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    body = json.dumps({
        "query": SCHEDULE_QUERY,
        "variables": {"path": SCHEDULE_PATH, "lang": "zh-HK"},
    }).encode("utf-8")
    req = urllib.request.Request(
        SITECORE_EP, data=body,
        headers={"User-Agent": UA, "Content-Type": "application/json",
                 "Accept": "application/json", "sc_apikey": SITECORE_APIKEY,
                 "Origin": "https://bet.hkjc.com"},
    )
    with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip_decompress(raw)
    data = json.loads(raw.decode("utf-8", "ignore"))
    if data.get("errors"):
        msgs = " | ".join(e.get("message", "") for e in data["errors"])
        raise RuntimeError(f"Sitecore GraphQL 錯誤: {msgs}")

    item = (data.get("data") or {}).get("item")
    if not item:
        raise RuntimeError("Sitecore 日程表 item 為空")

    merged = {}  # date -> snowball
    years = []
    for ynode in (item.get("years") or []):
        y = ynode.get("year")
        if not y or not y.isdigit():
            continue
        years.append(y)
        for mnode in (ynode.get("months") or []):
            mkey = mnode.get("key")
            try:
                m = int(mkey)
            except (TypeError, ValueError):
                continue
            normals = [(d.get("value") or "").strip()
                       for d in ((mnode.get("dates") or {}).get("date") or [])]
            snows = set((d.get("value") or "").strip()
                        for d in ((mnode.get("snowballs") or {}).get("date") or []))
            for dstr in normals:
                try:
                    day = int(dstr)
                except ValueError:
                    continue
                dd = f"{y}-{m:02d}-{day:02d}"
                merged[dd] = merged.get(dd, False) or (dstr in snows)
            for dstr in snows:
                try:
                    day = int(dstr)
                except ValueError:
                    continue
                dd = f"{y}-{m:02d}-{day:02d}"
                merged[dd] = True

    schedule = [{"date": k, "snowball": v} for k, v in merged.items()]
    schedule.sort(key=lambda x: x["date"])
    log(f"  日程表共 {len(schedule)} 個攪珠日 (年份: {years})")
    return schedule, years


def gzip_decompress(raw: bytes) -> bytes:
    import gzip
    return gzip.decompress(raw)


# ---------------------------------------------------------------------------
# 3) 計算下期攪珠
# ---------------------------------------------------------------------------
def compute_next_draw(latest_no: str, latest_date: str,
                      schedule: list[dict],
                      latest_pool: dict | None = None,
                      latest_prizes: dict | None = None) -> dict:
    """根據最新期數/日期與日程表,計算下期攪珠。

    多寶彩金邏輯（按 HKJC 獎券規例 2024-05-21 生效之規則）：
      1. 獎金基金 = 總投注額 × 54%
      2. 固定獎金 = 第四至七組 winners × 每注派彩
      3. 金多寶扣數 SD = 9%×[PF-FP-55%×(60%×PF-FP)] + 55%×(60%×PF-FP)
      4. 頭獎池 = 45% × (PF - FP - SD)
      5. 若上期頭獎 winners == 0（無人中頭獎），頭獎池整筆滾存至下期。
      6. 頭獎保證最少 HK$8,000,000（derived_first_prize_div）。
    """
    # 最新一期開獎日（用於決定「下一個」攪珠日）
    try:
        latest_d = date.fromisoformat(latest_date)
    except (ValueError, TypeError):
        latest_d = date.today()

    # 下一個攪珠日 = 晚於最新開獎日的第一個日程日
    future = [s for s in schedule if s["date"] > latest_date]
    if not future:
        raise RuntimeError("日程表中無晚於最新開獎日的攪珠日（請更新日程表）")

    nxt = future[0]
    nxt_date = date.fromisoformat(nxt["date"])
    is_snowball = nxt["snowball"]

    # 下期期數：最新 + 1；跨年重置 01/001
    try:
        yy, nnn = latest_no.split("/")
        yy_i = int(yy)
        nnn_i = int(nnn)
    except (ValueError, AttributeError):
        yy_i, nnn_i = nxt_date.year % 100, 0
    if nxt_date.year != latest_d.year:
        next_no = f"{nxt_date.year % 100:02d}/001"
    else:
        next_no = f"{yy_i:02d}/{nnn_i + 1:03d}"

    # ---- 多寶彩金（累積滾存）計算 ----
    pool = latest_pool or {}
    prizes = latest_prizes or {}
    try:
        total_investment = int(pool.get("total_investment") or 0)
    except (ValueError, TypeError):
        total_investment = 0

    # 獎金基金 = 總投注額 × 54%
    pf = total_investment * 0.54  # prize fund

    # 固定獎金（第四至第七組）
    fp = 0.0  # fixed prizes total
    for tier in ("四獎", "五獎", "六獎", "七獎"):
        t = prizes.get(tier) or {}
        w = int(t.get("winners") or 0)
        a = int(t.get("amount") or 0)
        fp += w * a

    # 金多寶扣數（Snowball Deduction）
    # SD = 9%×[PF-FP-55%×(60%×PF-FP)] + 55%×(60%×PF-FP)
    # 化簡：SD = 0.3903×PF - 0.5905×FP
    inner = 0.6 * pf - fp
    sd = 0.09 * (pf - fp - 0.55 * inner) + 0.55 * inner

    # 頭獎池 = 45% × (獎金基金 − 固定獎金 − 扣數)
    remaining = pf - fp - sd
    head_pool_computed = max(0.0, remaining) * 0.45

    # 頭獎保證最少 derived_first_prize_div（常為 8,000,000）
    try:
        jackpot_guarantee = int(pool.get("derived_first_prize_div") or 8000000)
    except (ValueError, TypeError):
        jackpot_guarantee = 8000000

    # 是否頭獎無人命中 → 滾存
    head_prize = prizes.get("頭獎") or {}
    head_winners = int(head_prize.get("winners") or 0)
    is_rollover = (head_winners == 0)

    # 若頭獎無人命中，實際頭獎基金不少於保證額（HKJC 規定），
    # 該保證額亦應滾存至下期多寶彩池。
    if is_rollover:
        head_pool = max(float(jackpot_guarantee), head_pool_computed)
    else:
        head_pool = head_pool_computed

    jackpot_rollover = int(head_pool) if (is_rollover and head_pool > 0) else 0

    return {
        "draw_no": next_no,
        "draw_date": nxt["date"],
        "day_of_week": get_day_of_week(nxt_date),
        "is_snowball": is_snowball,
        "snowball_name": ("金多寶攪珠" if is_snowball else None),
        "sales_close": SALES_CLOSE,
        "draw_time": DRAW_TIME,
        "estimated_jackpot": None,
        "jackpot_rollover": jackpot_rollover,
        "jackpot_guarantee": jackpot_guarantee,
        "jackpot_is_rollover": is_rollover,
        "status": "ok",
    }


# ---------------------------------------------------------------------------
# 主程式
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="計算下期六合彩攪珠資料")
    ap.add_argument("--dry-run", action="store_true", help="試執行,不寫入")
    args = ap.parse_args()

    log("=" * 60)
    log("下期六合彩攪珠資料生成")
    log("=" * 60)

    # Step 1: 最新一期
    latest_no, latest_date, latest_prizes, latest_pool = load_latest_draw()
    log(f"最新一期: {latest_no} ({latest_date})")

    # Step 2: 日程表
    log("抓取賽馬會攪珠日程表 (Sitecore GraphQL)...")
    try:
        schedule, years = fetch_schedule()
    except Exception as e:  # noqa: BLE001
        log(f"  ✗ 日程表抓取失敗: {e}")
        # 優雅降級：寫入 unavailable 狀態,讓前端顯示提示
        out = {
            "meta": {
                "generated": datetime.now().isoformat(timespec="seconds"),
                "source": "local_only (schedule fetch failed)",
                "latest_draw_no": latest_no,
                "latest_draw_date": latest_date,
                "error": str(e),
            },
            "schedule": [],
            "next_draw": {
                "draw_no": None, "draw_date": None, "day_of_week": None,
                "is_snowball": False, "snowball_name": None,
                "sales_close": SALES_CLOSE, "draw_time": DRAW_TIME,
                "estimated_jackpot": None,
                "jackpot_rollover": 0, "jackpot_guarantee": 8000000,
                "jackpot_is_rollover": False,
                "status": "unavailable",
            },
        }
        if not args.dry_run:
            OUTPUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
            log(f"  ✓ 已寫入 {OUTPUT_JSON.relative_to(PROJECT_ROOT)} (狀態: unavailable)")
        else:
            log("[DRY-RUN] 跳過寫入")
        return

    # Step 3: 計算下期
    next_draw = compute_next_draw(latest_no, latest_date, schedule,
                                  latest_pool, latest_prizes)
    log(f"下期攪珠: 第 {next_draw['draw_no']} 期, {next_draw['draw_date']} "
        f"({next_draw['day_of_week']})"
        f"{' [金多寶]' if next_draw['is_snowball'] else ''}")

    # 保留完整日程（含過去），供前端即時重算下期攪珠使用
    # （檔案體積極小，且可避免因只存未來日程而導致跨月/跨年重算失效）
    future_schedule = schedule

    out = {
        "meta": {
            "generated": datetime.now().isoformat(timespec="seconds"),
            "source": "hkjc_sitecore_schedule + local_verified",
            "latest_draw_no": latest_no,
            "latest_draw_date": latest_date,
            "schedule_years": years,
        },
        "schedule": future_schedule,
        "next_draw": next_draw,
    }

    if args.dry_run:
        log("[DRY-RUN] 跳過寫入")
        return

    OUTPUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=2),
                           encoding="utf-8")
    log(f"  ✓ 已寫入 {OUTPUT_JSON.relative_to(PROJECT_ROOT)}")
    log("=" * 60)
    log(f"✓ 完成！下期: 第 {next_draw['draw_no']} 期 @ {next_draw['draw_date']}")


if __name__ == "__main__":
    main()
