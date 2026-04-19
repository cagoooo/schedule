# 優化實作手冊（OPTIMIZATION PLAYBOOK v1.0）

**配套文件**：[FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) │ [PROGRESS.md](./PROGRESS.md)  
**基準版本**：v2.38.6 │ **建立日期**：2026-04-19  
**文件目的**：針對下列 7 項提案提供「逐步實作指引、檔案修改清單、程式碼範例、驗收標準與常見陷阱」，可直接照表施工。

| # | 提案 | 預估工時 | 風險等級 | 優先 |
| :---: | :--- | :---: | :---: | :---: |
| 1 | 1.6 Web Push 瀏覽器通知 | 4~6 天 | 中（iOS 相容性）| 🥈 |
| 2 | 1.7 ⚡ 一鍵重複預約 | 1~2 天 | 低 | 🥇 |
| 3 | 1.8 完整稽核日誌 | 3~4 天 | 低 | 🥉 |
| 4 | 3.3 AI 學期白皮書 | 3~4 週 | 高（GCP 費用 + Gemini 配額）| ⭐ |
| 5 | F.1 Vitest + Playwright 測試 | 10~14 天 | 低 | 🛠 |
| 6 | F.2 漸進式 TypeScript | 14~21 天 | 中（重構風險）| 🛠 |
| 7 | F.3 Sentry RUM | 1~2 天 | 極低 | 🛠 |

> **建議施工順序**：1.7 → F.3 → 1.8 → F.1 → 1.6 → F.2 → 3.3  
> 理由：先快速建立信心 (1.7)、立即取得 Bug 觀測能力 (F.3)、補上稽核 (1.8)、再導入測試與長期投資。

---

# 🥇 1.7 一鍵重複預約（Quick Re-Book）

## 📌 為什麼要做
**痛點**：每週固定課程（如週三第三節資訊課）老師需重新填寫 5~6 個欄位，導致預約倦怠。  
**目標**：讓重複預約從「30 秒填表」變成「2 秒確認」。

## 🎯 達成目標
- 歷史紀錄列表每筆右側出現 `🔁 再預約一次` 按鈕
- 點擊後 1 秒內彈出預填好的預約彈窗，日期自動推算為「下週同日」
- 若衝突，自動觸發既有 AI 替代方案

## 🛠 實作步驟（共 5 步，估時 6~10 小時）

### Step 1 — 在歷史紀錄渲染處加入按鈕（30 分鐘）
**檔案**：[app.js](app.js)（搜尋 `renderHistoryList` 或 `historyList.innerHTML`）

```javascript
// 在每筆歷史紀錄的 HTML template 中加入：
<button class="btn-quick-rebook"
        data-booking-id="${booking.id}"
        data-classroom="${booking.classroom}"
        data-periods='${JSON.stringify(booking.periods)}'
        data-booker="${booking.bookerName}"
        data-reason="${booking.reason}"
        title="以此筆為範本，預約下週同日">
  🔁 再預約一次
</button>
```

### Step 2 — 撰寫 `quickRebook()` 核心函式（2 小時）
**檔案**：[app.js](app.js)（建議放在 `recordBooking()` 後方）

```javascript
function quickRebook(originalBooking) {
    // 1. 計算下週同日
    const oldDate = new Date(originalBooking.date);
    const nextWeek = new Date(oldDate);
    nextWeek.setDate(oldDate.getDate() + 7);
    const newDateStr = nextWeek.toISOString().split('T')[0];

    // 2. 預填彈窗
    document.getElementById('bookingDate').value = newDateStr;
    document.getElementById('classroomSelect').value = originalBooking.classroom;
    originalBooking.periods.forEach(p => {
        const cb = document.querySelector(`input[name="period"][value="${p}"]`);
        if (cb) cb.checked = true;
    });
    document.getElementById('bookerName').value = originalBooking.bookerName;
    document.getElementById('reason').value = originalBooking.reason;

    // 3. 開啟彈窗，並標示「快速續訂模式」
    openBookingModal();
    document.getElementById('bookingModalTitle').textContent =
        `🔁 快速續訂：${originalBooking.classroom} (${newDateStr})`;

    // 4. 自動衝突檢查（重用既有邏輯）
    setTimeout(() => triggerConflictCheck(), 300);
}
```

### Step 3 — 事件委派綁定（30 分鐘）
**檔案**：[app.js](app.js)（在 `DOMContentLoaded` 內）

```javascript
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-quick-rebook');
    if (!btn) return;
    e.stopPropagation(); // 避免冒泡到列表本身
    const booking = {
        id: btn.dataset.bookingId,
        classroom: btn.dataset.classroom,
        periods: JSON.parse(btn.dataset.periods),
        bookerName: btn.dataset.booker,
        reason: btn.dataset.reason,
        date: btn.dataset.date,
    };
    quickRebook(booking);
});
```

### Step 4 — 樣式設計（30 分鐘）
**檔案**：[styles.css](styles.css)

```css
.btn-quick-rebook {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: #fff;
    border: none;
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 0.85rem;
    cursor: pointer;
    transition: transform .15s, box-shadow .15s;
    box-shadow: 0 2px 6px rgba(102, 126, 234, .3);
}
.btn-quick-rebook:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, .5);
}
.btn-quick-rebook:active { transform: scale(.96); }
```

### Step 5 — Service Worker 版號更新（5 分鐘）
**檔案**：[sw.js](sw.js)

