#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
daily_update.py
===============
GitHub Actions 每日自動更新腳本 — 從 HKJC 官方 GraphQL 抓取最新六合彩開獎資料，
合併至 draw_results_verified.json 並重新生成 data/data.js。

排程：每日 23:00 HKT（由 GitHub Actions cron 控制）
設計原則：
  - 僅抓取近 30 天資料（六合彩每週約 2-3 期，30 天足夠覆蓋）
  - 以 draw_no 去重，安全冪等（重複執行不會產生重複資料）
  - 僅更新 draw_results_verified.json（49 號碼時代 2002+）；
    draw_results_1976_2002.json 為歷史靜態資料，無需更新
  - 若無新資料則跳過後續步驟，避免無意義 commit
  - 失敗時回傳非零 exit code，觸發 GitHub Actions 失敗通知

用法：
  python pipline/daily_update.py              # 正常執行（GitHub Actions 用）
  python pipline/daily_update.py --dry-run    # 試執行，不寫入檔案
"""

import argparse
import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# 路徑設定（以專案根目錄為基準）
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
QUERY_FILE = SCRIPT_DIR / "marksix_query.graphql"
DRAWS_JSON = DATA_DIR / "draw_results_verified.json"
RECORDS_JSON = DATA_DIR / "draw_results_1976_2002.json"
OUTPUT_JS = DATA_DIR / "data.js"

# ---------------------------------------------------------------------------
# HKJC GraphQL API 設定
# ---------------------------------------------------------------------------
GRAPHQL_EP = "https://info.cld.hkjc.com/graphql/base/"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
LOOKBACK_DAYS = 30  # 每次抓取最近 N 天
MAX_RETRIES = 3
RETRY_BACKOFF = 2.0  # 秒

# 獎級對應（與 fetch_prizes.py / app.js 對齊）
TIER_MAP = {1: "頭獎", 2: "二獎", 3: "三獎", 4: "四獎",
            5: "五獎", 6: "六獎", 7: "七獎"}

# 星期中文對照
WEEKDAY_MAP = {0: "一", 1: "二", 2: "三", 3: "四", 4: "五", 5: "六", 6: "日"}

# 內嵌查詢（備用；優先讀取外部 marksix_query.graphql）
EMBEDDED_QUERY = """
        query marksixResult($lastNDraw: Int, $startDate: String, $endDate: String, $drawType: LotteryDrawType) {
            lotteryDraws(lastNDraw: $lastNDraw, startDate: $startDate, endDate: $endDate, drawType: $drawType) {
              ...lotteryDrawsFragment
            }
        }

fragment lotteryDrawsFragment on LotteryDraw {
    id
    year
    no
    openDate
    closeDate
    drawDate
    status
    snowballCode
    snowballName_en
    snowballName_ch
    lotteryPool {
      sell
      status
      totalInvestment
      jackpot
      unitBet
      estimatedPrize
      derivedFirstPrizeDiv
      lotteryPrizes {
        type
        winningUnit
        dividend
      }
    }
    drawResult {
      drawnNo
      xDrawnNo
    }
  }
