# 學校預約系統：專案進度表 (PROGRESS)

本文件詳實記錄「禮堂&專科教室&IPAD平板車預約系統」的開發歷程與已實作功能之進度。

---

## 📅 當前版本：v2.41.3 (2026-04-19) - Z-Index 階層修正

### 🐛 Bug Report
- **使用者回報**：在搜尋彈窗點「🔁 再預約」時：
  1. 預約彈窗開在搜尋彈窗**背後**（看不到）
  2. Toast 訊息「已套用範本到 YYYY/MM/DD」**被搜尋彈窗遮住**

### 🔍 根因分析

| 元素 | 修正前 z-index | 問題 |
| :--- | :---: | :--- |
| Toast | 2000 | 與多個彈窗同層，DOM 順序決定誰在上 |
| 預約彈窗 (modal-overlay) | 1000 | 與搜尋彈窗同層，但 DOM 順序在前→被搜尋蓋住 |
| 搜尋彈窗 | 1000 | DOM 順序在後，蓋住預約彈窗 |
| 公告彈窗 (announcement) | 2200 | 高於 toast，會蓋住所有 toast |

### ✅ Fix 內容

1. **建立統一 z-index 階層 CSS 變數**：
   ```css
   --z-modal-secondary: 1000;  /* search/history/settings */
   --z-modal-primary: 2000;    /* auth/delete/stats/dashboard */
   --z-modal-critical: 2200;   /* announcement */
   --z-help-overlay: 2500;     /* keyboard help */
   --z-tooltip: 3000;          /* in-modal tooltips */
   --z-toast: 4000;            /* Toast 必須最高 */
   --z-system-banner: 9999;    /* PWA update banner */
   ```

2. **Toast 提升至 z-index 4000**（高於所有 modal）

3. **預約彈窗提升至 z-index 1100**（高於其他 secondary modal，但低於 primary）

4. **quickRebook() 修正**：以陣列遍歷同步關閉 `historyModalOverlay` + `searchModalOverlay`

### 📂 修改檔案

- `app.js`: `quickRebook` 改用 forEach 關閉多個來源彈窗
- `styles.v2.38.0.css`: 新增 `:root` z-index 變數 + 套用到 toast 與 modal-overlay

---

## 📅 v2.41.2 (2026-04-19) - 搜尋場地過濾修正

### 🐛 Bug Report
- **使用者回報**：搜尋預約時雖然主畫面選定「三年級IPAD車」，搜尋結果卻包含「禮堂」的預約資料。
- **根因**：`executeAdvancedSearch()` 未過濾 `room` 欄位，直接回傳所有符合關鍵字/節次的預約。

### ✅ Fix 內容

- **預設行為改變**：搜尋預設「僅搜目前場地」，符合使用者直覺。
- **新增切換按鈕**：搜尋列加入「🏠 目前場地」按鈕，可切換為「🌐 全部場地」（橘色標示）。
- **結果摘要 badge**：顯示「找到 N 筆 + 🏠 三年級IPAD車」或「找到 N 筆 + 🌐 跨全部場地」。
- **舊資料相容**：無 `room` 欄位的舊預約自動視為「禮堂」（與系統其他地方一致）。
- **Toast 提示**：搜尋啟動時顯示「正在『三年級IPAD車』搜尋…」明確告知範圍。

### 📂 修改檔案

- `app.js`: `executeAdvancedSearch` 加入 room 過濾邏輯 + `renderSearchResults` 接收 scope 選項 + `initSearchEventListeners` 綁定新按鈕
- `index.html`: 搜尋列新增 `btn-search-scope` 切換按鈕
- `styles.v2.38.0.css`: +60 行（按鈕兩種狀態 + 結果 badge）

---

## 📅 v2.41.1 (2026-04-19) - PWA 版本更新通知系統

### 🆕 PWA Auto-Update Notification

- **自動偵測**：Service Worker 註冊後監聽 `updatefound` 事件，新版安裝完即觸發 banner。
- **多重觸發策略**：
  1. 頁面 `load` 時 → 檢查是否已有 waiting 中的 SW
  2. `visibilitychange` (使用者切回分頁) → 主動 `registration.update()`
  3. 定時 30 分鐘輪詢 → 即使長時間掛在背景也能收到通知
