#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_prizes.py
從香港賽馬會 (HKJC) 官方 GraphQL 介面抓取六合彩各期派彩 (prize / dividend) 資訊，
並輸出為可供 mark-six-prize-table 元件直接消費的結構化資料。

資料來源：HKJC 官方 "過去攪珠結果" 頁背後的 GraphQL (APQ) 介面。
獎級對應：lotteryPrizes[].type  1=頭獎 2=二獎 3=三獎 4=四獎 5=五獎 6=六獎 7=七獎
          dividend   = 每注派彩 (HKD)
          winningUnit = 中獎注數

用法：
  python fetch_prizes.py                      # 抓 2002-01-01 ~ 2026-07-16 全段
  python fetch_prizes.py --start 2020-01-01  # 只抓指定起始日之後
  python fetch_prizes.py --no-cache           # 忽略快取強制重抓
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
QUERY_FILE = os.path.join(HERE, "marksix_query.graphql")
QUERY_WORKING = os.path.join(HERE, "scratch", "query_working.txt")
CACHE_FILE = os.path.join(HERE, "prizes_raw_cache.json")

EP = "https://info.cld.hkjc.com/graphql/base/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# type -> 中文獎級名 (與 mark-six-prize-table 元件 TIER_DEFS 對齊)
TIER_MAP = {1: "頭獎", 2: "二獎", 3: "三獎", 4: "四獎",
            5: "五獎", 6: "六獎", 7: "七獎"}


def log(msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def load_query():
    for p in (QUERY_FILE, QUERY_WORKING):
        if os.path.exists(p):
            q = open(p, encoding="utf-8").read()
            if q.strip():
                return q
    raise SystemExit("找不到 GraphQL 查詢檔 (marksix_query.graphql / scratch/query_working.txt)")


def to_draw_no(year, no):
    """API 回傳 year 為 4 位字串(如 '2002')、no 為 int；轉為 '02/024' 格式。"""
    return f"{(int(year)) % 100:02d}/{int(no):03d}"


def fetch_window(query, start_ymd, end_ymd, retries=4):
    """抓取 [start, end] 視窗內所有期次，回傳 list[draw dict]。"""
    sha = hashlib.sha256(query.encode("utf-8")).hexdigest()
    body = {
        "operationName": "marksixResult",
        "variables": {"drawType": "All", "startDate": start_ymd, "endDate": end_ymd},
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": sha}},
        "query": query,
    }
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                EP,
                data=json.dumps(body).encode("utf-8"),
                headers={"User-Agent": UA, "Content-Type": "application/json",
                          "Origin": "https://bet.hkjc.com"},
            )
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
            data = json.loads(raw.decode("utf-8", "ignore"))
            draws = (data.get("data") or {}).get("lotteryDraws") or []
            return draws
        except Exception as e:  # noqa: BLE001
            last_err = e
            log(f"  ⚠ 視窗 {start_ymd}~{end_ymd} 第 {attempt} 次失敗: {type(e).__name__}: {e}")
            time.sleep(1.5 * attempt)
    log(f"  ✗ 視窗 {start_ymd}~{end_ymd} 放棄: {last_err}")
    return []


def parse_prizes(draw):
    """從單期 draw 抽取 lotteryPool -> 結構化 prizes。"""
    lp = draw.get("lotteryPool") or {}
    if not lp or not lp.get("lotteryPrizes"):
        return None
    tiers = {}
    for p in lp["lotteryPrizes"]:
        try:
            t = int(p.get("type"))
        except (TypeError, ValueError):
            continue
        name = TIER_MAP.get(t)
        if not name:
            continue
        # 重要：HKJC API 的 winningUnit 並非「中獎注數」本身，
        # 而是「中獎注數 × unit_bet」(即中獎投注的總面值，單位 HKD)。
        # 真正的中獎注數(注數) = winningUnit / unit_bet。
        # 例：七獎 winningUnit=549696, unit_bet=10 -> 54,970 注 (合理)；
        #     若當成注數直接乘每注派彩 $40 會得 2,200 萬，遠超派彩基金。
        ub = int(lp.get("unitBet") or 0) or 1
        wu = int(p.get("winningUnit") or 0)
        tiers[name] = {
            "amount": int(p.get("dividend") or 0),
            "winners": (wu + ub // 2) // ub if ub else wu,
        }
    if not tiers:
        return None
    # 附加獎池層級資訊 (以 _ 開頭，避免與獎級 key 衝突)
    pool = {
        "_pool": {
            "status": lp.get("status"),
            "total_investment": int(lp.get("totalInvestment") or 0),
            "jackpot": int(lp.get("jackpot") or 0),
            "unit_bet": int(lp.get("unitBet") or 0),
            "derived_first_prize_div": int(lp.get("derivedFirstPrizeDiv") or 0),
        }
    }
    return {**tiers, **pool}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2002-01-01", help="起始日 YYYY-MM-DD")
    ap.add_argument("--end", default="2026-07-16", help="結束日 YYYY-MM-DD")
    ap.add_argument("--window", type=int, default=80, help="滑動視窗天數 (<=92)")
    ap.add_argument("--no-cache", action="store_true", help="忽略快取強制重抓")
    ap.add_argument("--out", default=CACHE_FILE, help="原始快取輸出路徑")
    args = ap.parse_args()

    query = load_query()

    # 載入既有快取
    cache = {}
    if not args.no_cache and os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                cache = json.load(f)
            log(f"已載入既有快取：{len(cache)} 期")
        except Exception as e:  # noqa: BLE001
            log(f"⚠ 快取讀取失敗，重新抓取：{e}")

    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    step = dt.timedelta(days=args.window)
    cur = start
    windows = 0
    new_count = 0

    log(f"開始抓取派彩：{start} ~ {end} (視窗 {args.window} 天)")
    while cur <= end:
        w_end = min(cur + step - dt.timedelta(days=1), end)
        s = cur.strftime("%Y%m%d")
        e = w_end.strftime("%Y%m%d")
        draws = fetch_window(query, s, e)
        for d in draws:
            dn = to_draw_no(d.get("year"), d.get("no"))
            prizes = parse_prizes(d)
            if prizes is None:
                continue
            if dn in cache and not args.no_cache:
                # 已有則跳過 (除非期號相同但缺獎級)
                if cache[dn].get("prizes"):
                    continue
            cache[dn] = {
                "draw_no": dn,
                "draw_date": (d.get("drawDate") or "")[:10],
                "prizes": prizes,
            }
            new_count += 1
        windows += 1
        if windows % 10 == 0:
            log(f"  進度：{cur} 已處理 {windows} 視窗 / 新抓 {new_count} 期")
        cur = w_end + dt.timedelta(days=1)
        time.sleep(0.25)  # 禮貌性延遲，避免觸發頻率限制

    # 寫入快取
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    log(f"完成：共 {len(cache)} 期派彩資料 -> {args.out} (本次新抓 {new_count} 期)")


if __name__ == "__main__":
    main()
