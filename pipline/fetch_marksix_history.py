#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_marksix_history.py
========================
抓取香港六合彩 1976 ~ 2002-07-04 歷史開獎紀錄。

資料來源（多來源合併）：
  1) HKJC 官方 GraphQL (APQ) — 權威，含「開獎日期」，但數位檔案下限約為 1993-03-30。
  2) 本地 1976-2026_all_records.xlsx — 含「中獎號碼」（無日期），
     用於補齊 1976~1993 這段官方 API 無法提供的號碼。

主要功能：
  * 日期範圍篩選 (--start / --end)
  * 滑動視窗分頁抓取（繞過官方 API 最長約 90 天的範圍限制）
  * 資料格式統一（期號 YY/NNN、開獎日期 YYYY-MM-DD、號碼 int 列表）
  * 例外處理（每個視窗重試 + 錯誤收集，單一失敗不中斷整體）
  * 結構化儲存（JSON + CSV），欄位含：期號、開獎日期、中獎號碼

用法範例：
  python fetch_marksix_history.py                         # 預設 1976-01-01 ~ 2002-07-04
  python fetch_marksix_history.py --start 1993-01-01 --end 2002-07-04
  python fetch_marksix_history.py --no-xlsx               # 只取官方 API（有日期者）
  python fetch_marksix_history.py --no-cache              # 強制重新抓取