"""


# ---------------------------------------------------------------------------
# 工具函式
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_query() -> str:
    """載入 GraphQL 查詢，優先讀取外部檔案以確保 sha256 一致。"""
    if QUERY_FILE.exists():
        q = QUERY_FILE.read_text(encoding="utf-8").strip()
        if q:
            return q
    return EMBEDDED_QUERY


def draw_no_from(year: str, no: int) -> str:
    """(year='2026', no=77) -> '26/077'"""
    return f"{int(year) % 100:02d}/{int(no):03d}"


def get_weekday_cn(d: date) -> str:
    """date -> 中文星期"""
    return WEEKDAY_MAP[d.weekday()]


# ---------------------------------------------------------------------------
# HKJC GraphQL 抓取
# ---------------------------------------------------------------------------
def fetch_latest_draws(query: str, start_ymd: str, end_ymd: str) -> list[dict]:
    """從 HKJC GraphQL 抓取指定日期範圍的開獎結果。含重試機制。"""
    sha = hashlib.sha256(query.encode("utf-8")).hexdigest()
    start_date = start_ymd.replace("-", "")
    end_date = end_ymd.replace("-", "")

    body = {
        "operationName": "marksixResult",
        "variables": {
            "drawType": "All",
            "startDate": start_date,
            "endDate": end_date,
        },
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": sha}},
        "query": query,
    }

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            req = urllib.request.Request(
                GRAPHQL_EP,
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "User-Agent": UA,
                    "Content-Type": "application/json",
                    "Origin": "https://bet.hkjc.com",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)

            data = json.loads(raw.decode("utf-8", "ignore"))
            if data.get("errors"):
                msgs = " | ".join(e.get("message", "") for e in data["errors"])
                log(f"  ⚠ GraphQL errors: {msgs}")
                return []
            return (data.get("data") or {}).get("lotteryDraws") or []

        except Exception as e:
            last_err = e
            log(f"  ⚠ 第 {attempt}/{MAX_RETRIES} 次失敗: {type(e).__name__}: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF * attempt)

    log(f"  ✗ 重試用盡，放棄: {last_err}")
    raise RuntimeError(f"HKJC GraphQL 抓取失敗（{MAX_RETRIES} 次重試）: {last_err}")


# ---------------------------------------------------------------------------
# 資料解析
# ---------------------------------------------------------------------------
def parse_draw(draw: dict) -> dict | None:
    """將 HKJC GraphQL 回傳的單筆 draw 轉為 draw_results_verified.json 格式。"""
    year = draw.get("year")
    no = draw.get("no")
    if year is None or no is None:
        return None

    dd_str = (draw.get("drawDate") or "")[:10]  # "2026-07-16+08:00" -> "2026-07-16"
    if not dd_str:
        return None

    res = draw.get("drawResult") or {}
    main = sorted(int(x) for x in (res.get("drawnNo") or []))
    special = int(res.get("xDrawnNo")) if res.get("xDrawnNo") is not None else None

    if len(main) != 6 or special is None:
        log(f"  ⚠ {draw_no_from(year, no)} 號碼不完整，跳過")
        return None

    # 解析派彩
    prizes = _parse_prizes(draw)

    # 是否為金多寶/雪球
    is_snowball = bool(draw.get("snowballCode"))

    try:
        d = date.fromisoformat(dd_str)
        day_of_week = get_weekday_cn(d)
    except ValueError:
        day_of_week = ""

    return {
        "draw_no": draw_no_from(year, no),
        "date": dd_str,
        "day_of_week": day_of_week,
        "main_numbers": main,
        "special_number": special,
        "is_snowball": is_snowball,
        "prizes": prizes,
    }


def _parse_prizes(draw: dict) -> dict | None:
    """從 lotteryPool 抽取派彩資訊。"""
    lp = draw.get("lotteryPool") or {}
    prizes_list = lp.get("lotteryPrizes") or []
    if not prizes_list:
        return None

    ub = int(lp.get("unitBet") or 0) or 1
    tiers = {}
    for p in prizes_list:
        try:
            t = int(p.get("type"))
        except (TypeError, ValueError):
            continue
        name = TIER_MAP.get(t)
        if not name:
            continue
        wu = int(p.get("winningUnit") or 0)
        tiers[name] = {
            "amount": int(p.get("dividend") or 0),
            "winners": (wu + ub // 2) // ub if ub else wu,
        }

    if not tiers:
        return None

    # 附加獎池層級資訊
    tiers["_pool"] = {
        "status": lp.get("status"),
        "total_investment": int(lp.get("totalInvestment") or 0),
        "jackpot": int(lp.get("jackpot") or 0),
        "unit_bet": ub,
        "derived_first_prize_div": int(lp.get("derivedFirstPrizeDiv") or 0),
    }
    return tiers


# ---------------------------------------------------------------------------
# 合併與儲存
# ---------------------------------------------------------------------------
def load_existing_draws() -> dict:
    """載入現有 draw_results_verified.json，回傳 {meta, draws: list}。"""
    if not DRAWS_JSON.exists():
        return {"meta": {}, "draws": []}
    with DRAWS_JSON.open("r", encoding="utf-8") as f:
        return json.load(f)


def merge_draws(existing: dict, new_draws: list[dict]) -> tuple[list[dict], int]:
    """將新抓取的 draws 合併到現有資料中（以 draw_no 去重）。回傳 (merged_list, new_count)。"""
    existing_map = {d["draw_no"]: d for d in existing["draws"]}
    new_count = 0
    for d in new_draws:
        dn = d["draw_no"]
        if dn in existing_map:
            # 更新現有記錄（例如派彩資料補齊）
            existing_map[dn] = d
        else:
            existing_map[dn] = d
            new_count += 1
    # 按 draw_no 排序（YY/NNN 字串排序即為時間順序）
    merged = sorted(existing_map.values(), key=lambda x: x["draw_no"])
    return merged, new_count


def save_draws_json(existing: dict, merged_draws: list[dict]) -> None:
    """儲存 draw_results_verified.json。"""
    now_str = datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00")
    if "prizes_updated" not in existing["meta"]:
        existing["meta"]["prizes_updated"] = now_str

    output = {
        "meta": {
            **existing["meta"],
            "updated": now_str,
            "total_draws": len(merged_draws),
            "latest_draw": merged_draws[-1]["draw_no"] if merged_draws else "",
        },
        "draws": merged_draws,
    }
    with DRAWS_JSON.open("w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=1)
    log(f"  ✓ 已寫入 {DRAWS_JSON.relative_to(PROJECT_ROOT)}（{len(merged_draws)} 期）")


def rebuild_data_js() -> None:
    """重新生成 data/data.js（內嵌資料集）。"""
    with DRAWS_JSON.open("r", encoding="utf-8") as f:
        draws = json.load(f)
    with RECORDS_JSON.open("r", encoding="utf-8") as f:
        records = json.load(f)

    draws_str = json.dumps(draws, ensure_ascii=False, separators=(",", ":"))
    records_str = json.dumps(records, ensure_ascii=False, separators=(",", ":"))

    header = (
        "/* ============================================================\n"
        " * 香港六合彩資訊網站 — 內嵌資料集 (auto-generated by daily_update.py)\n"
        " * 請勿手動編輯;若要更新,請修改對應的 JSON 後重新執行構建腳本。\n"
        " * 用途:避免 file:// 協議下 fetch 被 CORS 阻擋,雙擊 index.html 即可瀏覽。\n"
        " * ============================================================ */\n"
        f"window.DRAWS_DATA = {draws_str};\n"
        f"window.RECORDS_DATA = {records_str};\n"
    )

    OUTPUT_JS.write_text(header, encoding="utf-8")

    raw_size = OUTPUT_JS.stat().st_size
    gz_size = len(gzip.compress(header.encode("utf-8")))
    log(f"  ✓ 已生成 {OUTPUT_JS.relative_to(PROJECT_ROOT)} "
        f"({raw_size / 1024 / 1024:.2f} MB, gzip ~{gz_size / 1024:.1f} KB)")


# ---------------------------------------------------------------------------
# 主程式
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="每日自動更新六合彩開獎資料")
    parser.add_argument("--dry-run", action="store_true", help="試執行，不寫入檔案")
    args = parser.parse_args()

    # 計算日期範圍
    today = date.today()
    start_date = today - timedelta(days=LOOKBACK_DAYS)
    start_ymd = start_date.isoformat()
    end_ymd = today.isoformat()

    log("=" * 60)
    log("香港六合彩資料每日自動更新")
    log(f"日期範圍: {start_ymd} ~ {end_ymd} (近 {LOOKBACK_DAYS} 天)")
    log(f"模式: {'DRY-RUN（不寫入）' if args.dry_run else '正式執行'}")
    log("=" * 60)

    # Step 1: 抓取最新資料
    log("Step 1/4: 從 HKJC GraphQL 抓取最新開獎資料...")
    query = load_query()
    try:
        raw_draws = fetch_latest_draws(query, start_ymd, end_ymd)
    except RuntimeError:
        log("✗ 無法連線 HKJC API，更新失敗")
        sys.exit(1)

    log(f"  取得 {len(raw_draws)} 筆原始記錄")

    # Step 2: 解析並過濾
    log("Step 2/4: 解析開獎資料...")
    new_draws = []
    for d in raw_draws:
        parsed = parse_draw(d)
        if parsed:
            new_draws.append(parsed)
            log(f"  · {parsed['draw_no']}  {parsed['date']}  "
                f"{'/'.join(str(n) for n in parsed['main_numbers'])} + {parsed['special_number']}"
                f"{' [金多寶]' if parsed['is_snowball'] else ''}")

    if not new_draws:
        log("  無有效開獎資料（可能範圍內無攪珠日），結束執行")
        sys.exit(0)  # 正常退出，非錯誤

    log(f"  解析出 {len(new_draws)} 期有效開獎結果")

    # Step 3: 合併現有資料
    log("Step 3/4: 合併至現有資料集...")
    existing = load_existing_draws()
    merged, new_count = merge_draws(existing, new_draws)

    if new_count == 0:
        log(f"  無新增期數（現有 {len(existing['draws'])} 期已是最新），結束執行")
        sys.exit(0)

    log(f"  新增 {new_count} 期 → 合計 {len(merged)} 期")

    if args.dry_run:
        log("[DRY-RUN] 跳過寫入步驟")
        sys.exit(0)

    # Step 4: 寫入 JSON 並重建 data.js
    save_draws_json(existing, merged)
    log("Step 4/4: 重新生成 data/data.js...")
    rebuild_data_js()

    log("=" * 60)
    log(f"✓ 更新完成！新增 {new_count} 期，共 {len(merged)} 期")
    log(f"  最新一期: {merged[-1]['draw_no']} ({merged[-1]['date']})")
    log("=" * 60)


if __name__ == "__main__":
    main()