- **使用者體驗優先**：
  - 不主動 `skipWaiting()`，避免使用者填表單到一半被打斷
  - banner 樣式：右下角彩虹漸層 + 搖擺 icon + 呼吸光暈動畫
  - 提供「立即更新」與「稍後 ⏷」兩按鈕
- **更新流程**（從點擊到完成 ~2 秒）：
  1. 使用者點「立即更新」
  2. 前端 `postMessage('SKIP_WAITING')` → SW 接管
  3. `controllerchange` 事件觸發 → 自動 `location.reload()`
- **首次安裝不打擾**：判斷 `navigator.serviceWorker.controller` 是否存在，第一次裝 PWA 不顯示 banner。

### 📂 修改檔案

- `sw.js`: 移除 install 內 `skipWaiting()` + 加入 `GET_VERSION` 訊息處理
- `index.html`: 完全重寫 SW 註冊區塊（+90 行）含 update detection
- `styles.v2.38.0.css`: +160 行 banner 樣式（漸層/動畫/RWD）

### 🎨 視覺設計重點

| 元素 | 設計 |
| :--- | :--- |
| 主色 | 紫藍 → 靛紫 → 桃紅 三段漸層（與系統主題一致） |
| icon | 🆕 emoji 配合 1.4s wiggle 搖擺動畫 |
| 進場 | 從畫面底部 120% 位移滑入，0.4s cubic-bezier |
| 進場後 | 0.4s 後額外 3s 呼吸光暈，吸引注意 |
| 更新中 | icon 換成 ⏳ 旋轉，按鈕半透明，禁止互動 |

---

## 📅 v2.41.0 (2026-04-19) - 管理員實戰功能 (M.1 + M.2)

### 🎛 M.1 場地維護公告系統

- **完整 CRUD**：管理員可建立、編輯、刪除「場地公告」，含起訖日期、重要度、訊息與「鎖定預約」選項。
- **三階段重要度**：ℹ 一般 / ⚠ 注意 / 🚨 警告，UI 顏色分明（藍/黃/紅）。
- **預約彈窗 banner**：開啟該場地預約時自動顯示當前生效公告，提前告知使用者場地狀態。
- **公告鎖定機制**：勾選「鎖定預約」的公告，會在 `submitBooking` 時阻擋預約建立並提示原因。
- **管理 UI**：新增獨立的「場地公告管理」彈窗（橘色主題），含表單 + 列表 + 編輯/刪除/狀態徽章。
- **Firestore Rules**：新增 `roomAnnouncements` collection schema 驗證（read 公開、write 限管理員）。

### ✂ M.2 批次取消功能

- **批次選取模式**：歷史紀錄頁右上角新增「✓ 批次選取」切換按鈕，啟用後每筆顯示 checkbox。
- **批次工具列**：顯示「已選 N 筆」即時計數 + 全選 / 取消選取 / 🗑 批次取消。
- **二次確認**：必須輸入「確認取消 N 筆」字樣才能執行（防誤觸）。
- **權限分級**：管理員可批次刪除任意筆；一般使用者只能批次取消自己裝置 (deviceId) 的預約。
- **分批處理**：自動以每批 400 筆切片處理，避開 Firestore batch write 500 上限。
- **完成回饋**：實際處理筆數 + 自動結束批次模式 + 重新載入清單。

### 📂 修改檔案

- `firestore.rules`: +28 行（新增 `roomAnnouncements` 規則）
- `index.html`: +95 行（公告管理彈窗 + banner 區 + 批次工具列）
- `app.js`: +400 行（公告 CRUD + banner 渲染 + 批次取消邏輯 + 鎖定檢查）
- `styles.v2.38.0.css`: +330 行（公告 UI + 批次模式樣式）
- `sw.js`、`README.md`: 版本標示

### 📊 預期影響