```javascript
const CACHE_NAME = 'booking-system-v2.39.0'; // 升小版號
```

## 📂 涉及檔案清單
- ✏️ [app.js](app.js) — 新增 `quickRebook()` 函式 + 事件綁定
- ✏️ [styles.css](styles.css) — 新增 `.btn-quick-rebook` 樣式
- ✏️ [sw.js](sw.js) — 升版
- ✏️ [index.html](index.html) — 升版顯示

## ✅ 驗收標準
1. 桌面 Chrome / 手機 Safari 點按鈕都能正常彈窗。
2. 預填欄位（場地、節次、預約者、理由）100% 正確。
3. 衝突自動觸發 AI 建議。
4. 取消鍵不影響原有歷史紀錄。

## ⚠️ 常見陷阱
- ❌ **下週同日落入週末或國定假日** → 解法：`nextWeek` 後檢查 `getDay()`，若為 0/6 自動跳到下週一。
- ❌ **JSON.stringify 在 dataset 中含特殊字元（如雙引號）** → 解法：改用 `encodeURIComponent` + `decodeURIComponent`。
- ❌ **手機端按鈕被列表 click 事件吃掉** → 解法：`e.stopPropagation()`（已在 Step 3 處理）。

## 📊 預期效益
- 老師預約時間從平均 30 秒降至 5 秒
- 預期提升每週 50+ 次重複預約的效率
- 開發成本：1 人 1 天

---

# 🥈 1.6 Web Push 瀏覽器通知

## 📌 為什麼要做
即使有 LINE Bot，仍有部分老師不加官方帳號。Web Push 是「零門檻、零依賴」的補強通知管道。

## 🎯 達成目標
- 預約成功 → 即時瀏覽器通知
- 使用前 30 分鐘 → 自動推播提醒
- 點通知 → 自動跳到該預約詳情

## 🏗 架構圖

```
[使用者瀏覽器]
   ↓ getToken (FCM)
[Firestore] → users/{uid}.fcmToken
   ↓ onCreate trigger
[Cloud Function: sendPush]
   ↓ FCM Admin SDK
[Firebase Cloud Messaging]
   ↓
[使用者瀏覽器: SW push event]
```

## 🛠 實作步驟（共 7 步，估時 4~6 天）

### Step 1 — Firebase Console 啟用 FCM（10 分鐘）
1. 至 Firebase Console → 專案設定 → Cloud Messaging
2. 產生 **Web Push 憑證 (VAPID Key)**，複製公開金鑰備用

### Step 2 — 加入 firebase-messaging-sw.js（30 分鐘）
**檔案**：建立新檔 `firebase-messaging-sw.js`（**必須位於根目錄**）

```javascript
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'YOUR_API_KEY',
    projectId: 'YOUR_PROJECT_ID',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const { title, body, icon, data } = payload.notification;
    self.registration.showNotification(title, {
        body, icon: icon || '/favicon.png',
        badge: '/favicon.png',
        data: data || {},
        actions: [
            { action: 'open', title: '查看詳情' },
            { action: 'dismiss', title: '稍後' }
        ],
    });
});

self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    if (e.action === 'dismiss') return;
    const bookingId = e.notification.data?.bookingId;
    const url = bookingId ? `/?booking=${bookingId}` : '/';
    e.waitUntil(clients.openWindow(url));
});
```

### Step 3 — 前端請求權限與取得 token（1 天）
**檔案**：[app.js](app.js)

```javascript
async function setupWebPush() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'denied') return;

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;

        const messaging = firebase.messaging();
        const token = await messaging.getToken({
            vapidKey: 'YOUR_VAPID_PUBLIC_KEY'
        });

        // 存到 Firestore，以 deviceId 為 key
        await db.collection('pushTokens').doc(deviceId).set({
            token,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            userAgent: navigator.userAgent,
        }, { merge: true });

        // Foreground 訊息處理
        messaging.onMessage((payload) => {
            showInAppToast(payload.notification.title, payload.notification.body);
        });
    } catch (err) {
        console.error('[WebPush] 設定失敗', err);
    }
}

// 在使用者完成第一次預約後再請求權限（避免一進站就跳框）
function maybePromptPushPermission() {
    if (localStorage.getItem('pushPromptShown')) return;
    showPermissionDialog({
        title: '🔔 開啟預約提醒？',
        body: '使用前 30 分鐘將自動提醒您',
        onAccept: setupWebPush,
    });
    localStorage.setItem('pushPromptShown', 'true');
}
```

### Step 4 — 建立 Cloud Function（2 天）
**檔案**：建立 `functions/index.js`（先 `firebase init functions`）

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// 預約建立 → 立即推播
exports.notifyOnBooking = functions
    .region('asia-east1')
    .firestore.document('bookings/{bookingId}')
    .onCreate(async (snap, ctx) => {
        const booking = snap.data();
        const tokenDoc = await admin.firestore()
            .collection('pushTokens').doc(booking.deviceId).get();
        if (!tokenDoc.exists) return;

        await admin.messaging().send({
            token: tokenDoc.data().token,
            notification: {
                title: '✅ 預約確認',
                body: `${booking.bookerName} 已預約 ${booking.classroom} ${booking.date} 第 ${booking.periods.join(',')} 節`,
            },
            data: { bookingId: ctx.params.bookingId },
            webpush: {
                fcmOptions: { link: `https://yourdomain/?booking=${ctx.params.bookingId}` }
            },
        });
    });

