# 學校預約系統：專案進度表 (PROGRESS)

本文件詳實記錄「禮堂&專科教室&IPAD平板車預約系統」的開發歷程與已實作功能之進度。

---

## 📅 當前版本：v2.45.0 (2026-04-19) - LINE Phase 2 預約事件推播

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

## 🎯 下個迭代目標 (Next Sprint Roadmap)

> 依據 [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md) 的施工順序，當前進度與後續規劃：

| 階段 | 提案 | 工時 | 狀態 |
| :---: | :--- | :---: | :---: |
| 🥇 速勝 1 | 1.7 一鍵重複預約 | 1~2 天 | ✅ **v2.39.0** |
| 🥇 速勝 2-8 | **V.1~V.5 + C.3 + C.4** | 7 項合計 ~5 天 | ✅ **v2.40.0** |
| 🎛 管理員 1-2 | **M.1 場地公告 + M.2 批次取消** | 5 天 | ✅ **v2.41.0** |
| 🆕 PWA Hotfix | **v2.41.1~v2.41.8 連續 8 個小版本** | 7 項使用者實測 Bug | ✅ **2026-04-19** |
| 🚧 進行中 | F.3 Sentry RUM 錯誤監控 | 1~2 天 | **🥇 強烈建議下一個** |
| 🚧 後續 | C.1 IndexedDB 快取 | 3~4 天 | v2.42.0 規劃 |
| 4 | 1.8 完整稽核日誌 | 3~4 天 | **🥈 v2.41.x 教訓提升優先級** |
| 5 | M.3 個人化儀表板 | 3~4 天 | v2.43.0 規劃 |
| 6 | 1.6 Web Push 瀏覽器通知 | 4~6 天 | ⏳ 規劃中 |
| 7 | F.1 Vitest + Playwright 測試 | 10~14 天 | **🥉 防止 v2.41.x 系列回歸** |
| 8 | F.2 漸進式 TypeScript | 14~21 天 | ⏳ 規劃中 |
| 9 | 3.3 AI 學期白皮書 | 3~4 週 | ⏳ 規劃中 |
| ⏸ | M.4 異常使用者管理 | 4~5 天 | ⛔ 依賴 QR 簽到 (3.2) |
| ⏸ | M.5 異動自動通知 | 2 天 | ⛔ 依賴 1.6 Web Push |
| ⏸ | C.2 Code Splitting | 4~5 天 | ⛔ 重構風險高，待 F.1 測試完成後 |

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