| 場景 | 改善前 | 改善後 |
| :--- | :---: | :---: |
| 場地維護告知方式 | 口頭 / 群組訊息 | 系統 banner 自動提醒 |
| 學期末清理過期預約 | 一筆一筆刪 (10+ 分鐘) | 批次 30 秒內完成 |
| 老師預約被佔用場地 | 才知道有問題 | 開彈窗就看到公告 |

---

## 📅 v2.40.0 (2026-04-19) - UX/Perf 大躍進 (V/C 系列 7 項)

> 一次推進 7 項提案：V 系列 5 項 (預約效率微優化) + C 系列 2 項 (字型/SW 效能)。

### 🚄 V 系列 — 預約效率微優化

- **V.1 ⌨️ 鍵盤快捷鍵**: 12 組快捷鍵 (N/H/S/T/D/1/2/←→/Esc/Ctrl+Enter/?)，輸入時自動關閉避免誤觸。按 `?` 顯示說明彈窗。
- **V.2 ⭐ 常用場地置頂**: 預約成功時累積使用次數至 localStorage，自動重排下拉選單（主頁 + 彈窗），前 3 名加 ⭐ 標示。
- **V.3 🌡️ 衝突時段預警染色**: 月視圖 cell 依預約密度染色 (free/light/medium/busy/full)，右下角顯示 `n/10` 計數。
- **V.4 👁 月視圖 hover 預覽**: 滑鼠懸停顯示完整節次與借用者列表 (含理由)，手機長按 700ms 觸發。
- **V.5 ↩ 預約撤銷按鈕**: 預約成功 toast 內加入「↩ 撤銷」按鈕 + 30 秒倒數，模仿 Gmail。

### 💰 C 系列 — 成本與效能

- **C.3 🅰 字型 fallback 強化**: 擴展 system font fallback 鏈 (PingFang TC / 微軟正黑體 / system-ui)，Web Font 載入前不再空白。Google Fonts 已啟用 `display=swap`。
- **C.4 🚀 SW Stale-While-Revalidate**: 靜態資源策略升級—立即回傳快取（快），背景刷新（不錯過更新）。Firebase API 直接走網路。新增 `skipWaiting` + `clients.claim` 加速生效。

### 📂 修改檔案

- `app.js`: 新增 6 個函式 (~430 行)
  - `incrementRoomUsage`、`getRoomUsageCounts`、`sortRoomDropdownByUsage`、`resetRoomUsageSorting` (V.2)
  - `undoRecentBookings` + `showToast` 升級支援 action (V.5)
  - `initKeyboardShortcuts`、`showKeyboardHelp`、`jumpToToday`、`isTypingFocus`、`isAnyModalOpen`、`closeAllModals` (V.1)
  - `showMonthDayTooltip`、`hideMonthDayTooltip`、`ensureMonthDayTooltip` (V.4)
  - `submitBooking`: 追蹤 `createdRefs` 供撤銷用 (V.5)
  - `renderMonthCalendar`: 加入 heat-level CSS class (V.3) + hover handler (V.4)
- `styles.v2.38.0.css`: 新增 ~280 行樣式 (toast.has-action / heat-* / month-day-tooltip / keyboard-help)
- `sw.js`: 完全重寫 (43→90 行) — Stale-While-Revalidate + Firebase 直連
- `index.html`、`README.md`、`PROGRESS.md`: 版本標示

### 📊 預期影響

| 指標 | v2.39.0 | v2.40.0 後 |
| :--- | :---: | :---: |
| 高頻使用者操作步數 | 滑鼠 5+ 次 | 鍵盤 1 次 |
| 重新整理頁面看到新版速度 | 2~3 次刷新 | 1 次刷新 |
| 誤按取消的補救時間 | 30~60 秒 | 1 秒撤銷 |
| 月視圖辨識繁忙日 | 點開查看 | 一眼判斷 |
| 場地切換次數 | 平均 3 次 | 1~2 次 (常用置頂) |

---

## 📅 v2.39.0 (2026-04-19) - Quick Re-Book Feature