// 排程提醒：每 5 分鐘掃一次「30 分鐘後」的預約
exports.remindUpcoming = functions
    .region('asia-east1')
    .pubsub.schedule('every 5 minutes')
    .onRun(async () => {
        const now = new Date();
        const target = new Date(now.getTime() + 30 * 60 * 1000);
        // ... 查 30 分鐘後預約 → 推播提醒
    });
```

### Step 5 — Firestore Rules（30 分鐘）
**檔案**：[firestore.rules](firestore.rules)

```js
match /pushTokens/{deviceId} {
    allow read: if false; // 僅 Cloud Function 可讀
    allow write: if request.auth != null
                 || request.resource.data.deviceId == deviceId;
}
```

### Step 6 — UI 提示組件（半天）
- 在預約成功 toast 後加入「💡 想要 30 分鐘前自動提醒嗎？」
- 設定頁加入「通知偏好」開關（含關閉、僅當日、永遠提前 30 分鐘三選項）

### Step 7 — 部署（1 小時）
```bash
firebase deploy --only functions
```

## 📂 涉及檔案清單
- ✨ 新增 `firebase-messaging-sw.js`
- ✨ 新增 `functions/` 資料夾
- ✏️ [app.js](app.js)、[index.html](index.html)、[firestore.rules](firestore.rules)

## ✅ 驗收標準
1. Chrome 桌面/Android 通知正常顯示
2. iOS Safari 16.4+ 在「加到主畫面」後可收到
3. 點通知能正確跳轉到該預約
4. 重新整理後仍能持續收到（Token 持久化成功）

## ⚠️ 常見陷阱
- ❌ **iOS Safari < 16.4 不支援** → 解法：`if (!('PushManager' in window))` 跳過並 fallback 到 LINE。
- ❌ **localhost 無法測試** → 解法：用 `firebase serve --only hosting` 透過 Firebase Hosting 預覽。
- ❌ **VAPID Key 寫死在 JS 會洩露**？→ 不會，VAPID 公鑰本來就公開，私鑰存在 Firebase 後端。
- ❌ **Cloud Functions 冷啟動延遲 2~3 秒** → 解法：用 `min instances = 1`（會產生少量月費）。

## 💰 成本評估
- FCM 免費，無數量限制
- Cloud Functions 每月免費 200 萬次呼叫，校用綽綽有餘
- 預估月費：NT$0~50

---

# 🥉 1.8 完整稽核日誌（Audit Log）

## 📌 為什麼要做
v2.37.0 引入「強制刪除」後，目前無法回答：
- 「這筆預約是誰刪的？」
- 「上週日有人異常大量取消，是誰做的？」
- 「歷史記錄改過嗎？被誰改的？」

## 🎯 達成目標
- 所有寫入操作（建立 / 取消 / 強刪 / 範本套用 / 角色變更）皆留紀錄
- 管理員後台可篩選 + 匯出
- 可保留 2 年（符合校務評鑑需求）

## 🏗 資料結構

**Collection: `auditLogs`**

| 欄位 | 型別 | 範例 |
| :--- | :--- | :--- |
| `action` | string | `booking.create` / `booking.cancel` / `booking.forceDelete` / `template.apply` / `role.update` |
| `targetCollection` | string | `bookings` |
| `targetId` | string | `booking_abc123` |
| `operatorDeviceId` | string | `device_xyz789` |
| `operatorRole` | string | `admin` / `device_admin` / `user` |
| `operatorName` | string | `張老師` |
| `before` | map / null | 寫入前快照（取消時填入原資料） |
| `after` | map / null | 寫入後快照 |
| `metadata` | map | `{ reason, ipHash, userAgent }` |
| `timestamp` | timestamp | serverTimestamp |

## 🛠 實作步驟（共 5 步，估時 3~4 天）

### Step 1 — 撰寫共用 wrapper（半天）
**檔案**：[app.js](app.js)（新增）

```javascript
async function auditLog(action, payload = {}) {
    try {
        await db.collection('auditLogs').add({
            action,
            targetCollection: payload.targetCollection || null,
            targetId: payload.targetId || null,
            operatorDeviceId: deviceId,
            operatorRole: getCurrentUserRole(), // user / admin / device_admin
            operatorName: payload.operatorName || null,
            before: payload.before || null,
            after: payload.after || null,
            metadata: {
                ipHash: null, // 可在 Cloud Function 補上
                userAgent: navigator.userAgent.slice(0, 200),
                pageUrl: location.pathname,
            },
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        // 稽核失敗不應阻擋主流程，只記 console
        console.warn('[Audit] 寫入失敗', e);
    }
}
```

### Step 2 — 包裝既有寫入函式（1 天）

```javascript
async function createBooking(data) {
    const docRef = await bookingsCollection.add(data);
    await auditLog('booking.create', {
        targetCollection: 'bookings',
        targetId: docRef.id,
        after: data,
        operatorName: data.bookerName,
    });
    return docRef;
}

async function cancelBooking(bookingId, reason) {
    const snap = await bookingsCollection.doc(bookingId).get();
    const before = snap.data();
    await bookingsCollection.doc(bookingId).update({ status: 'cancelled' });
    await auditLog('booking.cancel', {
        targetCollection: 'bookings',
        targetId: bookingId,
        before,
        after: { ...before, status: 'cancelled' },
        operatorName: before.bookerName,
    });
}

async function forceDeleteBooking(bookingId, reason) {
    const snap = await bookingsCollection.doc(bookingId).get();
    const before = snap.data();
    await bookingsCollection.doc(bookingId).delete();
    await auditLog('booking.forceDelete', {
        targetCollection: 'bookings', targetId: bookingId,
        before, after: null,
        operatorName: '管理員',
        metadata: { reason },
    });
}
```

### Step 3 — Firestore Rules 嚴格化（半天）
**檔案**：[firestore.rules](firestore.rules)

```js
match /auditLogs/{logId} {
    // 任何人皆可寫（讓使用者操作能留紀錄）
    allow create: if request.resource.data.timestamp == request.time
                  && request.resource.data.operatorDeviceId is string
                  && request.resource.data.action.matches('^[a-z]+\\.[a-z]+$');
    // 嚴禁修改 / 刪除
    allow update, delete: if false;
    // 僅管理員可讀
    allow read: if request.auth != null
                && request.auth.token.role in ['admin', 'super_admin'];
}
```

### Step 4 — 建立後台稽核頁（1 天）
**檔案**：[index.html](index.html) + [app.js](app.js)

新增管理員選單「🔍 稽核日誌」，UI 含：
- 日期區間 picker
- 操作類型多選（建立、取消、強刪、範本）
- 關鍵字搜尋（操作者姓名 / deviceId）
- Table 顯示，每列右側有「展開原始 JSON」
- 右上角「📥 匯出 CSV」

```javascript
async function loadAuditLogs(filters) {
    let query = db.collection('auditLogs')
        .orderBy('timestamp', 'desc')
        .limit(500);
    if (filters.dateFrom) query = query.where('timestamp', '>=', filters.dateFrom);
    if (filters.action) query = query.where('action', '==', filters.action);
    const snapshot = await query.get();
    renderAuditTable(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
}
```

### Step 5 — 自動歸檔（選用，半天）
建立 Cloud Function：每月 1 號將 24 個月前的 logs 匯出至 Cloud Storage 並刪除原資料，避免費用累積。

## 📂 涉及檔案清單
- ✏️ [app.js](app.js) — 新增 `auditLog()` + 改寫 6 個寫入函式
- ✏️ [firestore.rules](firestore.rules) — 新增 auditLogs 規則
- ✏️ [index.html](index.html) — 新增稽核頁 UI

## ✅ 驗收標準
1. 手動執行各種操作後，`auditLogs` 都有對應紀錄
2. 一般使用者無法讀取 auditLogs
3. CSV 匯出可在 Excel 正常開啟（含 BOM）
4. 管理員可依日期+操作類型篩選

## ⚠️ 常見陷阱
- ❌ **每筆預約都寫 audit 會雙倍費用** → 解法：可接受，反而更安全；若要省，改用 Batched Writes。
- ❌ **before/after 包含過大物件** → 解法：避免存陣列 > 100 項，必要時截斷。
- ❌ **隱私問題：log 裡有姓名** → 解法：管理員權限本就須核可閱覽，並定期匿名化超過 1 年的紀錄。

---

# ⭐ 3.3 AI 智慧學期白皮書

## 📌 為什麼要做
每學期校長 / 主任都需要查使用率。目前要手動拼湊 CSV → Excel → PPT，至少半天工時。

## 🎯 達成目標
- 學期末（每年 1/31、6/30）23:00 自動執行
- 產出含 AI 分析語意的 PDF（10~15 頁），自動寄送 / 上傳雲端
- 涵蓋：使用率趨勢、Top 10 時段、異常分析、IPAD 借用統計、下學期預測

## 🏗 架構

```
[Cloud Scheduler] → [Cloud Function: generateWhitepaper]
   ↓
[Firestore Aggregate] → 統計資料 JSON
   ↓
[Gemini API] → AI 撰寫敘述段落
   ↓
[jsPDF + Chart.js] → 渲染 PDF
   ↓
[Firebase Storage] → 上傳 PDF
   ↓
[Email + LINE] → 通知校長 / 主任
```

## 🛠 實作步驟（共 6 步，估時 3~4 週）

### Step 1 — 統計資料聚合（5 天）
**檔案**：`functions/whitepaper/aggregate.js`

```javascript
async function aggregateSemester(startDate, endDate) {
    const bookings = await admin.firestore()
        .collection('bookings')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();

    const stats = {
        totalBookings: bookings.size,
        cancellationRate: 0,
        byClassroom: {},     // 各場地次數
        byPeriod: {},        // 各節次次數
        byWeekday: [0,0,0,0,0,0,0],  // 週一到週日
        topUsers: [],        // 排行榜
        cancelHotspots: [],  // 取消熱點
        ipadByGrade: {},     // IPAD 各年級借用
        leadTimeDistribution: {},  // 提前天數分布
    };

    bookings.forEach(doc => {
        const b = doc.data();
        stats.byClassroom[b.classroom] = (stats.byClassroom[b.classroom] || 0) + 1;
        // ... 其他統計
    });

    return stats;
}
```

### Step 2 — Gemini API 文案生成（3 天）
**檔案**：`functions/whitepaper/aiNarrate.js`

```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function narrate(stats) {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `
你是一位資深教育行政專家，請根據以下學期預約統計資料，撰寫 4 段分析報告：
1. 整體使用情況摘要（150 字）
2. 場地使用熱點分析（含使用率最高與最低的場地，並推測原因）
3. 異常取消模式（哪些時段取消率異常高，可能反映什麼）
4. 下學期建議（是否需新增設備、調整不開放時段等）

統計資料：
${JSON.stringify(stats, null, 2)}

請以繁體中文撰寫，語氣專業但不艱澀。回傳純文字段落（無 Markdown）。
    `;
    const result = await model.generateContent(prompt);
    return result.response.text();
}
```

### Step 3 — PDF 渲染（5 天）
**檔案**：`functions/whitepaper/renderPdf.js`

```javascript
const PDFDocument = require('pdfkit');
const ChartJSNodeCanvas = require('chartjs-node-canvas');

async function renderPdf(stats, narrative) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));

    // 封面
    doc.fontSize(28).text('學校預約系統', { align: 'center' });
    doc.fontSize(20).text(`${stats.semester} 使用報告`, { align: 'center' });
    doc.moveDown(2);

    // 摘要
    doc.fontSize(14).text('一、整體摘要', { underline: true });
    doc.fontSize(11).text(narrative.summary);

    // 圖表（用 Chart.js Node 渲染）
    const chartCanvas = new ChartJSNodeCanvas({ width: 500, height: 300 });
    const chartImg = await chartCanvas.renderToBuffer({
        type: 'bar',
        data: { /* ... */ }
    });
    doc.image(chartImg, { width: 500 });

    // ... 其他章節

    doc.end();
    return new Promise((resolve) =>
        doc.on('end', () => resolve(Buffer.concat(buffers))));
}
```

### Step 4 — 上傳 Storage + 通知（2 天）

```javascript
exports.generateWhitepaper = functions.pubsub
    .schedule('30 23 31 1,6 *')   // 1/31 與 6/30 23:30
    .timeZone('Asia/Taipei')
    .onRun(async () => {
        const stats = await aggregateSemester(/* 動態算學期起訖 */);
        const narrative = await narrate(stats);
        const pdfBuffer = await renderPdf(stats, narrative);

        const fileName = `whitepapers/${new Date().toISOString().slice(0,10)}.pdf`;
        await admin.storage().bucket().file(fileName).save(pdfBuffer);
        const [url] = await admin.storage().bucket().file(fileName)
            .getSignedUrl({ action: 'read', expires: '2099-12-31' });

        // 寄送 Email
        await sendEmail('principal@school', '本學期預約報告', `下載連結: ${url}`);
        // LINE 通知
        await pushLine('admin', `📊 本學期報告已產生：${url}`);
    });
