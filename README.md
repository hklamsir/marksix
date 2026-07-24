# 香港六合彩資訊網 | Mark Six Information

> 一站式的香港六合彩（Mark Six）資訊平台 —— 開獎結果、歷史記錄、中獎比對、投注計算、統計分析與號碼篩選，全部在瀏覽器本地運算完成，免後端、免資料庫。

---

## 目錄

- [專案簡介與功能說明](#專案簡介與功能說明)
- [技術架構與環境需求](#技術架構與環境需求)
- [安裝步驟與本機執行方式](#安裝步驟與本機執行方式)
- [使用說明](#使用說明)
- [專案目錄結構](#專案目錄結構)
- [資料更新管線](#資料更新管線)
- [部署到 GitHub Pages](#部署到-github-pages)
- [貢獻指南](#貢獻指南)
- [授權資訊](#授權資訊)
- [免責聲明](#免責聲明)

---

## 專案簡介與功能說明

本專案是一個**純靜態**的香港六合彩資訊網站。所有開獎資料預先打包進 `data/data.js`，於瀏覽器端直接渲染與運算，因此：

- 不需要任何後端伺服器或資料庫。
- 直接**雙擊 `index.html`** 即可離線瀏覽（採用 `window` 全局變數內嵌資料，避開 `file://` 協議下的 CORS 限制）。
- 亦可部署到任意靜態主機（GitHub Pages、Netlify、Cloudflare Pages 等）。

### 功能模組

| 模組 | 名稱 | 說明 |
| --- | --- | --- |
| 🎯 |  **最新結果**  | 顯示最近一期攪珠的 6 個正選號碼、特別號碼與完整派彩明細（各獎項獎金與中獎注數）。 |
| 📋 |  **歷史記錄**  | 瀏覽 1976 年至今的所有開獎結果，支援按期數／日期搜尋、年份篩選與欄位排序。 |
| 📖 |  **玩法指南**  | 說明單式、複式、膽拖等投注方式，以及一至七獎的中獎條件與派彩機制、金多寶與多寶獎金。 |
| 🔍 |  **中獎比對**  | 輸入你的 6 個選號，即時比對最新開獎結果，判斷中獎等級與對應獎金。 |
| 🧮 |  **投注計算**  | 依單式／複式／膽拖與所選號碼數量，自動計算所需注數與投注金額（每注 HK$10）。 |
| 📊 |  **統計分析**  | 號碼頻率、奇偶比例、大小號碼、號碼總和、連號、跨度、AC 值、遺漏值、除三餘數（路公碼）等圖表化統計。 |
| 🎲 |  **號碼篩選**  | 依排除號碼、奇偶／大小比例、總和範圍、出現頻率、相隔期數、AC 值、除三餘數等條件，隨機抽樣篩選符合條件的號碼組合。 |

### 資料涵蓋範圍

- **49 號碼時代（2002–至今）**：約 3,300+ 期，含完整派彩資料，來源經香港賽馬會（HKJC）官方開獎公告核實。
- **早期時代（1976–2002）**：約 2,690+ 期歷史中獎號碼。其中 1976–1993 年 1 月前的開獎日期在公開網路上無數位檔案（HKJC 官方 API 數位化下限為 1993-01-05），該段僅提供號碼、日期標記為 `unavailable`。

> 資料來源：香港賽馬會官方網站（[bet.hkjc.com/marksix](https://bet.hkjc.com/marksix/)）及其 GraphQL 介面。

---

## 技術架構與環境需求

### 架構概覽

```
┌─────────────────────────────────────────────┐
│                  瀏覽器 (前端)                │
│  index.html + css/style.css                  │
│       │                                       │
│       ├── js/app.js        （資料處理/互動）  │
│       ├── js/vendor/chart.umd.min.js (圖表)   │
│       └── data/data.js     （內嵌資料集）     │
│              ▲ 由 pipline/ 腳本自動生成        │
└──────────────┬──────────────────────────────┘
               │ 每日自動更新
       .github/workflows/daily-update.yml
               │
       HKJC 官方 GraphQL API（抓取最新開獎/派彩）
```

### 前端技術

| 項目 | 說明 |
| --- | --- |
| 語言 | 原生 HTML5 + CSS3 + Vanilla JavaScript（無框架、無打包工具） |
| 圖表 | [Chart.js](https://www.chartjs.org/)（已本地化於 `js/vendor/`，無外部 CDN 依賴） |
| 資料載入 | `data/data.js` 以 `window.DRAWS_DATA` / `window.RECORDS_DATA` 全域變數內嵌，無 `fetch` 依賴 |
| 相容性 | 任何現代瀏覽器（Chrome / Edge / Firefox / Safari）；支援手機版響應式排版 |

### 後端 / 自動化

| 項目 | 說明 |
| --- | --- |
| 資料管線 | Python 3.12+ 腳本（標準函式庫 + `openpyxl`） |
| 自動更新 | GitHub Actions（每日 23:00 HKT 自動抓取最新資料並提交） |
| 外部依賴 | HKJC 官方 GraphQL：`https://info.cld.hkjc.com/graphql/base/` |

### 環境需求

| 用途 | 需求 |
| --- | --- |
| 僅瀏覽網站 | 一個現代瀏覽器即可（**無需安裝任何東西**） |
| 本機執行開發伺服器 | 任意可跑靜態檔案的 HTTP server（如 Python 內建 `http.server`） |
| 執行資料管線 / 自動更新 | Python 3.12 或以上 |

---

## 安裝步驟與本機執行方式

### 方式一：直接開啟（最簡單）

1. 下載或 `git clone` 本倉庫。
2. 直接**雙擊 `index.html`**，即可在瀏覽器中離線瀏覽全部功能。

> 因資料已內嵌於 `data/data.js`，此方式完全不需要 HTTP 伺服器。

### 方式二：透過本機 HTTP 伺服器（推薦開發用）

若你想用 `http://` 方式瀏覽（例如測試 GitHub Pages 行為）：

```bash
# 在專案根目錄執行
python -m http.server 8000
# 然後瀏覽 http://localhost:8000
```

或使用 Python 3.12 以上版本：

```bash
python3 -m http.server 8000
```

### 方式三：執行資料管線（更新開獎資料時）

若需手動重新抓取或重建資料集，請先安裝 Python 依賴：

```bash
pip install -r requirements.txt
```

> `requirements.txt` 目前僅含 `openpyxl`（處理 Excel 來源用），其餘皆為 Python 標準函式庫，無須額外安裝。

---

## 使用說明

網站頂部為導覽列，包含七個功能頁籤，點擊即可切換：

1. **最新結果** — 開啟即顯示最近一期開獎與派彩明細。
2. **歷史記錄** — 在搜尋框輸入期數（如 `26/077`）或日期（如 `2026-07-16`）快速定位；下拉選單可篩選年份；點擊表頭欄位可排序。
3. **玩法指南** — 靜態說明頁面，介紹各種投注方式與中獎規則。
4. **中獎比對** — 點選 6 個號碼後按「比對中獎」，系統會與最新開獎結果比對並顯示中獎等級。
5. **投注計算** — 選擇「單式／複式／膽拖」，設定號碼數量後按「計算金額」，自動算出注數與總投注額。
6. **統計分析** — 切換到該頁時自動計算並繪製多張統計圖表（號碼頻率、奇偶、大小、總和、連號、跨度、AC 值、遺漏值、除三餘數等）。
7. **號碼篩選** — 於左側設定各項篩選條件，按「開始篩選」隨機抽樣出符合條件的號碼組合。

> 提示：所有計算均在你的瀏覽器本地完成，資料不會上傳到任何伺服器。

---

## 專案目錄結構

```
website-marksix/
├── index.html                      # 網站首頁（含 7 大功能模組標記）
├── css/
│   └── style.css                   # 樣式表（響應式、主題變數）
├── js/
│   ├── app.js                      # 前端主程式（資料處理、互動邏輯、圖表繪製）
│   └── vendor/
│       └── chart.umd.min.js        # Chart.js（統計圖表，已本地化）
├── data/
│   ├── data.js                     # 內嵌資料集（自動生成，請勿手動編輯）
│   ├── draw_results_verified.json  # 2002–至今開獎資料（含派彩，已核實）
│   └── draw_results_1976_2002.json # 1976–2002 歷史開獎紀錄（靜態）
├── pipline/                        # 資料抓取與更新腳本（Python）
│   ├── fetch_marksix_history.py    # 抓取歷史開獎資料
│   ├── fetch_prizes.py             # 從 HKJC GraphQL 抓取各期派彩
│   ├── daily_update.py             # 每日自動更新腳本（GitHub Actions 呼叫）
│   ├── build_data_js.py            # 將 JSON 打包成 data.js
│   └──marksix_query.graphql       # 共用 GraphQL 查詢
├── images/
│   └── logo.svg                    # 網站 Logo
├── favicon.svg                     # 瀏覽器標籤圖示
├── .github/
│   └── workflows/
│       └── daily-update.yml        # GitHub Actions 每日自動更新工作流程
└── requirements.txt                # Python 依賴（openpyxl）
```

---

## 資料更新管線

資料更新流程如下，通常由 GitHub Actions 自動執行，亦可手動執行：

```bash
# 1. 抓取/更新開獎與派彩資料（可選 --start 指定起始日、--no-cache 強制重抓）
python pipline/fetch_prizes.py
python pipline/fetch_marksix_history.py

# 2. 將 JSON 打包成內嵌的 data.js（網站實際讀取的資料來源）
python pipline/build_data_js.py

# 3. 一鍵執行「抓取近 30 天 → 合併 → 重建 data.js」（GitHub Actions 使用）
python pipline/daily_update.py

#    試執行（不寫入檔案）
python pipline/daily_update.py --dry-run

#    檢查 data.js 是否比 JSON 陳舊
python pipline/build_data_js.py --check
```

### 自動化更新（GitHub Actions）

`.github/workflows/daily-update.yml` 會在**每日 23:00 HKT（UTC 15:00）**自動執行 `daily_update.py`：

- 僅抓取近 30 天的開獎資料，並以期數（`draw_no`）去重，安全冪等。
- 僅更新 `data/draw_results_verified.json` 與 `data/data.js`（49 號碼時代）；1976–2002 歷史資料為靜態，不更新。
- 若有新資料，自動 commit 並 push 回倉庫。
- 若執行失敗，自動建立標籤為 `auto-update-failure` 的 GitHub Issue 通知。

> ⚠️ 注意：`data/data.js` 與 `data/draw_results_verified.json` 在 `git pull` 時可能發生合併衝突（GitHub Actions 自動更新 vs 本地修正）。若遇衝突，可保留本地版本：`git checkout --ours data/data.js`，再依修正後的 parser 重新抓取。

---

## 部署到 GitHub Pages

由於本網站是純靜態網站，部署非常簡單：

1. 將本倉庫推送至 GitHub。
2. 在倉庫 **Settings → Pages** 中，將 Source 設為 `Deploy from a branch`，分支選擇 `main`（或 `master`），資料夾選 `/(root)`。
3. 儲存後，GitHub 會自動發佈，網址為 `https://<你的帳號>.github.io/<倉庫名>/`。

> 若需每日自動更新資料，請同時啟用上方的 GitHub Actions 工作流程（預設已包含在 `.github/workflows/` 中，推送後即生效）。

---

## 貢獻指南

歡迎任何形式的貢獻！請遵循以下流程：

1. **Fork** 本倉庫並建立你的分支：
   ```bash
   git checkout -b feat/your-feature
   ```
2. **開發**與**測試**：
   - 前端修改請直接編輯 `index.html`、`css/style.css`、`js/app.js`。
   - 若修改資料管線，請於本機執行對應腳本驗證，並確認 `python pipline/build_data_js.py --check` 通過。
3. **提交**變更（建議使用清楚的中文或英文 commit message）：
   ```bash
   git commit -m "feat: 新增 XXX 功能"
   ```
4. 推送分支並發起 **Pull Request**，描述你做了什麼與為什麼。

### 開發注意事項

- ❗ **請勿手動編輯 `data/data.js`** —— 它是自動生成的，請改動對應的 JSON 後執行 `build_data_js.py`。
- 資料管線腳本僅依賴 Python 標準函式庫與 `openpyxl`，請勿引入額重依賴。
- 提交前請確認網站在瀏覽器中正常運作（含手機版排版）。

---

## 授權資訊

本專案採用 **MIT License** 授權，詳見倉庫根目錄的 [`LICENSE`](./LICENSE) 檔案。

```text
MIT License

Copyright (c) 2026 香港六合彩資訊網 (Mark Six Information)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software...
```

> 在 MIT 授權下，你可以自由使用、複製、修改與散佈本專案，唯須保留原始著作權與授權聲明。

---

## 免責聲明

本網站僅供**資訊參考與研究**之用，不構成任何投注建議。所有開獎與派彩資料以[香港賽馬會](https://bet.hkjc.com/marksix/)官方公布為準。請理性投注，量力而為。