- **New Feature**: ⚡ **一鍵重複預約 (Quick Re-Book)** — 歷史紀錄/搜尋結果每筆右側新增 `🔁 再預約` 按鈕。
- **Smart Date Logic**: 自動計算「下個未來的同星期日期」，避免落入過去日期或同週重複。
- **UX Optimization**:
  - 點按鈕後自動關閉歷史彈窗、切換主頁場地、開啟預約彈窗並預填全欄位（場地、節次、預約者、理由）。
  - 彈窗標題顯示「🔁 快速續訂 YYYY/MM/DD」便於辨識模式。
  - 已被預約的節次保持 disabled，僅勾選可用節次。
- **Mobile RWD**: 手機端按鈕只顯示 icon，桌面端顯示「再預約」文字。
- **System**: 更新 SW cache 至 `booking-system-v2.39.0`,強制刷新前端設定。
- **Files Modified**: `app.js` (新增 `quickRebook()` + 修改 `createBookingItemHTML`)、`styles.v2.38.0.css`、`sw.js`、`index.html`、`README.md`
- **Estimated Impact**: 重複性預約(社團、固定週課)填表時間從 30 秒降至 3~5 秒。
- **Documentation Bonus**:
  - 📘 新增 [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md) — 7 項提案完整實作手冊(含程式碼範例與避雷指南)。
  - 📚 [FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) 大擴充: 12 項 → 27 項提案,含 4 條施工路徑。
- **Deployment**:
  - ✅ Commit `c2391c6` 推送至 GitHub (main branch)
  - ✅ GitHub Actions CI/CD 13 秒完成部署
  - ✅ 線上版本確認: https://cagoooo.github.io/schedule/ 已套用 v2.39.0
  - ⚠️ CI 警告: Node.js 20 將於 2026/9/16 從 runner 移除,建議 Q3 前升級 actions 版本

---

## 📅 v2.38.6 (2026-03-23) - Further Rate Limit Relaxation

- **Logic Update**: **預約頻率限制再放寬** — 將每小時預約次數提升至 **30 次**，每日次數提升至 **100 次**（v2.38.5 為 20/50，調整前舊版為 5/10）。
- **System**: 強制更新 `sw.js` 快取名稱為 `cache-v2.38.6`，徹底解決舊版瀏覽器快取殘留導致仍套用 5 次/小時限制的問題。
- **UX Pain Point Fixed**: 解決教師大量預約（如全學期重複預約、批次預約多教室）時頻繁遭觸發限流的困擾。
- **Documentation**: 同步更新 `README.md` 與 `index.html` 的版本標示，便於使用者識別。
- **Files Modified**: `app.js`、`sw.js`、`index.html`、`README.md`、`PROGRESS.md`

---

## 📅 v2.38.5 (2026-03-19) - Reservation Limit Adjustment

- **Logic Update**: **預約頻率限制首次放寬** — 將每小時預約次數從 5 次調整為 **20 次**，每日次數從 10 次調整為 **50 次**。
- **Background**: 老師反映實務上需要一次設定多週重複課程或多教室預約，原 5/10 限制過於嚴格。
- **System**: 同步更新 `sw.js` 快取版本以強制刷新前端設定。
- **Files Modified**: `app.js` (RATE_LIMIT 設定)、`sw.js`、`index.html`、`README.md`、`PROGRESS.md`

---

## 📅 v2.38.4 (2026-02-26) - Booking History & Search UI Refactor

- **UI Refactor**: **預約紀錄 UI 重構** — 統一「歷史紀錄」與「搜尋結果」的渲染邏輯。
- **Optimization**: 優化多節次標籤顯示，增加 `flex-wrap` 支援。
- **RWD Support**: 強化響應式佈局，手機版自動切換為垂直堆疊格式。

---

## 📅 v2.38.2 (2026-02-24) - UI Aesthetic & RWD Optimization

- **UI Enhancement**: **統計區塊視覺強化** — 重新設計統計彈窗標題，將場地名稱以「Badge 標籤」形式呈現，並優化標題文字的層次感與顏色鑑別度。
- **Optimization**: 加入 RWD 自動換行結構，確保長場地名稱（如 iPad 車）在手機端能正確排版。

---

## 📅 v2.38.1 (2026-02-24) - Stats Context Clarification