```

### Step 5 — 手動觸發頁面（半天）
管理員後台加按鈕「🤖 立即產生本學期報告」呼叫 Callable Function。

### Step 6 — 環境變數設定（半天）
```bash
firebase functions:config:set gemini.key="YOUR_GEMINI_KEY"
firebase functions:secrets:set GEMINI_API_KEY
```

## 📂 涉及檔案清單
- ✨ 新增 `functions/whitepaper/` 全資料夾
- ✏️ [index.html](index.html) — 新增手動觸發按鈕
- ✏️ Firebase Console — 設定 Secrets

## ✅ 驗收標準
1. 手動觸發能在 60 秒內產出 PDF
2. PDF 開啟正常，圖表清晰，AI 文案通順
3. 排程能在指定日期自動執行
4. 通知能正確發送

## ⚠️ 常見陷阱
- ❌ **PDFKit 中文亂碼** → 解法：必須 `doc.font('NotoSansCJK.ttf')` 註冊中文字型。
- ❌ **Cloud Function 256 MB 記憶體不足** → 解法：設 `runWith({ memory: '1GB', timeoutSeconds: 540 })`。
- ❌ **Gemini 回傳超出 token 上限** → 解法：截斷 stats 或改 `gemini-1.5-pro` (有更大上下文)。
- ❌ **Cloud Scheduler 在台灣 1/31 23:30 執行卻是 UTC 時間** → 解法：明確設 `timeZone: 'Asia/Taipei'`。

## 💰 成本評估
- Cloud Functions：每月 < NT$50
- Gemini Flash：每次約 1500 tokens，每學期 1 次 ≈ 免費額度內
- Cloud Storage：每月 < NT$10

---

# 🛠 F.3 Sentry RUM（最低成本最高 ROI）

## 📌 為什麼要做
**現狀**：v2.37.5 修復熱度圖 Bug 是因老師回報；v2.34 修衝突 Bug 是因使用者投訴。  
被動回報模式 = Bug 在使用者端發生很久才知道。

## 🎯 達成目標
- 任何前端錯誤自動上報，含 stack trace + 使用者裝置 + 重現步驟
- 嚴重錯誤即時 Email/Slack 通知
- 每週一份「健康度報告」

## 🛠 實作步驟（共 4 步，估時 1~2 天）

### Step 1 — 註冊 Sentry（10 分鐘）
1. https://sentry.io 註冊免費帳號（每月 5K events 已夠校用）
2. 建立 JavaScript 專案，取得 DSN：`https://xxx@oxxx.ingest.sentry.io/yyy`

