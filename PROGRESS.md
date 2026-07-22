# 學校預約系統：專案進度表 (PROGRESS)

本文件詳實記錄「禮堂&專科教室&IPAD平板車預約系統」的開發歷程與已實作功能之進度。

---

## 📅 當前版本：v2.51.1 (2026-07-22) - 🛡 F.3 Sentry 前端錯誤監控上線 (P0-3)

### 🎯 優化核心
接入 Sentry 前端錯誤監控 — roadmap 放了三個月的長期第一名（F.3）。從此老師端發生的 JS 錯誤會自動上報到 Sentry 後台，不再依賴老師口頭回報「怪怪的」。開學人流高峰前的最後一道保險。

### 📦 實作內容
1. **Sentry 專案**：組織 `smes`（school Gmail 帳號）、專案 slug `schedule`、平台 Browser JavaScript。
2. **Loader Script 整合**（[index.html](file:///h:/schedule/index.html) `<head>` 最前）：
   - 使用官方 Loader（`js.sentry-cdn.com/1f8c...min.js`），非同步載入不拖慢首屏；SDK 版本自動保持最新。
   - **純錯誤監控模式**：後台 Loader 設定已關閉 Tracing / Session Replay / Logs & Metrics / User Feedback，只上報錯誤 — 節省免費額度（5,000 events/月）並避免側錄畫面的個資疑慮。
3. **`window.sentryOnLoad` 設定**：
   - `release: 'v2.51.1'` 版本標記（每次發版需同步 bump，可對照哪版引入的錯誤）。
   - `environment`：github.io = production，其他（本機開發）= development。
   - `ignoreErrors` 噪音過濾：ResizeObserver、chrome-extension（v2.41.4 教訓）、離線 fetch 失敗等。
4. **端到端驗證**：本地丟測試錯誤 → Sentry 後台 25 秒內收到 issue `SCHEDULE-1` ✓。
5. **SW 版本**：升級 **v2.51.1**，部署後自動彈出更新提示。

### 📌 維運備忘
- Sentry 後台：https://smes.sentry.io/issues/（用 ipad@mail2.smes.tyc.edu.tw 登入）
- 每週半小時例行檢查清單（FUTURE_PROPOSAL）中的「開 Sentry 看本週新錯誤」現在正式可執行。
- 高優先錯誤會寄 email 通知（建立專案時選的預設告警）。

---

## 📅 v2.51.0 (2026-07-22) - 🗄 L 系列資料生命週期：匯出區間選擇、學期封存匯出、學期感知預設區間

### 🎯 優化核心
八月新學期前的資料治理套件（P0-1 / P0-2 / P0-4 / P0-5 一次交付）。根治系統僅存的全庫掃描點（CSV 匯出），新增「學期封存匯出」讓管理員每學年一鍵備份，並讓歷史查詢與統計以台灣學制學期為預設區間。

### 📦 新增與修改項目
1. **台灣學制學期區間工具 (L.3)**：
   - [app.js](file:///h:/schedule/app.js) 新增 `getSemesterRange(offset)` 與 `getSchoolYearRange()`：上學期 8/1~翌年 1/31、下學期 2/1~7/31，自動換算民國學年標籤（如「114學年下學期」），offset 可回推任意學期。
2. **CSV 匯出區間選擇彈窗 (L.2 / P0-1)**：
   - 「匯出 CSV」按鈕改開啟區間選擇彈窗：**本學期（預設）／上學期／本學年／全部歷史／自訂區間** 五種 chips。
   - 有區間時查詢帶 `date >=/<=` 條件走索引，**不再掃描整個資料庫**；起日晚於迄日會即時提示。
3. **學期封存匯出 (L.1 / P0-2)**：
   - 彈窗內新增「📦 學期封存匯出」：一次下載 **CSV + JSON 雙檔案**。
   - JSON 內含統計摘要（totalBookings / totalPeriods / byRoom / byMonth 逐月分布）+ 完整原始資料，作為學期結束的永久備份。**只匯出、不刪除任何資料。**
4. **歷史查詢學期快速鍵 (L.3 / P0-4)**：
   - 歷史彈窗新增「本學期／上學期／本學年」chips，一鍵載入整學期紀錄；`loadHistoryData` 支援區間覆寫，原月份選擇器保留為自訂用途。
5. **統計預設鎖本學期 (L.3 / P0-4)**：
   - 統計彈窗新增「本學期（預設）／上學期／近一年」區間 chips；查詢由「近 365 天」改為預設本學期起訖（雙邊界），跨學期資料不再互相干擾。
6. **資料保留政策 SOP (L.4 / P0-5)**：
   - 新增 [DATA_RETENTION.md](file:///h:/schedule/DATA_RETENTION.md)：保留 3 學年 → 每年 7 月底封存匯出 → 確認備份才可清理的年度 SOP，含封存 JSON 格式說明與個資注意事項。
7. **樣式**：[styles.v2.50.0.css](file:///h:/schedule/styles.v2.50.0.css) 與 [styles.css](file:///h:/schedule/styles.css) 新增 `.range-chip`、匯出彈窗、學期 chips 全套樣式（使用 `--primary-color` 等既有 design tokens + fallback）。
8. **SW 版本**：[sw.js](file:///h:/schedule/sw.js) 與 [index.html](file:///h:/schedule/index.html) 升級 **v2.51.0**，部署後自動彈出更新提示。

### ✅ 實測驗證（live Firestore）
- 學期換算：2026/07/22 → 114學年下學期 (2026/02/01~2026/07/31)、offset ±1 與全學年皆正確。
- 匯出彈窗：五種 chips 切換、自訂區間顯示/驗證（起>迄擋下）、遮罩關閉皆通過。
- 統計：預設本學期實際查得禮堂 99 筆；切「上學期」該場地 0 筆時正確提示「該場地在此區間沒有預約資料」。

---

## 🩺 2026-07-22 新學期資料健檢（維運紀錄，無程式變更）

### 🎯 背景
八月新學期將至，使用者提問「是否需要封存上半年的預約紀錄，以免舊資料拖慢新學期的預約登記與查詢」。經完整程式碼與索引稽核後，**結論：不需要任何封存動作，系統天生不受歷史資料量影響**。

### 🔍 稽核結果
1. **所有日常查詢皆有日期範圍限制**：[app.js](file:///h:/schedule/app.js) 中週視圖、月視圖、衝突檢查、統計等查詢全部帶 `.where('date', '>=', ...)` + `.where('date', '<=', ...)`（且多數再加 `room` 條件），新學期畫面只會載入當前區間資料，舊資料完全不會被讀取。
2. **複合索引已就位**：[firestore.indexes.json](file:///h:/schedule/firestore.indexes.json) 已有 `bookings (room ASC, date ASC)` 複合索引，完美對應日常查詢型態。Firestore 查詢速度只與「本次撈出的筆數」有關，與資料庫總筆數無關 —— 存 1 千筆或 10 萬筆，開同一天速度相同。
3. **統計已限一年**：v2.50.8 的 `loadStatsData` 已限制只抓最近 365 天，統計不會隨歷史增長變慢。
4. **僅存的兩個全庫掃描點**（皆為管理員主動觸發，不影響日常）：
   - `exportToCSV()`（[app.js:2638](file:///h:/schedule/app.js#L2638)）：`orderBy('date','desc')` 撈全部 → 資料越多匯出越久（秒級，可接受）。
   - 管理員歷史查詢若指定超大區間。

### ✅ 決議
- **不封存、不刪除、不需任何管理員操作**，未來一年（含往後數年）預約與查詢皆維持順暢。
- 舊資料保留於 `bookings`，供歷史統計、稽核與 CSV 匯出隨時調閱。
- 衍生的改良方向（學期封存匯出精靈、CSV 區間匯出等）已列入 [FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) 新增的 **L 系列（資料生命週期）** 提案。

---

## 📅 v2.50.8 (2026-06-23) - ⚡ 預快取秒切換場地 & PWA 檢查與強制更新

### 🎯 優化核心
解決切換不同專科教室時載入週視圖會有一瞬間閃爍與延遲（呈現 Skeleton 骨架屏）的問題。我們在前端實作了智慧預載快取與記憶體快取系統，實現 0 毫秒無縫場地切換。同時，在右下角版本號膠囊旁新增手動檢查更新的「🔄」按鈕，並設計了「連點 5 次強制清除快取重載」的管理員除錯機制，最後將 `room` 設為寫入與更新必填以防範未來垃圾數據。

### 📦 優化與修改項目
1. **0毫秒秒開場地與記憶體快取**：
   - [app.js](file:///h:/schedule/app.js) 建立全域的 `bookingsCache` (週視圖) 與 `monthBookingsCache` (月視圖) 快取。
   - `loadBookingsFromFirebase` 與 `loadMonthBookings` 在快取命中時**跳過渲染骨架屏**，直接以快取數據重新繪製日曆，大幅消弭載入等待感與閃爍感。
2. **Idle 異步背景預加載 (Prefetching)**：
   - 前端在主畫面加載完畢 2.5 秒後（閒置狀態下），默默在背景遍歷其他所有場地（電腦教室、iPad車等）並下載其當週預約進行快取，讓切換發生前就備齊資料。
3. **快取即時更新與失效 (Cache Invalidation)**：
   - 當使用者新增預約、刪除、或取消時，前端自動傳入 `forceRefresh = true` 參數以清空快取，確保資料絕對即時，防範快取髒數據。
4. **PWA 手動更新與連點 5 次強刷快取**：
   - [index.html](file:///h:/schedule/index.html) 的底部 `design-stamp` 膠囊更新為 `v2.50.8`，並加入版本號更新與 `btnForceCheckUpdate` (🔄) 按鈕。
   - 點擊按鈕手動調用 `registration.update()`，如果無新版提示「目前已是最新版本」。
   - **除錯彩蛋**：2 秒內快速連點該按鈕 5 次，將觸發 `caches.delete()` 清理瀏覽器所有的 SW 本地快取並強刷網頁，方便破版時自救。
5. **數據防呆與寫入約束 (Data Schema Enforcement)**：
   - 修改 [firestore.rules](file:///h:/schedule/firestore.rules)，在驗證規則中把 `room` 設為必填。
   - [app.js](file:///h:/schedule/app.js) 的預約提交邏輯加入 `room` 必填與高亮提示。
6. **統計分析限時加載 (Stats Limit)**：
   - 修改 `loadStatsData`，限制統計資料只抓取最近 365 天內 (一年內) 的預約，防止歷史數據增長引起的讀取效能下降。

---

## 📅 v2.50.7 (2026-06-23) - ⚡ Firestore 查詢載入優化 & 標題點擊回首頁

### 🎯 優化核心
解決使用者反映的「每次第一次進來看到一周借用畫面都會讀很久」的問題，將載入方式從原本的「前端下載全部資料後過濾」改為「在 Firestore 資料庫端直接利用 `room` 複合索引精準查詢」。同時，應使用者要求，新增大標題點擊快速回到首頁（重設狀態）的功能，並發佈 SW 更新通知。

### 📦 優化與修改項目
1. **資料庫遷移（一次性）**：
   - 掃描 `bookings` 集合中全部 615 筆歷史預約，揪出 27 筆早期缺失 `room` 欄位的舊資料。
   - 執行腳本將這 27 筆舊預約補全為 `room: '禮堂'`。目前資料庫中缺失 `room` 的預約數降為 **0**。
2. **Firestore 查詢代碼優化 ([app.js](file:///h:/schedule/app.js))**：
   - `loadBookingsFromFirebase` (週視圖)：查詢加入 `.where('room', '==', room)`。
   - `loadMonthBookings` (月視圖)：查詢加入 `.where('room', '==', room)`。
   - `loadStatsData` (統計視圖)：查詢加入 `.where('room', '==', room)`，不再撈取全校歷史預約。
3. **新增大標題點擊回首頁**：
   - [index.html](file:///h:/schedule/index.html)：大標題 `<h1 class="header-title">` 加入 `onclick="location.href='./'"`。
   - [styles.v2.50.0.css](file:///h:/schedule/styles.v2.50.0.css) & [styles.css](file:///h:/schedule/styles.css)：為 `.header-title` 加上 `cursor: pointer;` 與 `user-select: none;`。
4. **SW 版本升級與更新通知**：
   - [sw.js](file:///h:/schedule/sw.js) 與 [index.html](file:///h:/schedule/index.html) 的 `APP_VERSION` 與 `CACHE_NAME` 升級至 **`v2.50.7`**，部署上線後自動對所有使用者彈出「新版本已就緒，立即更新」提示。

### 🛠 效能成果
- **數據載入量減少 10~20 倍**：原先需要拉取全校所有場地（電腦教室、iPad車、禮堂等）的全部預約，現在只拉取單一選定場地，網路負載極低。
- **Firestore Reads 顯著下降**：每次載入和開啟統計只消耗當前場地的 document reads，對免費層非常友善。
- **第一次載入速度極速提升**：無 IndexedDB 本地快取時的首次加載速度大幅縮短。

---

## 📅 v2.50.6 (2026-05-07) - 🎨 統計 modal 場地 pill 改為純白 + 雙層光環

### 🎯 修補
v2.50.5 把「預約統計」主標題修白後，旁邊的場地名稱 pill（例如「禮堂」）對比度仍不夠 — 原本用 `rgba(255, 255, 255, 0.95)` 半透明白底 + Pine 深字，在強烈 Pine 漸層 header 上看起來灰濛濛、文字被吞掉。

### 📦 修補項目
重新設計 `.stats-room-pill`：
- 背景: `rgba(0.95)` → **`#FFFFFF` 純白實底**（最大對比）
- 字級: 0.95rem → **1rem**（提升可讀性）
- padding: 4px 14px → **5px 16px**（pill 更舒展）
- 影子: 單層柔陰影 → **雙層光環**
  - 外層: `0 0 0 2px rgba(255, 255, 255, 0.35)` 細白光環凸顯邊界
  - 內層: `0 3px 8px -2px rgba(0, 0, 0, 0.25)` 深陰影增加浮起感
- **新增 ::before Pine 綠小點** (6×6 + 半透明邊框)，作為視覺指示符

### 🛠 設計檢討
這提醒我，**深色主題上的小型徽章/pill 不要用半透明白底**。半透明會讓底色透出來「混入」徽章，視覺上對比就消失了。深底背景上的徽章應該：
- 純白實底（不打折扣的對比）
- 或反過來用主色實底 + 白字（dark-on-dark 反例則需反向）
- 加雙層光環（外白內深）強化邊界

### 🐛 中途也踩到的 specificity bug
第一次寫 `.stats-room-pill { color: var(--primary-darker) }` 時忘了 `#statsModalTitle { color: #fff }` 是 ID selector 優先級 (1,0,0,0) > class (0,0,1,0) → **父層白字 inherit 蓋過 pill 的深字** → 白底白字完全看不見。修法是把 selector 改成 `#statsModalTitle .stats-room-pill` (1,0,1,0) 才贏。

**通用規則**：當父容器設了強制 color（特別是 ID selector），子元素若要不同色，selector 也要爬到同等或更高 specificity（補上父 ID selector 即可），或直接用 `!important`。

---

## 📅 v2.50.5 (2026-05-06) - 🐛 修正統計 modal 標題在 Pine header 上隱形

### 🚨 修補的 bug
v2.50.3 把 `.stats-modal-header` 背景從半透明白底改成 Pine 漸層後，發現「預約統計」標題完全看不見。原因是 [index.html](index.html) 該標題用了 `<span style="background: var(--primary-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">` 的 **gradient text 技巧**：
- 原本設計給「白底 header」用，文字會顯示漂亮的 Pine 綠漸層
- v2.50.3 header 改 Pine 後 → Pine 綠字落在 Pine 綠背景 → 完全融合 = 隱形
- 而且 inline style 優先級高過 v2.50.3 的 `.stats-modal-header h3 { color: #fff !important }` 外部 CSS 覆蓋（雖然 !important 應該贏，但 inline 在更深的 child span 上）

### 📦 修補項目
1. **HTML**：移除 `#statsModalTitle` h3 的 inline `style="..."` + 兩個子 span 的 inline gradient style
2. **CSS**：用新 class 接管所有樣式
   - `.stats-room-pill` (場地名稱徽章): 半透明白底 + Pine 深字 (在 Pine header 上才看得見)
   - `.stats-title-text` (主標題「預約統計」): 純白 800 + 1px 陰影 + Plus Jakarta Sans
   - `#statsModalTitle` (h3 容器): flex 排版 + 白色 svg icon

### 🛠 教訓
**Inline style 是設計反模式**，特別是當主題色會變動時。所有樣式應集中在 CSS class，這樣主題重構（如 v2.50.0 Pine 化）才不會留下這種隱形 bug。

---

## 📅 v2.50.4 (2026-05-06) - 🔒 安全性: admin defense-in-depth + 可見身份徽章

### 🚨 修補的 bug
v2.49.x 之前就存在的設計缺陷:
1. **Admin-only 功能對訪客部分可達** — `不開放時段` / `視覺化數據中心` / `場地公告管理` 三個 modal 的 opener 函式進入點完全沒驗證 `firebase.auth().currentUser`,只靠 button `display:none` 隱藏。任何 DOM 操作或 stale Firebase Auth session 都能繞過。
2. **Admin 登入狀態 UI 不明顯** — 只有「管理員」按鈕文字從 "管理員" 變 "已登入",使用者很容易以為自己沒登入但其實 Firebase Auth session 還在 (該 SDK 預設長期保留 IndexedDB session,跨裝置/分頁/重啟瀏覽器都黏著)。

### 📦 修補項目

#### 1. 前端 defense-in-depth (新增 `requireAdmin()` helper)
所有 admin-only 函式進入點呼叫 `requireAdmin('操作名稱')`,未登入時:
- 顯示 toast 提示「請先登入管理員才能 X」
- 0.6 秒後自動彈出登入彈窗
- 函式提早 return,不再繼續執行

涵蓋的 8 個 admin 函式:
- `openDashboard` (視覺化數據中心)
- `openSettingsModal` (不開放時段管理)
- `openAnnouncementManager` (場地公告管理)
- `saveRoomSettings` (儲存不開放時段)
- `deleteAnnouncement` (刪除公告)
- `loadAuditLogs` (查詢系統日誌)
- `exportLogsToCSV` (匯出日誌)
- `submitAnnouncementForm` (送公告表單) — 已有檢查,維持

#### 2. Admin 身分視覺化
登入時 header 新增:
- 🔓 **Pine 漸層 badge** 顯示「🔓 {email}」(手機僅顯示鎖頭 icon)
- **登出按鈕** (coral 紅圓 + ↗ icon),點擊有 confirm 對話框 → `auth.signOut()`

→ 使用者一眼就能看到自己是不是處於 admin 狀態,不再會「以為沒登入」。

#### 3. 新增 `doAdminLogout()` 函式
正式呼叫 `auth.signOut()` 清掉 Firebase Auth session,不只是 UI 文字切換。

### 🔧 之後可繼續強化 (未做)
- Firestore rules 從 `request.auth != null` 改成 custom claims `request.auth.token.admin == true`
- 或維護 `admins` collection 並用 `exists(/admins/$(uid))` 檢查
- 自動登出 (例如閒置 60 分鐘)

目前因 Firebase 專案沒開 anonymous auth + 沒公開註冊管道,`auth != null` 實際等價於「是 admin」,但 defense-in-depth 仍比單一防線安全。

### 🛠 Smoke test 流程
1. 個別 Edit 改版本字串 (絕不再 replace_all)
2. 本機 server 跑起來,curl 6 個 HTTP 資源全部 200
3. 確認 sw.js asset 清單裡的所有檔案都實體存在
4. 才 push

---

## 📅 v2.50.3 (2026-05-06) - ✨ 二輪 modal 巡檢: 歷史/統計/PWA banner 殘留紫色全面 Pine 化

### 🎯 修補內容
v2.50.0 主題大改版時用 sed 替換做了大規模換色，但仍有約 6 處非預設色碼漏網（不在替換清單裡的紫色 `#7c3aed`、`#6366f1`、淡紫 `#ede9fe` 等）。本輪靜態掃描全 8907 行 css，把可見部分一次補完。

### 📦 修補項目 (CSS-only, ~150 行)

| 元素 | Before | After |
| :--- | :--- | :--- |
| **歷史記錄 modal header** | `linear-gradient(#3D7B65 → #7c3aed)` 半 Pine 半紫 | 純 Pine 漸層 + 白標題 + 1px text-shadow |
| **歷史記錄主按鈕 .btn-history** | 同上半綠半紫 | Pine 實心 + 12px 圓角 |
| **PWA 更新 banner** | `linear-gradient(#6366f1 → #3D7B65 → #ec4899)` 紫→Pine→粉三色 | 純 Pine 漸層 + 綠系陰影 |
| **統計分析直方圖** | 紫漸層 `#818cf8 → #6366f1` | Pine 漸層 `#4F9D6E → #1F4D3F` |
| **取消率 bar** | 鮮紅 `#f87171 → #dc2626` | 收柔 coral `#E76A6A → #B45049` |
| **歷史批次切換** | 紫 `#6366f1` border/bg | Pine border/gradient |
| **批次選中歷史項** | lavender → pink 漸層 + 紫 border | Pine softer → soft + Pine border |
| **批次 checkbox accent** | 紫 `#6366f1` | Pine `#1F4D3F` |
| **統計 modal header** | 半透明白底 + Pine gradient text | 純 Pine 漸層 bg + 白字（與其他 modal 一致）|
| **統計 close 鈕** | 紅 `#ef4444` | 半透明白圓圈 + 90° 旋轉 hover |
| **公告 modal header** | 暖橘 `#f59e0b → #d97706` | 收柔 `#C97B3F → #A0612D`（保留語意顏色）|
| **設定 / 搜尋 modal header** | 已 Pine 但缺圓角/字體 | 補 20px 圓角 + Plus Jakarta Sans 白字 |
| **各 modal close X 鈕** | 不一致 | 統一 32×32 半透明白圓圈 + 90° 旋轉 hover |

### 🛠 防範改進
從 v2.50.1 css href 事故學到的，此版本先在本機跑 smoke test（`curl -I styles.v2.50.0.css` 回 200）才 push，避免再破版。

---

## 📅 v2.50.2 (2026-05-06) - 🚨 hotfix: 修正 v2.50.1 css href 404 導致全站無樣式

### 🚨 緊急修補
v2.50.1 因為使用了 `replace_all: true` 把 index.html 內所有 `v2.50.0` 字串都換成 `v2.50.1`，包括 `<link rel="stylesheet" href="styles.v2.50.0.css">` 也被改成 `styles.v2.50.1.css`，但實際 css 檔名仍是 `styles.v2.50.0.css` → 線上 404 → 全站無樣式渲染。

### 📦 修補內容 (1 行 css href 修回 + 版本 bump 觸發 SW 更新)
- `index.html` line 13: `styles.v2.50.1.css` → `styles.v2.50.0.css`
- `index.html`: APP_VERSION / title / meta / design-stamp 全升 v2.50.2
- `sw.js`: CACHE_NAME / APP_VERSION 升 v2.50.2，asset 清單仍指向 `styles.v2.50.0.css`（正確）
- v2.50.1 留下的內容（預約詳情 modal polish）完全保留 — 只是 css 引用路徑修對

### 🎓 學到的事
**避免對檔名版本字串做 `replace_all`**：版本號可以全文替換（APP_VERSION / title / meta），但 **檔名引用** 要單獨確認 — 因為 css 檔的命名節奏跟 app 版本不同步（v2.36/37/38 才換 css 檔，patch 版不換）。

---

## 📅 v2.50.1 (2026-05-06) - 🐛 修正預約詳情卡片標題在 Pine 底上不可見

### 🎯 修補內容
v2.50.0 上線後發現的 contrast bug：「預約詳情」modal 標題（`.delete-modal-header h3`）的早期規則 (`color: var(--text-primary)`) 沒被 v2.50.0 polish 覆蓋到，深色文字落在 Pine 綠 gradient header 上幾乎不可見。

### 📦 改動 (CSS-only, 不動 HTML/JS)
- **標題色**：強制 `color: #fff` + Plus Jakarta Sans + 1px text-shadow（提升綠底辨識度）
- **Header icon**：縮小為 36px + 加上半透明白底圓圈，更精緻
- **預約資訊主體**：改用 grid 對齊 (label 70px + value 1fr)；label 用 muted gray、value 用 primary；節次與預約者特別 bold + Pine 深色強調
- **資訊欄之間**：加細虛線分隔，最後一行不畫線
- **底部按鈕區**：12px 圓角、收柔陰影；hover 改 subtle translateY(-1px) 不再 scale
- **「取消預約」/「登入後取消」按鈕**：保留 coral red 但收柔光暈（`#E76A6A → #B45049`）
- **手機 (≤480px)**：字級略縮，grid 改 60px label

### 🔧 PWA Cache
SW cache 名稱升 v2.50.1，使用者重整時自動觸發更新 banner。

---

## 📅 v2.50.0 (2026-05-06) - 🌿 Pine 深松綠主題 (Claude Design 設計稿全面套用)

### 🎯 核心目的
依照 Claude Design 互動原型的設計稿（Pine 深松綠 + 12px 圓角 + Compact 密度），把舊版紫色玻璃擬態主題全面換成清爽的校園自然風，同時補強月視圖、手機版、儀表板的版面與調色細節。

### 🎨 設計來源
| 項目 | 內容 |
| :--- | :--- |
| **設計工具** | Claude Design (claude.ai/design) |
| **設計檔 hash** | `c0FcGPIWYENpqGDreQvbBA` (主原型), `GDpFqGsm4GbV2FbA09BwJg` (月視圖), `0o11CbyzItvzCNjFQZsluQ` (手機版), `J0LnaNyYlcE2vKM1CDp-Bg` (總覽) |
| **設計風格** | Pine 深松綠 `#1F4D3F` + 暖米底 `#F2F1E8` + 12px 圓角 + Compact 密度 |
| **顯示字體** | Plus Jakarta Sans（英數字）+ Noto Sans TC（中文）|

### 🌈 主題 token 替換 (Pine palette)

| Token | Before (v2.49.x 紫色) | After (v2.50.0 Pine) |
| :--- | :--- | :--- |
| `--primary-color` | `#667eea` | `#1F4D3F` |
| `--primary-dark` | `#5a67d8` | `#163A2F` |
| `--primary-darker` | `#4c51bf` | `#0B2820` |
| `--secondary-color` | `#a78bfa` | `#7AAD96` |
| `--bg-color` | `#f8faff` 淡藍紫 | `#F2F1E8` 暖米 |
| `--border-color` | `#e2e8f0` | `#E1DECF` |
| `--text-primary` | `#1a202c` | `#162622` |
| `--shadow-*` | `rgba(102,126,234,*)` 藍紫陰影 | `rgba(20,40,30,*)` 綠系暖灰 |
| `--radius-sm/md/lg` | `10/16/24px` | `6/12/20px` (compact) |
| `--accent-soft/softer` | — | `#DCE9E2 / #EFF5F1` (新增) |

### 📦 新增/修改檔案

| 檔案 | 動作 | 說明 |
| :--- | :--- | :--- |
| `styles.v2.50.0.css` | **新增** (~8600 行) | 由 v2.38.0 複製並全面 Pine 化；尾段 ~900 行為 polish overrides |
| `index.html` | 修改 | 標題/version/stylesheet/theme-color 全換到 v2.50.0；新增 design-stamp 元素；引入 Plus Jakarta Sans web font |
| `sw.js` | 修改 | `CACHE_NAME` / `APP_VERSION` → v2.50.0；asset 清單改用新 css |
| `manifest.json` | 修改 | `theme_color` `#667eea` → `#1F4D3F`；`background_color` `#f8faff` → `#F2F1E8` |
| `app.js` | 修改 | 月視圖 cell 加 hash hue 注入 (`--bk-hue`) + Pine 綠 count badge |

### ✨ 主要視覺優化

#### Header
- 從紫色漸層 + headerGlow 動畫 + 跳動發光標題 → 白底 + 細邊線 + 平靜 brand mark
- 標題字級 1.05rem → **1.35rem**（desktop），副標 0.78rem → **0.9rem**
- Logo 方塊 44px → **48px** + 12px 圓角 + Pine 漸層
- LINE 綁定按鈕保留 LINE 官方綠 `#06C755`
- 5 階 RWD 斷點：≥1280 / 1024-1279 / 768-1023 / 640-767 / ≤640 / ≤380px
- 手機端強制單列、隱藏次要 admin icon、按鈕收成圓形 icon-only

#### 行事曆 / 月視圖
- weekday header 紫色漸層 → 暖米
- 今日日期數字包入 **Pine 實心圓圈**（white-on-pine）
- 預約 chip 改用**姓名 hash hue**（`oklch()` 三階：底色 / 邊線 / 文字）
- cell head 加 Pine 綠**總數 badge**
- 衝突熱度 (heat-light/medium/busy/full) 色階改 Pine palette
- 週末欄位字色從警示紅 `#f56565` 改暖橘 `#C97B3F`

#### Modal / 控制面板 / 按鈕群
- 控制面板從玻璃感 → 純白卡片 + 12px 邊線
- 主要按鈕（查詢/匯出/統計/歷史）統一 Pine 實心
- Modal overlay 改 Pine 半透明 `rgba(16,49,39,0.55)` + 6px blur
- 視圖切換 active 態用 Pine 實心 + 白字

#### 視覺化數據中心 (Dashboard)
- audit 篩選列邊框 `#cbd5e1` 淡藍 → Pine 系，focus 顯示 Pine 光環
- **「查詢」按鈕** (`btnRefreshLogs`) 之前完全沒 CSS → 補 Pine 實心
- **「匯出系統日誌」按鈕** 之前也沒樣式 → 白底 Pine 字
- 「📊 載入後顯示統計」banner 紫粉漸層 → Pine soft
- raw JSON 預覽 深藍底 → 深綠底
- header 在窄寬時補 1024/1280px progressive 斷點，標題與 tabs 不再擠成直排

#### 設計系統識別
- 桌面右下浮動 design-stamp 膠囊「v2.50.0 · Pine · Compact」
- 手機 (≤768px) 自動隱藏避免擋功能

### 🐛 修補的調色漏網

- `.btn-stats` Material 紫 `#9c27b0` → Pine
- `.btn-history` 半綠半紫 `#7c3aed` → Pine
- `.audit-stat-chip` `#6d28d9` 紫字 → Pine
- `.meta-expand-btn` 紫色 → Pine
- `.month-calendar-header` 淡紫漸層 → 暖米
- `.month-day:hover` 青綠 → Pine soft

### 🔧 PWA Cache 注意事項
v2.50.0 SW cache 名稱改成 `booking-system-v2.50.0`，舊版使用者重整時會自動觸發版本更新 banner（v2.41.1 機制），點「立即更新」即可載入新主題。

---

## 📅 v2.48.0 (2026-04-20) - 🤖 AI 學期白皮書 (Gemini + HTML 報告 + Storage)

### 🎯 核心目的
每學期結束自動產出一份「校長/主任也看得懂」的使用報告 — Gemini 撰寫文案 + Chart.js 圖表 + 一鍵 LINE 分享。

### 📦 新增 2 個 Cloud Function

| Function | 觸發 | 功能 |
| :--- | :--- | :--- |
| `generateSemesterReport` | HTTP POST | 統計 → Gemini 撰寫 → 渲染 HTML → 上傳 Storage → LINE 推管理員 |
| `listSemesterReports` | HTTP GET | 取得最近 20 份報告供後台列表渲染 |

### 🧠 Gemini 1.5 Flash 文案邏輯

1. **聚合 10 個維度統計** (aggregateSemesterStats):
   - 總預約 / 已完成 / 已取消數
   - 取消率 (%)
   - 場地排行 (Top 10)
   - 預約者排行 (Top 10)
   - 節次熱門度
   - 月度趨勢 (Bar)
   - 星期分布
   - 重複預約率
2. **Prompt 要求 JSON 格式** 4 個段落：
   - `summary` (學期綜述, 100 字內)
   - `highlights` (3 大亮點, 條列)
   - `anomalies` (異常觀察, 100 字內)
   - `suggestions` (給管理員的 3 條建議, 條列)
3. **失敗 fallback**：若 Gemini API 異常，使用內建 stats 模板生成基本敘述。

### 📊 HTML 報告結構

- **Hero Header**：紫色漸層 + 學期名稱 + 生成時間
- **核心數據卡** (4 格)：總預約 / 完成數 / 取消率 / 場地數
- **AI 文案區** (4 段)：綜述 / 亮點 / 異常 / 建議
- **Chart.js 圖表** (4 張)：場地排行 / 節次熱度 / 月度趨勢 / 星期分布
- **Top 10 預約者表**
- **底部 watermark** + 「打印 / 儲存 PDF」提示

### ☁️ Firebase Storage 託管

- Bucket: `schedule-10ed3.firebasestorage.app` (顯式於 `admin.initializeApp` 指定)
- Path: `reports/{timestamp}_{semesterName}.html`
- 公開讀取 (`makePublic`) + 中文檔名 URL-encode
- Cache-Control: `public, max-age=86400`

### 🔔 LINE Flex 卡片

報告產出後 1 秒內推所有訂閱告警的管理員：
- 紫色 Header「📄 學期報告產出」
- 顯示 學期 / 總預約 / 取消率 / 熱門場地
- 「🔗 查看完整報告」按鈕（直連 publicUrl）

### 🔐 安全

- `GEMINI_API_KEY` 透過 Firebase Functions Secrets 管理 (`printf` 寫入避免 \\n 雷)
- `LINE_ACCESS_TOKEN` 共用既有 secret
- Storage 規則：`reports/*` 僅 Admin SDK 可寫，所有人可讀

### 📂 修改檔案

- `functions/index.js`: +480 行 (4 helper + 2 Cloud Function + Flex builder)
- `functions/package.json`: +1 dependency (`@google/generative-ai@^0.21.0`)
- `index.html`: 新增「📄 AI 學期報告」分頁 (~30 行)
- `app.js`: `initSemesterReports` + `generateSemesterReport` + `loadReportsHistory` (~150 行)
- `styles.v2.38.0.css`: +180 行 (按鈕 + 卡片 + 報告 list 樣式)
- `firebase.json`: 新增 storage section
- `storage.rules`: 新建（`reports/*` 公開讀，預設拒絕）

### 🧪 驗收測試

1. 管理員後台 → 「📄 AI 學期報告」分頁
2. 按「🤖 立即產出本學期報告」
3. 顯示「正在統計 → 分析 → 上傳…」進度
4. 約 30 秒後跳「✅ 報告已產出」
5. 自動列在歷史列表，點開即可看完整 HTML
6. 管理員 LINE 收到 Flex 卡片，點按鈕直接開報告

### 🐛 踩雷紀錄 (已加入 SKILL)

- **Firebase Storage 預設 bucket 不會自動存在**：新版 Firebase 專案需手動透過 Firebase Console 或 `POST https://firebasestorage.googleapis.com/v1beta/projects/{pid}/defaultBucket` 啟用
- **新版 bucket 是 `.firebasestorage.app` 而非 `.appspot.com`**：必須在 `admin.initializeApp({ storageBucket: '...firebasestorage.app' })` 顯式指定
- **中文檔名需 URL-encode**：`https://storage.googleapis.com/{bucket}/{path}` 直接帶中文會 403，需 `encodeURIComponent` 處理

---

## 📅 v2.47.0 (2026-04-19) - 意見回饋系統 → LINE 推管理員

### 🎯 核心目的
讓老師遇到問題或有建議時,可在系統內直接送出 → 管理員 LINE 即時收到。
**不需要管理員提供 User ID**(已透過 Phase 3 的 `adminLineRecipients` 機制處理)。

### 📦 新增 1 個 Cloud Function

| Function | 觸發 | 功能 |
| :--- | :--- | :--- |
| `submitFeedback` | HTTP POST | 寫入 feedbacks + LINE Flex 推所有訂閱告警的管理員 |

### 🎨 4 種回饋類型 (含色彩標識)

| 類型 | 顏色 | 用途 |
| :---: | :---: | :--- |
| 🐛 錯誤回報 | 紅色 | 系統 bug |
| 💡 功能建議 | 綠色 | 想要的新功能 |
| ❓ 使用問題 | 藍色 | 不會用、操作疑問 |
| 📝 其他 | 灰色 | 其他想法 |

### 🛡 防灌水機制

- 同 deviceId **5 分鐘內最多 1 則**(429 Too Many Requests)
- 內容長度 1~1000 字
- 姓名選填上限 50 字

### 🎨 前端 UI

**浮動 FAB 按鈕** (右下角):
- 紫色漸層 + 訊息圖示
- 桌面顯示「意見回饋」文字
- 手機僅顯示 icon 節省空間

**回饋彈窗**:
- 4 個類型按鈕(radio 樣式)
- 姓名輸入框(自動帶入上次預約姓名)
- 內容 textarea + 即時字數統計
- 預設選「❓ 使用問題」(最常見類型)

### 📊 LINE Flex Message 設計

管理員收到的卡片:
- 彩色 Header (依類型變色)
- 顯示:類型 / 姓名 / 時間
- 完整內容 (white-space: pre-wrap)
- 來源 deviceId 前 16 字 (供追蹤)
- 「🔗 開啟系統」按鈕

### 🔒 Firestore 安全

`feedbacks` collection 規則:
- ❌ 前端不能直接寫(必須透過 Cloud Function)
- ✅ 管理員可讀 + 改 status (new/read/resolved)
- ❌ 不允許刪除(保留歷史)

### 📂 修改檔案

- `functions/index.js`: +200 行 (`submitFeedback` + Flex builder + 防灌水邏輯)
- `index.html`: 新增浮動 FAB + 回饋彈窗 (~75 行)
- `app.js`: `initFeedbackSystem` + `submitFeedback` (~120 行)
- `styles.v2.38.0.css`: +220 行 (FAB + modal + form 樣式)
- `firestore.rules`: 新增 feedbacks collection 規則

### 💡 設計亮點

- **使用既有的 `pushToAdmins` 函式** — 不重複建立通知通道
- **不限制使用者身分** — 老師、訪客都能用,降低反映門檻
- **預填姓名** — 使用 localStorage 上次預約姓名,省輸入
- **type 預設選「❓ 使用問題」** — 最常見類型,降低決策成本

### 🧪 驗收測試

1. **管理員先訂閱告警**(若還沒):點 LINE 按鈕 → Step 0 → 訂閱
2. **任何使用者**(可不登入):點右下紫色「💬 意見回饋」FAB
3. 填寫:類型「❓ 使用問題」+ 姓名「測試老師」+ 內容「測試訊息」
4. 點「📤 送出回饋」
5. 管理員 LINE 應立即收到藍色 Flex 卡片
6. **5 分鐘內再送** → 應顯示「請等 5 分鐘後再送出」
7. Firestore Console 應看到 `feedbacks` 集合有新文件

---

## 📅 v2.46.0 (2026-04-19) - LINE Phase 3:排程提醒 + 管理員告警

### 🎯 核心目的
LINE Phase 3 完成 — 系統現在能**主動提醒老師**(預約 30 分鐘前),並能**自我監控**(異常事件直推管理員 LINE,取代 Sentry 角色)。

### 📦 新增 4 個 Cloud Functions

| Function | 類型 | 觸發 | 功能 |
| :--- | :--- | :--- | :--- |
| `scheduledReminder` | Scheduled | 每 5 分鐘 | 推送 30 分鐘後即將開始的預約 |
| `anomalyDetection` | Scheduled | 每 30 分鐘 | 檢查異常事件並推管理員 |
| `subscribeAdminAlerts` | HTTP | 前端呼叫 | 訂閱/取消訂閱管理員告警 |
| `checkAdminAlertStatus` | HTTP | 前端呼叫 | 查詢當前裝置的訂閱狀態 |

### ⏰ 30 分鐘提醒機制

**邏輯**:
1. Cloud Scheduler 每 5 分鐘 (`Asia/Taipei`) 觸發
2. 查今天 + 明天的所有 bookings
3. 對每筆計算「最早節次的開始時間 vs 現在」
4. **27~33 分鐘窗口內**才推送 (容錯 cron 變動)
5. 推送前查 `sentReminders/{id}_30min` 確認沒推過
6. 推完寫入 sentReminders 防重複

**Flex Message 設計**:
- 🟡 黃色 header「⏰ 30 分鐘後使用提醒」
- 顯示具體開始時間 (例:「您 10:30 起的預約即將開始」)
- 含日期/場地/節次完整資訊

**節次時間表** (`PERIOD_START_TIMES`):
- morning 07:50 / period1 08:40 / period2 09:30 / period3 10:30 / period4 11:20
- lunch 12:00 / period5 13:00 / period6 13:50 / period7 14:40 / period8 15:30

### 🚨 異常偵測 (取代 Sentry 角色)

**3 種告警場景**:
1. **批次取消激增**:過去 1 小時 ≥10 次 BATCH_CANCEL_BOOKINGS
2. **強刪激增**:過去 1 小時 ≥20 次 FORCE_DELETE_BOOKING  
3. **非尖峰建立量**:週末或 16:00 後 / 7:00 前,1 小時 ≥30 次 CREATE_BOOKING (可能是 Bot)

**推送對象**:所有訂閱 `adminLineRecipients` 的管理員。

### 🔔 管理員告警訂閱機制

**新增 Firestore collections**:
- `adminLineRecipients/{lineUserId}` — 已訂閱接收告警的管理員
- `sentReminders/{key}` — 提醒去重 (含 7 天 TTL 期限)

**前端 UI** (LINE 綁定彈窗 Step 0):
- 已綁定 LINE + 已登入管理員 → 顯示黃色「🔔 管理員系統告警」區塊
- 「🔔 訂閱系統告警」按鈕 → 點擊後寫入 `adminLineRecipients` + LINE 推確認訊息
- 「🔕 取消訂閱告警」按鈕 → 已訂閱者可移除自己

### 📂 修改檔案

- `functions/index.js`: +280 行 (4 新 functions + 工具函式 + Flex builder)
- `firestore.rules`: 新增 2 collections 規則 (read 限管理員)
- `index.html`: LINE 綁定彈窗 Step 0 加入 admin alerts 區塊
- `app.js`: `refreshAdminAlertStatus` + `toggleAdminAlerts` (~80 行)
- `styles.v2.38.0.css`: +60 行 (告警訂閱 UI)

### 💰 費用影響

- **Cloud Scheduler**: 已用 2 個 schedule (5 min + 30 min) — 在免費 3 個額度內
- **Firestore 讀取**: 每 5 分鐘掃今天+明天 bookings → 每月約 +5000 reads (免費額度足夠)
- **LINE 推播**: 30 分鐘提醒每筆預約推 1 次 → 使用量隨預約量增加,但仍在 500 條/月免費內

### 🧪 驗收測試

#### Test 1: 訂閱管理員告警
1. 登入管理員 → 點 LINE 按鈕 → 已綁定 step 應出現黃色「訂閱告警」區
2. 點「🔔 訂閱系統告警」→ LINE 應收到「✅ 已成功註冊接收系統告警」
3. 重開彈窗 → 按鈕變為「🔕 取消訂閱告警」+ 狀態「✅ 已訂閱中」

#### Test 2: 30 分鐘提醒
1. 預約一個「30 分鐘後開始」的時段(例如現在 10:00,預約 10:30 開始的第 3 節)
2. 等 5 分鐘 cron 觸發 → LINE 應收到黃色提醒卡
3. 看 functions log: `[scheduledReminder] scanned=N sent=1 skipped=0`

#### Test 3: 異常偵測 (人工觸發)
1. 用管理員身分連續批次取消 10+ 筆 (audit log 會記錄)
2. 等 30 分鐘 cron 觸發 → 訂閱者 LINE 收到「🚨 異常偵測 — 批次取消量」告警

---

## 📅 v2.45.1 (2026-04-19) - LINE 按鈕品牌 logo
## 📅 v2.45.0 (2026-04-19) - LINE Phase 2 預約事件推播

### 🎯 核心目的
延續 Phase 1 的 LINE 綁定基礎,實現預約事件**自動推 LINE Flex Message** —
讓老師預約成功立刻收到漂亮卡片通知,取消時也即時提醒。

### 📦 新增 3 個 Cloud Functions (Firestore Triggers)

| Function | 觸發 | 推播訊息 |
| :--- | :--- | :--- |
| `notifyOnBookingCreate` | bookings onCreate | ✅ 預約成功確認(綠色卡片) |
| `notifyOnBookingUpdate` | bookings onUpdate (periods 變空) | ❌ 預約已取消(紅色卡片) |
| `notifyOnBookingDelete` | bookings onDelete | ⚠ 預約被管理員取消(橘色卡片) |

### 🎨 LINE Flex Message 設計

每張卡片都包含:
- **彩色 Header**(綠/紅/橘 對應事件類型)
- **內容欄位**:📅 日期 / 📍 場地 / ⏰ 節次(中文化)/ 👤 預約者
- **預約理由**(分隔線下方)
- **「🔗 開啟預約系統」按鈕** 跳回 cagoooo.github.io/schedule/

### 🛡 容錯設計

- **未綁定使用者**:`getBoundLineUserId` 回 null → 安靜跳過,不報錯
- **推播失敗**:`pushFlexToUser` 包 try/catch,失敗只 log,不影響預約流程
- **重複推送防護**:onDelete 檢查 periods 是否為空,避免「先取消再強刪」推 2 次
- **節次中文化**:`PERIOD_NAMES` map 把 `period1` 變「第一節」

### 📂 修改檔案

- `functions/index.js`: +220 行(3 個 trigger functions + Flex builder + helpers)
- `functions/index.js`: 新增 `onDocumentCreated` / `onDocumentUpdated` / `onDocumentDeleted` import
- `sw.js`、`index.html`、`README.md`: 版本標示

### 💡 部署過程踩雷

**雷:首次 Firestore trigger 部署 IAM 傳播延遲**
- 第一次 deploy → HTTP 400 「Permission denied while using the Eventarc Service Agent」
- Firebase 提示:「first time using 2nd gen functions, retry in a few minutes」
- 等 60 秒後重試 → 全數成功 ✅

### 🧪 驗收測試

1. **建立預約**(已綁定使用者)→ LINE 應 1~3 秒內收到綠色「✅ 預約成功確認」
2. **取消預約**(自助取消)→ 收到紅色「❌ 預約已取消」
3. **管理員強刪** → 收到橘色「⚠ 預約已被管理員取消」
4. **未綁定使用者預約** → 系統照常運作,只是沒推 LINE
5. **檢查 Functions log**:
   ```bash
   firebase functions:log --only notifyOnBookingCreate --lines 5
   ```
   應看到 `[Push] ✅ 預約建立 ...` 訊息

---

## 📅 v2.44.3 (2026-04-19) - LINE QR 修正
## 📅 v2.44.0 (2026-04-19) - LINE Phase 1 綁定基礎建設
## 📅 v2.43.0 (2026-04-19) - 完整稽核日誌 (1.8)

### 🎯 核心目標
v2.41.8 批次取消漏洞顯示「沒有完整 audit 就沒辦法事後追溯」。
本版本將既有的 `logSystemAction` 從覆蓋 4 個 action 擴展到 **10 個 action**，並大幅升級 UI。

### 📜 寫入操作全包覆 (v2.41.x 教訓延伸)

| Action | 何時觸發 | 包含資訊 |
| :--- | :--- | :--- |
| `CREATE_BOOKING` 🆕 | 預約建立成功 | booker / room / dates / periods / reason / IDs |
| `DELETE_BOOKING` | 取消單筆 | reason / period / booker |
| `FORCE_DELETE_BOOKING` | 管理員強刪 | reason / period / booker |
| `UNDO_BOOKING` 🆕 | 30 秒內撤銷 | count / IDs / method |
| `BATCH_CANCEL_BOOKINGS` 🆕 | 批次取消執行 | attemptedCount / successCount / filteredOut / executedBy |
| `CREATE_ANNOUNCEMENT` 🆕 | 新建場地公告 | room / importance / message / dates / lockBookings |
| `UPDATE_ANNOUNCEMENT` 🆕 | 編輯公告 | (同上含 ID) |
| `DELETE_ANNOUNCEMENT` 🆕 | 刪除公告 | id / before snapshot |
| `EXPORT_CSV` | 匯出資料 | count |
| `ADMIN_LOGIN` | 管理員登入 | email |

### 🔍 UI 大升級 — 從 50 筆陽春列表到完整稽核中心

**篩選工具列**:
- 🎯 **Action 下拉**: 10 種操作類型篩選
- 🔍 **使用者搜尋**: 姓名 / email / deviceId 模糊搜尋
- 📅 **日期區間**: 起 ~ 訖 (Firestore server-side 過濾)
- ⏎ **查詢按鈕**: 重新載入

**統計列**:
- 📊 總計 N 筆 + Top 4 操作分布

**Log 卡片**:
- 6 種色彩標籤 (create=綠 / update=紫 / undo=黃 / batch=紫 / warning=紅 / other=灰)
- 中文化 action 名稱 + emoji icon
- 智慧詳情格式化 (依 action 顯示最相關資訊)
- **📋 原始 JSON 展開**: 一鍵查看完整 metadata (供深度除錯)

### 📂 修改檔案

- `app.js`: +12 處稽核呼叫 + 重寫 `loadAuditLogs` (+150 行) + 新增 `AUDIT_ACTION_META` 對應表 + `formatAuditDetails`
- `index.html`: 新增篩選工具列 + 統計列 (+20 行)
- `styles.v2.38.0.css`: +110 行 (filter / stats / 6 色 action / JSON 展開)

### 🛡 法遵與資安效益

| 場景 | 修正前 | 修正後 |
| :--- | :--- | :--- |
| 「誰刪了張老師的預約?」 | ❌ 無紀錄 | ✅ 完整 actor + IP + UA |
| 「上週公告被誰改過?」 | ❌ 無紀錄 | ✅ create/update/delete 全程追溯 |
| 「批次取消是誰執行的?」 | ❌ 無紀錄 | ✅ 含 attemptedCount + successCount |
| 「誰建了 5/15 那 30 筆預約?」 | ❌ 看不出來 | ✅ CREATE_BOOKING 完整紀錄 |
| 校務評鑑 / 個資稽核 | ❌ 無法出具 | ✅ 一鍵 CSV 匯出 |

### 🧪 驗收測試

1. 不登入管理員 → 預約一筆 → 開儀表板的 Audit 分頁 → 應看到 `📅 建立預約` 紀錄
2. 登入管理員 → 強刪一筆 → 應看到 `⚠ 強制刪除` 紅色標籤
3. 批次取消 → 應看到 `✂ 批次取消` 含成功/失敗筆數
4. 篩選 Action = 「建立預約」 → 只顯示 CREATE_BOOKING
5. 點任一筆「📋 原始 JSON」→ 展開深色 JSON 區塊
6. 統計列顯示「總計 N 筆」+ 操作類型分布

---

## 📅 v2.42.0 (2026-04-19) - IndexedDB 持久化快取 (C.1)

### 💾 核心變更
- 啟用 Firestore `enablePersistence({ synchronizeTabs: true })`：
  - 自動將查過的資料快取到 IndexedDB
  - 重複查詢相同範圍幾乎零延遲（不再打 server）
  - 多分頁開啟時資料同步
- 新增 `statsTrackedGet()` 包裝器收集快取命中率
- 新增 `getCacheHitRate()` 函式可在 console 查看（管理員觀察用）

### 🎯 預期效益

| 指標 | 改善前 | 改善後 |
| :--- | :---: | :---: |
| 切換週次延遲 | 200~500ms | < 50ms (cache hit) |
| Firestore 月讀取量 | ~2000 reads | ~600~800 reads (-60~70%) |
| 離線使用 | ❌ 不可 | ✅ 可瀏覽既有資料 |
| 跨分頁資料一致性 | ❌ 各自一份 | ✅ 同步 |

### 🛡 容錯機制

3 種失敗情境的處理：
1. **多分頁衝突 (`failed-precondition`)**：仍可運作，但只有一個分頁享有持久化
2. **瀏覽器不支援 (`unimplemented`)**：例如隱私模式 → 退回到記憶體快取
3. **其他錯誤**：fallback 到原本行為，console.error 記錄

### 📂 修改檔案

- `app.js`: 在 Firebase init 後加入 `enablePersistence` + 新增 `statsTrackedGet` 包裝器（+50 行）
- `app.js`: `loadBookingsFromFirebase` + `loadMonthBookings` 改用包裝器
- `sw.js`、`index.html`、`README.md`：版本標示

### 🧪 驗證方式

1. **觀察命中率**：F12 Console 輸入 `cacheStats` 看統計
2. **查命中率百分比**：`getCacheHitRate()` 回傳 0~100
3. **看 Cache HIT log**：切換週次時 console 應出現 `[Cache HIT] 2026/04/13 ~ 2026/04/19 from IndexedDB`
4. **離線測試**：DevTools → Network → Offline → 切換週次仍能看到資料

---

## 📅 v2.41.8 (2026-04-19) - 批次取消權限漏洞修補

### 🐛 嚴重安全漏洞（使用者實測發現）
> 「我並沒有登入管理員帳號就可以到這一步了」
> 使用者勾選了「張哲綸」(他人 deviceId) 的預約，並進入了批次取消確認對話框

### 🔍 漏洞詳情

**v2.41.7 之前的設計**：
- ✅ 後端 (executeBatchCancel) 有檢查 deviceId，會 silently 跳過他人預約
- ❌ 前端 UI 完全沒擋，使用者可勾選任意預約並進入確認流程

**問題**：
1. 使用者誤以為自己有權限取消
2. 二次確認框寫「即將取消 N 筆」但實際只會處理 0 筆（造成困惑）
3. UX 極差且有資安疑慮

### ✅ Fix 內容（三道防線 + UI）

#### 防線 1: Checkbox UI 限制
- 非管理員時，他人預約的 checkbox `disabled = true`
- 視覺：灰底斜紋 + 透明度 55% + 🔒 角標
- Tooltip：「此預約非本機建立，僅管理員可批次取消」

#### 防線 2: change handler 二次驗證
```javascript
checkbox.addEventListener('change', () => {
    if (!canBatchCancelBooking(...)) {  // 即使 disabled 被 console 改掉也擋住
        checkbox.checked = false;
        showToast('此預約非本機建立...', 'warning');
        return;
    }
    ...
});
```

#### 防線 3: executeBatchCancel 執行前過濾
```javascript
const ids = allIds.filter(id => canBatchCancelBooking(...));
// 即使有人從 console 加入 batchSelectedIds, 仍會被過濾
```

### 🎨 額外 UX 改良

| 場景 | 修正前 | 修正後 |
| :--- | :--- | :--- |
| 進入批次模式 | 無提示 | Toast「您僅能選取 N/M 筆本機預約」(6 秒) |
| 工具列 | 只顯示計數 | 加入 🔒 「僅可選取本機預約」chip |
| 點「全選」 | 全部勾選 (但實際只能取消自己的) | 只勾本機，提示「跳過 N 筆他人預約」 |
| 確認對話框 | 「即將取消 N 筆」 | 「即將取消 N 筆 (已自動排除 K 筆無權限)」|

### 📂 修改檔案
- `app.js`: +3 個權限工具函式 + 重寫 4 個批次相關函式（共 +60 行）
- `styles.v2.38.0.css`: +35 行（disabled 狀態 + 工具列 chip）

### 🧪 驗收測試
1. 不登入管理員 → 開歷史紀錄 → 點「批次選取」
2. ✅ Toast 提示「N/M 筆本機預約可選」
3. ✅ 工具列顯示 🔒 chip
4. ✅ 自己的預約可正常勾選
5. ✅ 他人預約 checkbox disabled + 灰底斜紋 + 🔒 角標
6. ✅ 點「全選」只勾本機，跳過他人並提示
7. ✅ 點「批次取消」只執行自己的 + 二次確認顯示正確筆數

---

## 📅 v2.41.7 (2026-04-19) - 搜尋日期範圍 Bug 修復 + 條件透明化

### 🐛 嚴重 Bug（使用者實測發現）
> 使用者主畫面選「五年級IPAD車」+ 節次「第二節」+ 跨全部場地搜尋
> 結果只看到禮堂的 4 筆，但實際 04/15、04/17 五年級IPAD車都有第二節預約！

### 🔍 根因
**搜尋範圍硬編碼為「今天起 + 未來 180 天」**：
```javascript
const today = new Date();          // 今天 2026/04/19
const futureDate = new Date();
futureDate.setDate(today.getDate() + 180);  // 2026/10/16
const startDateStr = formatDate(today);    // 04/19
```

→ 04/15、04/17 的預約 **早於今天**，直接被排除！

### ✅ Fix 內容

**搜尋範圍改採智慧策略**：

| 優先序 | 條件 | 範圍 |
| :---: | :--- | :--- |
| 1 | 主畫面有設 startDate/endDate | 採用該範圍 |
| 2 | 主畫面未設 | **過去 90 天 ~ 未來 180 天**（可抓到當週/近期）|

### 🎨 UI 改良 — 讓條件與分布一目了然

#### 完整搜尋條件 chips
搜尋結果頭部新增 4 個 chip:

| Chip | 範例 | 顏色 |
| :--- | :--- | :--- |
| 場地範圍 | 🏠 禮堂 / 🌐 跨全部場地 | 藍色 / 橘色 |
| 節次 | ⏰ 第二節 / ⏰ 所有節次 | 紫色 / 灰色 |
| 關鍵字 | 🔍「梁祐銘」/ 🔍 不限關鍵字 | 藍色 / 灰色 |
| 期間 | 📅 (主畫面範圍) 04/13 ~ 04/19 | 綠色 |

#### 場地分布提示（跨場地搜尋專屬）

**單一場地集中時**：
```
💡 結果說明：符合條件的預約全部來自「禮堂」，
   其他場地此期間無對應預約。
```

**多場地分布時**：
```
📊 場地分布：禮堂 4 筆 / 五年級IPAD車 2 筆 / 智慧教室 1 筆
```

### 📂 修改檔案

- `app.js`: `executeAdvancedSearch` 加入智慧日期範圍邏輯 + Toast 顯示實際範圍
- `app.js`: `renderSearchResults` 新增 4 個條件 chips + 場地分布計算
- `styles.v2.38.0.css`: +75 行 chips 與 hint 樣式

---

## 📅 v2.41.6 (2026-04-19) - PWA 更新流程三道保險絲

### 🐛 使用者回報
> 每次按下「立即更新」後就會停在「更新中…」狀態，但是網站還是能正常使用。

### 🔍 根因分析

`controllerchange` 事件在以下情境**不會觸發**：
1. **多分頁同時開啟**：瀏覽器需所有分頁都同意接管
2. **某些瀏覽器策略**：例如 Brave 隱私模式、Safari 部分版本
3. **clients.claim() 被 cache cleanup 拖延**：原本是 `.then()` 鏈式呼叫，若 cache 操作慢/失敗會延遲 claim

### ✅ 三道保險絲機制

| 保險絲 | 位置 | 作用 |
| :---: | :--- | :--- |
| **#1** | sw.js activate | `Promise.all([cleanup, claim])` 並行，cleanup 失敗也不影響 claim |
| **#2** | sw.js activate.then | 主動 `postMessage({type: 'SW_ACTIVATED'})` 給所有 client |
| **#3** | index.html click handler | 點更新後 `setTimeout 3000ms`，若無事件觸發強制 reload |

### 🎯 實際效果

| 情境 | 修正前 | 修正後 |
| :--- | :---: | :---: |
| 單分頁正常情況 | ✅ controllerchange | ✅ controllerchange (相同) |
| 單分頁但事件失敗 | ❌ 卡住 | ✅ 3 秒後 setTimeout fallback |
| 多分頁開啟 | ❌ 卡住 | ✅ SW_ACTIVATED message 觸發 |
| 隱私模式 / 嚴格瀏覽器 | ❌ 卡住 | ✅ 3 秒後 setTimeout fallback |

### 📊 統一 triggerReload() 函式

```javascript
function triggerReload(source) {
    if (isReloading) return;  // 防無限重整
    isReloading = true;
    console.log(`[PWA] Reloading via ${source}...`);
    window.location.reload();
}
```

三個觸發源（controllerchange / SW_ACTIVATED / 3s timeout）皆收斂到同一個函式。

### 📂 修改檔案

- `sw.js`: activate handler 重構（並行 + 主動推 message）
- `index.html`: SW 註冊區塊 +20 行（保險絲機制）

---

## 📅 v2.41.5 (2026-04-19) - 搜尋場地切換按鈕語意明確化

### 🐛 使用者回報
> v2.41.2 加入的「🏠 目前場地」按鈕意思不夠清楚，使用者不確定按了會發生什麼。

### ✅ Fix 內容

| 狀態 | 修正前 | 修正後 |
| :--- | :--- | :--- |
| 預設（限定場地） | `🏠 目前場地` | `🏠 僅看「禮堂」` (動態顯示實際場地) |
| 切換到全部 | `🌐 全部場地` | `🌐 全部場地一起搜` |
| Tooltip | 簡短 | 完整說明（含目前/切換後行為）|

### 🎯 互動細節

1. **頁面載入時**：依當前選定場地自動產生標籤（例：選「禮堂」→「🏠 僅看『禮堂』」）
2. **切換主畫面下拉**：選「三年級IPAD車」→ 按鈕即時變「🏠 僅看『三年級IPAD車』」
3. **點按鈕切換**：變「🌐 全部場地一起搜」（橘色標示）
4. **Tooltip 內含 actionable 說明**：「目前只搜尋「禮堂」的預約。點擊切換為跨全部場地搜尋。」

### 📂 修改檔案
- `index.html`: button label 預設值改為「僅看「禮堂」」
- `app.js`: `refreshScopeButtonLabel()` 新函式 + 綁定 `roomSelect.change`

---

## 📅 v2.41.4 (2026-04-19) - SW Scheme 過濾與容錯

### 🐛 Bug Report
使用者 Console 出現錯誤：
```
Uncaught (in promise) TypeError: Failed to execute 'put' on 'Cache':
Request scheme 'chrome-extension' is unsupported
```

### 🔍 根因
- v2.40.0 引入 Stale-While-Revalidate 後，SW 攔截所有 GET 請求嘗試快取
- 瀏覽器擴充功能（書籤同步、密碼管理器等）會發出 `chrome-extension://` 請求
- Cache API 只支援 `http://` 與 `https://`，遇到其他 scheme 會 throw
- 雖不影響功能但 Console 持續噴錯，干擾除錯

### ✅ Fix 內容（4 道防線）

1. **協定白名單**：`url.protocol === 'http:' || 'https:'` 才繼續
2. **來源限制**：只處理同源 + 已知 CDN（Google Fonts），其他直接放行
3. **Response 類型檢查**：拒絕 `opaque` response（無 CORS 跨網域）寫入快取
4. **try/catch 包覆 cache.put**：個別失敗只 console.warn 不 throw

### 📂 修改檔案
- `sw.js`: fetch handler +18 行（協定/來源檢查 + cache.put 容錯）

---

## 📅 v2.41.3 (2026-04-19) - Z-Index 階層修正

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

## 🎯 下個迭代目標 (Next Sprint Roadmap) — 2026-07-22 P0 第一輪完結後刷新

> 歷史完成里程碑（v2.39.0~v2.51.1）詳見上方各版本條目。已完成不再列：
> 1.7 重複預約、V.1~V.5、C.3/C.4、M.1/M.2、1.1 LINE Bot (v2.44~49)、1.8 稽核日誌、
> M.5 異動通知、C.1 快取 (v2.50.7/8)、L.1~L.4 資料生命週期 (v2.51.0)、F.3 Sentry (v2.51.1)。

| 順位 | 提案 | 工時 | 狀態 |
| :---: | :--- | :---: | :---: |
| 🥇 | **新學期小掃除**（殘留文字/場地清單/不開放時段年檢） | 0.5 天 | 🔴 P0，8/1 開學前 |
| 🥈 | **Sentry 告警接 LINE**（錯誤直接推播管理員） | 1~2 天 | 🔴 P0，複用既有 LINE 基建 |
| 🥉 | **L.5 資料庫規模儀表板** | 1 天 | 🔴 P0，L 系列收尾 |
| 4 | **M.3 個人化儀表板**（老師看自己的預約） | 3~4 天 | 🔴 P0，開學第一個月 |
| 5 | **R.3 學期比較分析**（新 vs 舊學期） | 3~4 天 | 🔴 P0，建議 9 月做（等新學期有數據） |
| 6 | 1.6 Web Push 瀏覽器通知 | 4~6 天 | 🟠 P1 |
| 7 | 2.6 預約候補機制（Waitlist） | 5~7 天 | 🟠 P1 |
| 8 | S.2 預約編輯歷史（Edit Trail） | 3~4 天 | 🟠 P1 |
| 9 | F.1 Vitest + Playwright 測試 | 10~14 天 | 🟠 P1，根治回歸風險 |
| 10 | N.1 通知偏好設定中心 | 3~4 天 | 🟠 P1 |
| 11 | U.4 場地配置縮圖預覽 | 2~3 天 | 🟠 P1 |
| 12 | K.1 預約成就徽章（趣味亮點） | 2~3 天 | 🟠 P1 |
| ⏸ | M.4 異常使用者管理 | 4~5 天 | ⛔ 依賴 QR 簽到 (3.2) |
| ⏸ | C.2 Code Splitting / F.2 TypeScript | 4~21 天 | ⛔ 待 F.1 測試完成後 |

---

## 🔍 使用者實測 Bug 修復記錄 (v2.41.0 → v2.41.8)

> 一天內 9 個小版本的密集修復史，全部由實際使用者測試發現。
> **價值**：這些是只有實戰才會浮出的細節 bug，比規劃中的「新功能」更直接提升信任度。

| 版本 | 類型 | 使用者描述 | 根因 | 修復策略 |
| :---: | :---: | :--- | :--- | :--- |
| v2.41.1 | ✨ 功能 | （無）— 主動加入更新通知 | 老師回報「不知道有新版」 | PWA Update Banner |
| v2.41.2 | 🐛 邏輯 | 「搜尋出現的是禮堂內容好像不對」 | `executeAdvancedSearch` 未過濾 room | 加入 scope toggle |
| v2.41.3 | 🐛 視覺 | 「按下再預約後彈出訊息跑在下面」 | toast z-index 與 modal 同層 | z-index 階層 CSS 變數 |
| v2.41.4 | 🐛 後端 | Console: `chrome-extension scheme unsupported` | SW 攔截到擴充功能請求 | 4 道防線 (協定/來源/類型/try-catch) |
| v2.41.5 | 💡 文案 | 「按鈕的意思不夠清楚」 | 「目前場地」太抽象 | 動態顯示實際場地名 |
| v2.41.6 | 🐛 致命 | 「按下更新後過了很久還是沒消失，是當掉了嗎」 | controllerchange 不觸發 | 三道保險絲 (並行 claim + message + setTimeout) |
| v2.41.7 | 🐛 致命 | 「五年級IPAD車明明就有人預約第二節，為何搜不到」 | 搜尋範圍硬編碼「今天起 + 180 天」 | 智慧日期範圍 (主畫面 OR 過去 90 + 未來 180) |
| v2.41.8 | 🔒 資安 | 「沒登入管理員也能勾他人預約進入批次取消」 | 後端有檢查但 UI 沒擋 | 三道防線 (UI disabled + change handler + execute filter) |

### 📊 統計
- **總 commit**: 9 個（v2.41.0 主版 + v2.41.1~8 hotfix）
- **修復 Bug**: 7 個（含 1 個致命 SW、1 個致命搜尋邏輯、1 個資安漏洞）
- **新功能**: 4 個（場地公告、批次取消、PWA 通知、搜尋 chips）
- **總工時**: 1 天密集衝刺
- **資料庫變更**: Firestore 新增 `roomAnnouncements` collection

### 💡 從 9 連發看到的系統性課題

| 課題 | 影響範圍 | 對應提案優先級 |
| :--- | :--- | :--- |
| **缺少自動化測試** | 5 個 bug 都是手測才發現 | F.1 ⬆⬆ |
| **缺少前端錯誤監控** | SW chrome-extension 錯誤靠 console 才看到 | F.3 ⬆⬆ |
| **權限驗證只在後端** | 批次取消漏洞典型案例 | 1.8 稽核日誌 ⬆ |
| **硬編碼日期/閾值** | 搜尋範圍、Rate Limit 都踩過 | 1.5 智慧速率 ⬆ |
| **z-index 無系統管理** | 用 CSS 變數已治本 | ✅ v2.41.3 完成 |
| **PWA 更新流程脆弱** | 三道保險絲已治本 | ✅ v2.41.6 完成 |

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