- **UI Enhancement**: **統計區塊明確化** — 在「預約統計」彈窗標題中加入了當前選定的專科教室顯示，避免使用者誤以為統計數據代表全校場地，提升資訊透明度。
- **System**: 更新 HTML 與 JavaScript 邏輯以支援動態標題更新。

---

## 📅 v2.38.0 (2026-02-23) - Analytics v2 & History Enhancement

- **New Feature**: **進階分析儀表板 (Analytics v2)** — 包含學期使用率熱力圖、場地排行、活躍預約者、取消率分析與預約提前天數直方圖。
- **UI Enhancement**: **歷史紀錄優化** — 在歷史紀錄列表中新增綠色場地標籤 (Room Badge)，並將舊有未指定場地的紀錄自動預設顯示為「禮堂」。
- **Optimization**: 全面採用原生 CSS 與 JavaScript 實現圖表，無外部依賴，確保載入速度與安全性。
- **System**: 更新 CSS 至 `styles.v2.38.0.css`。

---

## 📅 v2.37.6 (2026-02-23) - PWA Title Hotfix

- **Bug Fix**: 修正 PWA 安裝提示（右下角）的標題錯誤地顯示為「識生學坊」，已更正為「專科教室預約系統」。
- **Root Cause**: 開發時複製了另一個專案的 HTML 片段，導致標題文字遺留錯誤。

---

## 📅 v2.37.5 (2026-02-18) - Heatmap Visualization Fix

- **Bug Fix**: 修正「今日預約熱度」圖表，使空閒時段顯示為空白（灰色、最低高度），不再誤顯示彩色長條。
- **UI Tweaks**: 加入 `.is-empty` 狀態讓趨勢條視覺更精確。

---

## 📅 v2.37.0 (2026-02-17) - PWA UI Enhancement & History Delete

- **New Feature**: 歷史記錄加入「強制刪除」功能（管理員專用），可清除異常的殭屍預約。
- **PWA UI**: 全新 Glassmorphism 安裝提示，支援 Toast / Bottom Sheet RWD 佈局與進場動畫。
- **Bug Fix**: 修復歷史記錄的篩選邏輯（正確顯隱已取消資料）及刪除後的 UI 即時刷新問題。
- **System**: 更新 CSS 版號為 `styles.v2.37.0.css` 防止瀏覽器快取。
- **Data Export**: 新增 CSV 完整匯出與月報表生成功能。

---

## 📅 v2.36.0 (2026-02-17) - Glassmorphism Modal & User Self-Cancel

- **New Feature**: 使用者自助取消預約（裝置綁定，無需登入即可取消自己裝置的預約）。
- **UI**: 預約詳情彈窗全面改用毛玻璃特效與鮮豔漸層。

---

## 📅 v2.35.x (2026-02-15~16) - Dashboard & Validation UX

- **Dashboard**: Bento Grid 佈局儀表板，含即時場地監控、今日熱度圖、使用者排行、節次圓餅圖。
- **Validation**: 未填完整欄位時自動高亮震動並捲動跳轉，大幅降低送出失敗率。
- **Bug Fix**: 月視圖衝突檢查修復，整合資料來源解決誤判問題。
- **Feature**: 月視圖直接點擊日期即可開啟預約彈窗。

---

## 📅 v2.34.0 (2026-02-14) - RWD & Animation Premium

- **RWD**: 手機端頁首扁平化、標題自動換行、動態日期按鈕。
- **Animation**: Premium Glow 發光、標題呼吸燈、Mesh Gradient 動態漸層背景。
- **Layout**: 手機端 Compact Layout，釋放更多垂直操作空間。

---

## 📅 v2.33.x (2026-02-12~13) - AI Smart Suggestions

- **AI 功能**: 衝突偵測時自動推薦最佳替代方案（場地 / 時段），並滑動捲至建議區。
- **UX**: 改善 IPAD 平板車的推薦邏輯，支援跨推薦節次。

---

## 📅 v2.31.0 (2026-01-30) - CI/CD & Security Hardening