### Step 2 — index.html 引入 SDK（30 分鐘）
**檔案**：[index.html](index.html)（`<head>` 內，越早越好）

```html
<script
    src="https://browser.sentry-cdn.com/7.99.0/bundle.tracing.min.js"
    integrity="sha384-xxx"
    crossorigin="anonymous">
</script>
<script>
    Sentry.init({
        dsn: 'YOUR_SENTRY_DSN',
        release: 'booking-system@v2.38.6',
        environment: location.hostname === 'localhost' ? 'dev' : 'prod',
        integrations: [new Sentry.BrowserTracing()],
        tracesSampleRate: 0.2,  // 20% 取樣
        beforeSend(event) {
            // 移除敏感欄位
            if (event.user) delete event.user.email;
            return event;
        },
    });
</script>
```

### Step 3 — 加入使用者上下文（30 分鐘）
**檔案**：[app.js](app.js)（在 deviceId 確認後）

```javascript
Sentry.setUser({ id: deviceId });
Sentry.setTag('userRole', isAdmin ? 'admin' : 'user');
Sentry.setContext('app', {
    version: 'v2.38.6',
    swVersion: 'cache-v2.38.6',
});
```

### Step 4 — 包裝關鍵函式（半天）

```javascript
async function safeAsync(fn, contextName) {
    return Sentry.startSpan({ name: contextName }, async () => {
        try {
            return await fn();
        } catch (err) {
            Sentry.captureException(err, {
                tags: { feature: contextName }
            });
            throw err;
        }
    });
}

// 使用範例
await safeAsync(
    () => createBooking(data),
    'booking.create'
);
```