"""

import argparse
import csv
import gzip
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

# ---------------------------------------------------------------------------
# 設定
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
QUERY_FILE = os.path.join(HERE, "marksix_query.graphql")
CACHE_FILE = os.path.join(HERE, "official_draws_cache.json")
XLSX_DEFAULT = os.path.join(HERE, "..", "1976-2026_all_records.xlsx")

GRAPHQL_EP = "https://info.cld.hkjc.com/graphql/base/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# 官方 API 數位檔案下限（經實測：1993 Q1 最早為 1993/024 = 1993-03-30）
API_FLOOR = "1993-01-01"
# 滑動視窗步長（天）。官方 resolver 對過長範圍回傳 0 筆，80 天最穩。
WINDOW_DAYS = 80
# 每個視窗重試次數
MAX_RETRIES = 3
RETRY_BACKOFF = 2.0  # 秒，指數退避

# 內嵌查詢（備用；優先讀取外部 QUERY_FILE 以確保 sha256 與伺服器註冊值一致）
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
def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def ymd_to_yyyymmdd(d):
    """ 'YYYY-MM-DD' -> 'YYYYMMDD' """
    return d.replace("-", "")


def yyyymmdd_to_ymd(s):
    """ 'YYYYMMDD' -> 'YYYY-MM-DD' """
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


def parse_ymd(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def draw_no_from_year_no(year, no):
    """ (1993, 24) -> '93/024' """
    return f"{int(year) % 100:02d}/{int(no):03d}"


def load_query():
    if os.path.exists(QUERY_FILE):
        with open(QUERY_FILE, encoding="utf-8") as f:
            q = f.read()
        if q.strip():
            return q
    return EMBEDDED_QUERY


def normalize_cache_record(rec):
    """將快取中可能混用的舊 schema 統一為正規欄位。"""
    return {
        "draw_no": rec.get("draw_no"),
        "draw_date": rec.get("draw_date"),
        "year": rec.get("year"),
        "draw_no_in_year": rec.get("draw_no_in_year", rec.get("no")),
        "main_numbers": rec.get("main_numbers") or [],
        "special_number": rec.get("special_number"),
        "snowball": rec.get("snowball", ""),
        "date_source": rec.get("date_source", "hkjc_official"),
    }


# ---------------------------------------------------------------------------
# 來源 1：HKJC 官方 GraphQL (APQ)
# ---------------------------------------------------------------------------
class HkJcApiSource:
    def __init__(self):
        self.query = load_query()
        self.sha = hashlib.sha256(self.query.encode("utf-8")).hexdigest()
        self.ctx = ssl.create_default_context()
        # 官方憑證鏈在某些環境會被攔，這裡不驗證（僅用於公開開獎資料）
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE

    def _post(self, variables):
        body = {
            "operationName": "marksixResult",
            "variables": variables,
            "extensions": {"persistedQuery": {"version": 1, "sha256Hash": self.sha}},
            "query": self.query,
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            GRAPHQL_EP, data=data,
            headers={"User-Agent": UA, "Content-Type": "application/json",
                     "Origin": "https://bet.hkjc.com", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60, context=self.ctx) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8", "ignore"))

    def fetch_window(self, start_ymd, end_ymd):
        """抓取單一日期視窗；含重試與例外處理。回傳官方 draw 字典列表。"""
        variables = {
            "drawType": "All",
            "startDate": ymd_to_yyyymmdd(start_ymd),
            "endDate": ymd_to_yyyymmdd(end_ymd),
        }
        last_err = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._post(variables)
                if resp.get("errors"):
                    # 常見：超過最長範圍 -> 回傳空（非錯誤），直接回 []
                    msgs = " | ".join(e.get("message", "") for e in resp["errors"])
                    if "WHITELIST" in msgs or "PERSISTED_QUERY" in msgs:
                        raise RuntimeError(f"GraphQL error: {msgs}")
                    # 其他錯誤視為該視窗無資料
                    return []
                draws = (resp.get("data") or {}).get("lotteryDraws") or []
                return draws
            except Exception as e:  # noqa: BLE001
                last_err = e
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF * attempt)
        # 重試用盡
        raise RuntimeError(f"視窗 {start_ymd}~{end_ymd} 抓取失敗: {last_err}")

    @staticmethod
    def normalize(draw):
        """官方 draw -> 統一記錄"""
        year = str(draw.get("year"))
        no = draw.get("no")
        dd = (draw.get("drawDate") or "")[:10]  # "1993-03-30+08:00"
        res = draw.get("drawResult") or {}
        main = [int(x) for x in (res.get("drawnNo") or [])]
        special = int(res.get("xDrawnNo")) if res.get("xDrawnNo") is not None else None
        snow = draw.get("snowballName_ch") or draw.get("snowballName_en") or ""
        return {
            "draw_no": draw_no_from_year_no(year, no),
            "draw_date": dd if dd else None,
            "year": int(year) if year.isdigit() else None,
            "draw_no_in_year": int(no) if no is not None else None,
            "main_numbers": sorted(main),
            "special_number": special,
            "snowball": snow,
            "date_source": "hkjc_official",
        }


# ---------------------------------------------------------------------------
# 來源 2：本地 xlsx（號碼，無日期）
# ---------------------------------------------------------------------------
class LocalXlsxSource:
    def __init__(self, path):
        self.path = path
        self.records = {}
        if path and os.path.exists(path):
            self._load()

    def _load(self):
        import openpyxl
        wb = openpyxl.load_workbook(self.path, read_only=True, data_only=True)
        ws = wb.active
        for row in ws.iter_rows(values_only=True):
            if not row or row[0] in (None, "年份"):
                continue
            try:
                year = int(row[0])
                no = int(row[1])
                nums = [int(x) for x in row[2:8] if x is not None]
                special = int(row[8]) if len(row) > 8 and row[8] is not None else None
            except (TypeError, ValueError):
                continue
            self.records[draw_no_from_year_no(year, no)] = {
                "draw_no": draw_no_from_year_no(year, no),
                "draw_date": None,
                "year": year,
                "draw_no_in_year": no,
                "main_numbers": sorted(nums),
                "special_number": special,
                "snowball": "",
                "date_source": "unavailable",
            }


# ---------------------------------------------------------------------------
# 分頁抓取 + 合併
# ---------------------------------------------------------------------------
def fetch_range(api, start_ymd, end_ymd, cache, use_cache=True):
    """滑動視窗抓取 [start, end]；回傳 {draw_no: 統一記錄}（僅官方來源）。"""
    start = parse_ymd(start_ymd)
    end = parse_ymd(end_ymd)
    # 官方 API 下限保護：早於下限的視窗直接跳過（必為空）
    eff_start = max(start, parse_ymd(API_FLOOR))
    out = {}
    # 先從快取帶入範圍內已抓取過的記錄（例如 2002-2026），避免重抓且確保不漏
    if use_cache:
        for rec in cache.values():
            dd = rec.get("draw_date")
            if dd and start <= parse_ymd(dd) <= end:
                out[rec["draw_no"]] = rec

    cur = eff_start
    windows = 0
    while cur <= end:
        nxt = min(cur + timedelta(days=WINDOW_DAYS - 1), end)
        s = cur.strftime("%Y-%m-%d")
        e = nxt.strftime("%Y-%m-%d")
        # 快取判斷：若快取中已有此日期區間的資料則略過
        if use_cache and cache_covers(cache, s, e):
            cur = nxt + timedelta(days=1)
            windows += 1
            continue
        try:
            draws = api.fetch_window(s, e)
            for d in draws:
                rec = api.normalize(d)
                if rec["draw_date"] and parse_ymd(rec["draw_date"]) < start:
                    continue
                if rec["draw_date"] and parse_ymd(rec["draw_date"]) > end:
                    continue
                out[rec["draw_no"]] = rec
                cache[rec["draw_no"]] = rec
            log(f"視窗 {s}~{e}: +{len(draws)} 期 (累計 {len(out)})")
        except Exception as ex:  # noqa: BLE001
            log(f"⚠ 視窗 {s}~{e} 失敗（已跳過）: {ex}")
        cur = nxt + timedelta(days=1)
        windows += 1
        time.sleep(0.2)  # 禮貌性延遲
    log(f"分頁完成：共 {windows} 個視窗")
    return out


def cache_covers(cache, s, e):
    """粗略判斷快取是否已涵蓋該視窗（避免重抓）。"""
    for rec in cache.values():
        dd = rec.get("draw_date")
        if dd and s <= dd <= e:
            return True
    return False


def merge(api_records, xlsx, start_ymd, end_ymd):
    """合併官方(有日期) 與 本地xlsx(補號碼)。回傳排序後的統一記錄列表。"""
    start = parse_ymd(start_ymd)
    end = parse_ymd(end_ymd)
    merged = {}

    # 1) 官方記錄（含日期，優先）
    for dn, rec in api_records.items():
        merged[dn] = rec

    # 2) 本地 xlsx：補齊官方沒有日期的期次
    #    規則：year<2002 全部納入（必在範圍內）；year==2002 僅納入官方已涵蓋者
    for dn, rec in xlsx.records.items():
        if dn in merged:
            # 雙來源都存在：以官方號碼為準，並做交叉驗證標記
            if merged[dn]["main_numbers"] != rec["main_numbers"] or \
               merged[dn]["special_number"] != rec["special_number"]:
                merged[dn]["number_mismatch"] = True
                merged[dn]["xlsx_numbers"] = rec["main_numbers"]
                merged[dn]["xlsx_special"] = rec["special_number"]
            continue
        if rec["year"] is None:
            continue
        if rec["year"] < 2002:
            merged[dn] = rec
        elif rec["year"] == 2002:
            # 僅當該 2002 期落在 end 之前且官方有紀錄才算在範圍（此分支通常不會觸發）
            pass

    # 3) 過濾範圍
    result = []
    for dn, rec in merged.items():
        dd = rec.get("draw_date")
        if dd:
            d = parse_ymd(dd)
            if not (start <= d <= end):
                continue
        else:
            # 無日期：依 year 判斷（year<2002 全部在 1976-2002 範圍內）
            if rec["year"] is None or rec["year"] >= 2002:
                continue
            if rec["year"] < start.year:
                continue
        result.append(rec)

    result.sort(key=lambda r: (r.get("year") or 0, r.get("draw_no_in_year") or 0))
    return result


# ---------------------------------------------------------------------------
# 輸出
# ---------------------------------------------------------------------------
def write_json(records, path, meta):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "records": records}, f, ensure_ascii=False, indent=2)


def write_csv(records, path):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["draw_no", "draw_date", "year", "draw_no_in_year",
                    "main_numbers", "special_number", "snowball", "date_source"])
        for r in records:
            w.writerow([
                r["draw_no"], r.get("draw_date") or "",
                r.get("year") or "", r.get("draw_no_in_year") or "",
                " ".join(str(x) for x in r["main_numbers"]),
                r.get("special_number") if r.get("special_number") is not None else "",
                r.get("snowball") or "",
                r.get("date_source") or "",
            ])


# ---------------------------------------------------------------------------
# 主程式
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="抓取香港六合彩歷史開獎紀錄 (1976-2002)")
    ap.add_argument("--start", default="1976-01-01", help="起始日期 YYYY-MM-DD")
    ap.add_argument("--end", default="2002-07-04", help="結束日期 YYYY-MM-DD")
    ap.add_argument("--xlsx", default=XLSX_DEFAULT, help="本地號碼來源 xlsx 路徑")
    ap.add_argument("--out-json", default=os.path.join(HERE, "marksix_history_1976_2002.json"))
    ap.add_argument("--out-csv", default=os.path.join(HERE, "marksix_history_1976_2002.csv"))
    ap.add_argument("--cache", default=CACHE_FILE, help="官方資料快取檔")
    ap.add_argument("--no-cache", action="store_true", help="忽略快取並強制重新抓取")
    ap.add_argument("--no-xlsx", action="store_true", help="不使用本地 xlsx 補齊號碼")
    args = ap.parse_args()

    # 載入快取
    cache = {}
    if not args.no_cache and os.path.exists(args.cache):
        try:
            with open(args.cache, encoding="utf-8") as f:
                raw_cache = json.load(f)
            for dn, rec in raw_cache.items():
                cache[dn] = normalize_cache_record(rec)
            log(f"已載入快取：{len(cache)} 期")
        except Exception as e:  # noqa: BLE001
            log(f"⚠ 快取讀取失敗，重新抓取：{e}")

    # 來源 1：官方 API
    api = HkJcApiSource()
    log(f"開始抓取官方 API：{args.start} ~ {args.end}")
    api_records = fetch_range(api, args.start, args.end, cache, use_cache=not args.no_cache)

    # 儲存快取
    try:
        with open(args.cache, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
        log(f"快取已更新：{len(cache)} 期 -> {args.cache}")
    except Exception as e:  # noqa: BLE001
        log(f"⚠ 快取寫入失敗：{e}")

    # 來源 2：本地 xlsx
    xlsx = LocalXlsxSource(None if args.no_xlsx else args.xlsx)
    if not args.no_xlsx:
        log(f"本地號碼來源：{len(xlsx.records)} 期（{args.xlsx}）")

    # 合併
    records = merge(api_records, xlsx, args.start, args.end)
    log(f"合併後共 {len(records)} 期")

    # 統計
    with_date = sum(1 for r in records if r.get("draw_date"))
    no_date = len(records) - with_date
    mismatches = sum(1 for r in records if r.get("number_mismatch"))
    meta = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "range_start": args.start,
        "range_end": args.end,
        "total_records": len(records),
        "with_date": with_date,
        "without_date": no_date,
        "number_mismatches_vs_xlsx": mismatches,
        "api_floor": API_FLOOR,
        "sources": {
            "hkjc_official_api": "https://info.cld.hkjc.com/graphql/base/",
            "local_xlsx": (args.xlsx if not args.no_xlsx else None),
        },
        "note": ("1976~1993-01-04 之開獎日期在公開網路上無數位檔案（HKJC 官方 API 之數位化下限為 1993-01-05）；"
                 "此段僅提供本地 xlsx 之中獎號碼，date_source=unavailable。"),
    }

    write_json(records, args.out_json, meta)
    write_csv(records, args.out_csv)
    log(f"已輸出 JSON -> {args.out_json}")
    log(f"已輸出 CSV  -> {args.out_csv}")
    log(f"摘要：有日期 {with_date} 期 / 無日期(僅號碼) {no_date} 期 / 號碼不符 {mismatches} 期")
    if no_date:
        log(f"⚠ 有 {no_date} 期無官方開獎日期（1976~1993 歷史缺口），詳見 meta.note")


if __name__ == "__main__":
    main()