- **GitHub Actions**: 自動化 CI/CD 部署工作流，完整 Secrets 管理（API Key 不入庫）。
- **Security**: 強化 Firestore Rules，推動前後端分離的驗證機制。

---

## ✅ 已完成核心功能彙整表

### 🗓 預約管理

| 功能項 | 狀態 | 版本 | 備註 |
| :--- | :---: | :---: | :--- |
| 週/月視圖切換 | ✅ | v1.0.0 | 靈活檢視時段 |
| 單日多節次預約 | ✅ | v1.0.0 | 支援跨節次勾選 |
| 每週重複預約 | ✅ | v1.2.0 | 適合固定課程排程 |
| 批次預約（多選日期）| ✅ | v1.6.0 | 視覺化日曆多選 |
| 自定義不開放時段 | ✅ | v2.30.0 | 管理員可手動禁排 |
| 使用者自助取消 | ✅ | v2.36.0 | 裝置綁定，無需登入 |
| 月視圖直接預約 | ✅ | v2.35.0 | 點擊日期直開預約彈窗 |
| ⚡ 一鍵重複預約 | ✅ | v2.39.0 | 歷史/搜尋結果 → 下週同日 |
| ↩ 預約撤銷按鈕 (Gmail 風格) | ✅ | v2.40.0 | 30 秒倒數一鍵 Undo |
| ⭐ 常用場地置頂 | ✅ | v2.40.0 | localStorage 排序 + ⭐ 標示 |
| ⌨️ 鍵盤快捷鍵 | ✅ | v2.40.0 | 12 組快捷鍵 + 說明彈窗 (按 ?) |
| 🌡️ 月視圖衝突熱度染色 | ✅ | v2.40.0 | 5 階段顏色 + n/10 計數 |
| 👁 月視圖 hover 預覽 | ✅ | v2.40.0 | 完整節次與借用者列表 |
| 📢 場地維護公告系統 | ✅ | v2.41.0 | 含 banner + 鎖定預約 + 三階重要度 |
| ✂ 批次取消功能 | ✅ | v2.41.0 | 二次確認 + 分批 400 筆處理 |
| 🆕 PWA 版本更新通知 | ✅ | v2.41.1 | 自動偵測新版 + 一鍵更新 + 不打斷使用者 |

### 🔍 搜尋與統計

| 功能項 | 狀態 | 版本 | 備註 |
| :--- | :---: | :---: | :--- |
| 關鍵字與節次篩選搜尋 | ✅ | v1.5.0 | 支援姓名、時段 |
| 180 天大範圍搜尋 | ✅ | v1.8.0 | 自動擴大搜尋半徑 |
| Bento Grid 數據儀表板 | ✅ | v2.35.0 | 即時監控 + 圖表 |
| CSV 完整匯出 | ✅ | v2.37.0 | 含刪除紀錄 |
| 月報表生成 | ✅ | v2.37.0 | 一鍵產出月度報告 |
| 今日預約熱度圖 | ✅ | v2.37.5 | 修正空閒時段視覺 |

### 🤖 智慧輔助

| 功能項 | 狀態 | 版本 | 備註 |
| :--- | :---: | :---: | :--- |
| AI 衝突自動建議替代方案 | ✅ | v2.33.1 | 推薦最佳時段/場地 |
| 欄位驗證強引導 | ✅ | v2.35.1 | 高亮震動+捲動跳轉 |

### 🎨 UI/UX 視覺