### Step 5 — 設定告警規則（30 分鐘）
在 Sentry 後台 → Alerts → 新增：
- 「同錯誤 1 小時內出現 5 次」 → Email + Slack
- 「新類型錯誤首次出現」 → 即時通知
- 「Performance: LCP > 4s」 → 每日摘要

## 📂 涉及檔案清單
- ✏️ [index.html](index.html) — `<head>` 引入 SDK
- ✏️ [app.js](app.js) — `setUser` + `safeAsync` 包裝
- ✏️ GitHub Secrets — `SENTRY_DSN`（避免硬編碼）

## ✅ 驗收標準
1. 故意 throw 一個錯誤，1 分鐘內 Sentry 後台看得到
2. Stack trace 含正確檔名與行號
3. 使用者觸發錯誤時不影響功能（不能因 Sentry 失敗而崩潰）

## ⚠️ 常見陷阱
- ❌ **DSN 寫在 HTML 是否安全？** → DSN 公開設計，本來就可寫在前端，但建議經 GitHub Action 注入避免硬編。
- ❌ **5K events 不夠？** → 解法：調 `tracesSampleRate: 0.05`（5% 取樣）。
- ❌ **CORS 錯誤** → 解法：檢查 Sentry 專案設定的 Allowed Domains。

## 💰 成本評估
- 免費方案：5K errors + 10K transactions/月（校用足夠 200% 以上）
- 升級方案 Team：USD $26/月（不需要）

---

# 🛠 F.1 Vitest + Playwright 測試覆蓋率

## 📌 為什麼要做
專案已 38 版仍無一條自動化測試，每次發版都靠手點「預約 → 衝突 → 取消 → 歷史 → 匯出」5 分鐘。  
**v2.34 月視圖衝突檢查失效**就是典型缺測試的回歸案例。

## 🎯 達成目標
- 核心邏輯（Rate Limit、衝突檢查、AI 建議）單元測試覆蓋率 ≥ 80%
- 主要使用者流程 E2E 自動測試
- GitHub Actions 每次 PR 自動跑測試

## 🛠 實作步驟（共 6 步，估時 10~14 天）

### Step 1 — 重構為可測試結構（3 天）
**問題**：`app.js` 是單一巨檔，全是 DOM 操作 + 邏輯混雜，難以單元測試。  
**解法**：抽離純邏輯成獨立模組：

```
lib/
  ├── rateLimit.js       — checkRateLimit, recordBooking
  ├── conflict.js        — detectConflict, findAlternatives
  ├── validators.js      — 預約欄位驗證
  ├── dateUtils.js       — getWeekStart, addDays, etc.
  └── csvExport.js       — toCsv, downloadCsv
```

每個檔案匯出純函式，不含 DOM/Firestore 依賴。

```javascript
// lib/rateLimit.js
export function checkRateLimit(records, now = new Date(), config = DEFAULT) {
    const oneHourAgo = now.getTime() - 3600_000;
    const oneDayAgo = now.getTime() - 86400_000;
    const hourly = records.filter(t => t > oneHourAgo).length;
    const daily = records.filter(t => t > oneDayAgo).length;
    if (hourly >= config.maxBookingsPerHour)
        return { allowed: false, reason: '...' };
    if (daily >= config.maxBookingsPerDay)
        return { allowed: false, reason: '...' };
    return { allowed: true };
}
```

### Step 2 — Vitest 設定（半天）

```bash
npm init -y
npm install -D vitest @vitest/ui happy-dom
```

**檔案**：建立 `vitest.config.js`

```javascript
import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        environment: 'happy-dom',
        coverage: {
            reporter: ['text', 'html'],
            include: ['lib/**/*.js'],
            thresholds: { lines: 80, branches: 75 },
        },
    },
});
```

### Step 3 — 撰寫單元測試（3 天）

```javascript
// tests/rateLimit.test.js
import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '../lib/rateLimit.js';

describe('checkRateLimit', () => {
    it('allows when under hourly limit', () => {
        const records = Array(10).fill(Date.now());
        const result = checkRateLimit(records, new Date(),
            { maxBookingsPerHour: 30, maxBookingsPerDay: 100 });
        expect(result.allowed).toBe(true);
    });

    it('blocks when over hourly limit', () => {
        const records = Array(31).fill(Date.now());
        const result = checkRateLimit(records, new Date(),
            { maxBookingsPerHour: 30, maxBookingsPerDay: 100 });
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('每小時');
    });

    it('cleans expired records', () => {
        const old = Date.now() - 25 * 3600_000;
        const records = [old, old, Date.now()];
        const result = checkRateLimit(records);
        expect(result.allowed).toBe(true);
    });
});
```

### Step 4 — Playwright E2E（4 天）

```bash
npm install -D @playwright/test
npx playwright install chromium
```

**檔案**：`tests/e2e/booking.spec.js`

```javascript
import { test, expect } from '@playwright/test';

test.describe('完整預約流程', () => {
    test('成功預約 → 出現於歷史紀錄', async ({ page }) => {
        await page.goto('http://localhost:8080');
        await page.click('[data-day="mon"][data-period="3"]');
        await page.fill('#bookerName', '測試老師');
        await page.fill('#reason', '單元測試');
        await page.click('#btnConfirmBooking');
        await expect(page.locator('.toast-success')).toBeVisible();
        await page.click('#btnHistory');
        await expect(page.locator('.history-item')).toContainText('測試老師');
    });

    test('衝突 → 顯示 AI 建議', async ({ page }) => {
        // ... 預約同一時段兩次
        await expect(page.locator('.ai-suggestions')).toBeVisible();
    });

    test('使用者自助取消', async ({ page }) => { /* ... */ });
});
```

### Step 5 — GitHub Actions 整合（1 天）
**檔案**：`.github/workflows/test.yml`

```yaml
name: Test
on: [pull_request, push]
jobs:
    unit:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
              with: { node-version: '20' }
            - run: npm ci
            - run: npm run test
            - run: npm run test:coverage
    e2e:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: actions/setup-node@v4
            - run: npm ci
            - run: npx playwright install --with-deps
            - run: npm run test:e2e
            - uses: actions/upload-artifact@v4
              if: failure()
              with: { name: playwright-report, path: playwright-report/ }
```

### Step 6 — 加入 README 徽章（10 分鐘）
```markdown
![Tests](https://github.com/USER/REPO/actions/workflows/test.yml/badge.svg)
![Coverage](https://img.shields.io/badge/coverage-80%25-brightgreen)
```

## 📂 涉及檔案清單
- ✨ 新增 `lib/` 全資料夾（重構抽離）
- ✨ 新增 `tests/` 全資料夾
- ✨ 新增 `vitest.config.js`、`playwright.config.js`
- ✨ 新增 `.github/workflows/test.yml`
- ✏️ [app.js](app.js) — import lib 模組

## ✅ 驗收標準
1. `npm test` 全綠
2. `npm run test:coverage` ≥ 80%
3. PR 觸發 CI 並阻擋失敗合併
4. E2E 失敗時上傳 trace 截圖

## ⚠️ 常見陷阱
- ❌ **抽離 lib 後原 app.js 大改動風險** → 解法：分批重構，先寫測試於原函式（直接 require app.js），測試通過後再抽離。
- ❌ **Playwright 對 Firestore 真實寫入會污染資料** → 解法：使用 Firebase Emulator 或測試環境專用 collection。
- ❌ **GitHub Actions 無頭瀏覽器吃記憶體** → 解法：限制平行度 `--workers=2`。

---

# 🛠 F.2 漸進式 TypeScript 遷移

## 📌 為什麼要做
v2.34 衝突 Bug 起因為「物件欄位 typo」(`bookerName` 寫成 `bookName`)，型別檢查能在編輯器即時抓出。

## 🎯 達成目標
- **不破壞** 現有 Vanilla JS 部署流程（不需 build step）
- 漸進加入型別檢查，編輯器即時提示
- 核心邏輯逐步轉 `.ts`

## 🛠 實作步驟（共 5 階段，估時 14~21 天）

### 階段一：開啟檢查模式（1 天，零改動風險）

```bash
npm install -D typescript @types/node
```

**檔案**：建立 `tsconfig.json`

```json
{
    "compilerOptions": {
        "target": "ES2020",
        "module": "ESNext",
        "moduleResolution": "node",
        "allowJs": true,
        "checkJs": true,
        "noEmit": true,
        "strict": false,
        "skipLibCheck": true,
        "lib": ["ES2020", "DOM"]
    },
    "include": ["app.js", "lib/**/*"]
}
```

執行 `npx tsc --noEmit` 即可看到既有 JS 的型別問題。

### 階段二：JSDoc 標註（5 天）
**範例**：

```javascript
/**
 * @typedef {Object} Booking
 * @property {string} id
 * @property {string} classroom
 * @property {string} date - 'YYYY-MM-DD'
 * @property {number[]} periods
 * @property {string} bookerName
 * @property {string} reason
 * @property {'active'|'cancelled'} status
 * @property {string} deviceId
 */

/**
 * @param {Booking[]} bookings
 * @param {string} date
 * @param {number} period
 * @returns {Booking | null}
 */
function findConflict(bookings, date, period) {
    return bookings.find(b => b.date === date && b.periods.includes(period)) || null;
}
```