| 更新項 | 狀態 | 版本 |
| :--- | :---: | :---: |
| 紫藍漸層主題色 (#667eea) | ✅ | v1.4.0 |
| 骨架屏載入動畫 | ✅ | v1.2.0 |
| Premium Glow / 呼吸燈 / Mesh Gradient | ✅ | v2.34.0 |
| RWD 手機優化（Compact Layout）| ✅ | v2.34.0 |
| Glassmorphism 儀表板 / 彈窗 | ✅ | v2.35.0 |
| PWA Glassmorphism 安裝提示 | ✅ | v2.37.0 |
| PWA 安裝標題修正 | ✅ | v2.37.6 |

### 🔐 安全與部署

| 更新項 | 狀態 | 版本 |
| :--- | :---: | :---: |
| Firebase Auth 管理員登入 | ✅ | v1.0.0 |
| Rate Limiting 節流防洗版（5/10）| ✅ | v1.3.0 |
| GitHub Actions CI/CD 自動部署 | ✅ | v2.31.0 |
| API Key Secrets 隔離管理 | ✅ | v2.31.0 |
| Firestore Security Rules 強化 | ✅ | v2.31.0 |
| Rate Limiting 放寬 (20/50) | ✅ | v2.38.5 |
| Rate Limiting 再放寬 (30/100) | ✅ | v2.38.6 |
| SW 強制快取刷新機制 | ✅ | v2.38.6 |
| SW Stale-While-Revalidate 策略 | ✅ | v2.40.0 |
| Web Font fallback 強化 | ✅ | v2.40.0 |

---

## 🎯 下個迭代目標 (Next Sprint Roadmap)

> 依據 [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md) 的施工順序，當前進度與後續規劃：

| 階段 | 提案 | 工時 | 狀態 |
| :---: | :--- | :---: | :---: |
| 🥇 速勝 1 | 1.7 一鍵重複預約 | 1~2 天 | ✅ **v2.39.0** |
| 🥇 速勝 2-8 | **V.1~V.5 + C.3 + C.4** | 7 項合計 ~5 天 | ✅ **v2.40.0** |
| 🎛 管理員 1-2 | **M.1 場地公告 + M.2 批次取消** | 5 天 | ✅ **v2.41.0** |
| 💰 效能 | C.1 IndexedDB 快取 | 3~4 天 | 🚧 v2.42.0 進行中 |
| 4 | M.3 個人化儀表板 | 3~4 天 | 🚧 v2.43.0 規劃 |
| 5 | F.3 Sentry RUM 錯誤監控 | 1~2 天 | ⏳ 待註冊 sentry.io |
| 6 | 1.8 完整稽核日誌 | 3~4 天 | ⏳ 規劃中 |
| 7 | 1.6 Web Push 瀏覽器通知 | 4~6 天 | ⏳ 規劃中 |
| 8 | F.1 Vitest + Playwright 測試 | 10~14 天 | ⏳ 規劃中 |
| 9 | F.2 漸進式 TypeScript | 14~21 天 | ⏳ 規劃中 |
| 10 | 3.3 AI 學期白皮書 | 3~4 週 | ⏳ 規劃中 |
| ⏸ | M.4 異常使用者管理 | 4~5 天 | ⛔ 依賴 QR 簽到 (3.2) |
| ⏸ | M.5 異動自動通知 | 2 天 | ⛔ 依賴 1.6 Web Push |
| ⏸ | C.2 Code Splitting | 4~5 天 | ⛔ 重構風險高，待 F.1 測試完成後 |

更多選項與創新提案見 [FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) (合計 30+ 項)。

---

## 🌐 部署狀態

- **正式站**: https://cagoooo.github.io/schedule/
- **CI/CD**: GitHub Actions (`.github/workflows/`)
- **最新部署**: v2.39.0 @ 2026-04-19 (13 秒完成)
- **Service Worker**: `booking-system-v2.39.0`
- **DB**: Firebase Firestore
- **Auth**: Firebase Authentication

---

## 📚 配套文件

| 文件 | 用途 |
| :--- | :--- |
| [PROGRESS.md](./PROGRESS.md) | 本文件 — 已完成功能進度 |
| [FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) | 57 項未來優化提案完整清單 |
| [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md) | 7 項提案的詳細實作手冊（含程式碼） |
| [DEV_REFERENCES.md](./DEV_REFERENCES.md) | 開發參考資源彙整（200+ 連結） |
| [README.md](./README.md) | 專案介紹與使用指引 |

---

> [!NOTE]
> 本文件追蹤「禮堂&專科教室&IPAD平板車預約系統」的所有已完成功能，確保對開發現況有清楚共識。
> 未來優化建議詳見 [FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) 與 [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md)。
> 開發時的官方文件連結速查請見 [DEV_REFERENCES.md](./DEV_REFERENCES.md)。