### 階段三：核心模組轉 .ts（5 天）
順序建議：
1. `lib/rateLimit.js` → `lib/rateLimit.ts`
2. `lib/conflict.ts`
3. `lib/dateUtils.ts`
4. `lib/types.ts`（集中定義 Interfaces）

```typescript
// lib/types.ts
export interface Booking {
    id: string;
    classroom: ClassroomId;
    date: string;  // YYYY-MM-DD
    periods: number[];
    bookerName: string;
    reason: string;
    status: 'active' | 'cancelled';
    deviceId: string;
}

export type ClassroomId =
    | 'auditorium'
    | 'computer_room'
    | 'forest_house'
    | `ipad_g${3 | 4 | 5 | 6}`;
```

### 階段四：建置流程（3 天）
若決定進入編譯模式：

```json
// package.json
"scripts": {
    "build": "tsc && cp -r lib/dist/* dist/",
    "dev": "tsc --watch"
}
```

但若希望維持「無建置直接部署 GitHub Pages」，可改用 **esbuild** 一行打包：

```bash
npx esbuild app.ts --bundle --outfile=app.js --format=iife
```

### 階段五：CI 強制檢查（1 天）

```yaml
- run: npx tsc --noEmit
```

## 📂 涉及檔案清單
- ✨ 新增 `tsconfig.json`、`lib/types.ts`
- ✏️ 漸進改檔名 `.js` → `.ts`
- ✏️ `.github/workflows/test.yml` 加 tsc 檢查

## ✅ 驗收標準
1. `npx tsc --noEmit` 零錯誤
2. VSCode 自動提示 Booking 物件欄位
3. 部署流程不受影響

## ⚠️ 常見陷阱
- ❌ **`strict: true` 一開全部紅** → 解法：先 `strict: false`，再逐步開啟 `noImplicitAny → strictNullChecks → strict`。
- ❌ **既有 firebase compat SDK 型別不全** → 解法：`@types/firebase` 已過時，改用 v9 modular SDK。
- ❌ **GitHub Pages 不支援 .ts** → 解法：本地 build 後 commit `dist/`，或改用 esbuild 打包到 `app.js`。

## 💡 加分項
- 啟用 ESLint + `@typescript-eslint`，搭配 Prettier 統一風格
- 使用 `zod` 在執行期驗證 Firestore 回傳資料是否符合 Booking 型別

---

# 🎯 完整施工建議路線圖

## 第 1 週（速勝期）
| 天 | 任務 | 工時 |
| :---: | :--- | :---: |
| Day 1 | F.3 Sentry 整合 | 1 天 |
| Day 2 | 1.7 一鍵重複預約 | 1 天 |
| Day 3-5 | 1.8 稽核日誌 | 3 天 |

✅ **產出**：使用者立即感受效率提升，Bug 從此可被觀測。

## 第 2-3 週（穩固期）
| 天 | 任務 |
| :---: | :--- |
| Day 6-15 | F.1 測試覆蓋率（重構 lib + Vitest + Playwright） |

✅ **產出**：未來改動有信心，回歸 Bug 大幅減少。

## 第 4-7 週（擴張期）
| 天 | 任務 |
| :---: | :--- |
| Day 16-21 | 1.6 Web Push + Cloud Functions |
| Day 22-35 | F.2 漸進式 TypeScript |

✅ **產出**：通知能力解鎖，程式碼長期可維護。

## 第 8-12 週（亮點期）
| 天 | 任務 |
| :---: | :--- |
| Day 36-50 | 3.3 AI 學期白皮書 |

✅ **產出**：自動化長報表，可作為展示型功能。

---

# 📋 共通開發守則（每次開工請對照）

## 開工前
- [ ] `git pull` 確保最新
- [ ] 開新分支：`git checkout -b feature/xxx`
- [ ] 確認 `firebase emulators:start` 可正常啟動

## 開發中
- [ ] 小步提交（每完成一個 step 就 commit）
- [ ] 用 [Conventional Commits](https://www.conventionalcommits.org/) 格式
- [ ] 每次寫程式碼前先寫測試（TDD 為佳）

## 收工前
- [ ] `npx tsc --noEmit` 通過（如已導入）
- [ ] `npm test` 通過
- [ ] 手動測試桌面 + 手機各一遍
- [ ] **更新版號**：`app.js` / `sw.js` / `index.html` / `README.md`
- [ ] **同步更新** [PROGRESS.md](./PROGRESS.md)
- [ ] 寫 PR 描述（含截圖、測試步驟）

## 部署後
- [ ] 開啟匿名瀏覽器確認 SW 已更新
- [ ] 觀察 Sentry 24 小時是否有新錯誤
- [ ] 詢問 1~2 位老師實測回饋

---

> [!TIP]
> **不要一次做完 7 項！** 強烈建議按上述路線圖分週施工，每週都有可發布的成果，避免長期 PR 風險。

> [!IMPORTANT]
> **每項提案開工前**，先到 [FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) 確認是否有其他相依項目，例如 1.6 Web Push 在 1.5 智慧速率限流 v2 之前做也行，但同時做能共用 Cloud Functions 結構。

> [!WARNING]
> **GCP 預算控管**：1.6、3.3、F.3 都會用到 Cloud Functions / 第三方 API。建議在 GCP Console 設定 **每月 NT$300 上限警示**，超過時自動寄信。

---

*文件版本 v1.0 │ 最後更新：2026-04-19 │ 配套版本：FUTURE_PROPOSAL v2.38.6+*
