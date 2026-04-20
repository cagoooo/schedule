/**
 * 禮堂&專科教室&IPAD平板車預約系統 - 核心應用邏輯
 * 使用 Firebase Firestore + Auth 進行資料存取與驗證
 */

// Firebase 設定已移至 config.js 並由 .gitignore 排除

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const bookingsCollection = db.collection('bookings');
// v2.41.0 (M.1): 場地公告 collection
const announcementsCollection = db.collection('roomAnnouncements');

// ===== v2.42.0 (C.1): IndexedDB 本地快取 (Firestore Offline Persistence) =====
// 啟用後 Firestore SDK 自動將資料快取到 IndexedDB:
// - 切換週次/重複查詢時優先讀本地 (零延遲)
// - 離線可繼續使用 (背景排隊, 上線時自動同步)
// - 預期降低 Firestore 讀取量 60~70%
let firestoreCacheReady = false;
let firestoreCacheError = null;

(function initFirestorePersistence() {
    db.enablePersistence({ synchronizeTabs: true })
        .then(() => {
            firestoreCacheReady = true;
            console.log('[Cache] ✅ IndexedDB persistence enabled (multi-tab sync)');
        })
        .catch((err) => {
            firestoreCacheError = err.code;
            if (err.code === 'failed-precondition') {
                console.warn('[Cache] ⚠ Multiple tabs open — only one tab can have persistence');
            } else if (err.code === 'unimplemented') {
                console.warn('[Cache] ⚠ Browser does not support IndexedDB persistence');
            } else {
                console.error('[Cache] ❌ Persistence failed:', err);
            }
        });
})();

// v2.42.0 (C.1): Firestore 查詢統計 (顯示快取命中率供管理員觀察)
const cacheStats = {
    totalQueries: 0,
    fromCache: 0,
    fromServer: 0,
};

/**
 * 包裝 Firestore .get() 收集快取統計
 * @param {firebase.firestore.Query} query
 * @returns {Promise<QuerySnapshot>}
 */
async function statsTrackedGet(query) {
    cacheStats.totalQueries += 1;
    const snap = await query.get();
    if (snap.metadata && snap.metadata.fromCache) {
        cacheStats.fromCache += 1;
    } else {
        cacheStats.fromServer += 1;
    }
    return snap;
}

/**
 * 取得快取命中率 (供管理員觀察)
 */
function getCacheHitRate() {
    if (cacheStats.totalQueries === 0) return 0;
    return Math.round((cacheStats.fromCache / cacheStats.totalQueries) * 100);
}

// ===== 常數設定 =====
const PERIODS = [
    { id: 'morning', name: '晨間/早會', time: '07:50~08:30' },
    { id: 'period1', name: '第一節', time: '08:40~09:20' },
    { id: 'period2', name: '第二節', time: '09:30~10:10' },
    { id: 'period3', name: '第三節', time: '10:30~11:10' },
    { id: 'period4', name: '第四節', time: '11:20~12:00' },
    { id: 'lunch', name: '午餐/午休', time: '12:00~12:40' },
    { id: 'period5', name: '第五節', time: '13:00~13:40' },
    { id: 'period6', name: '第六節', time: '13:50~14:30' },
    { id: 'period7', name: '第七節', time: '14:40~15:20' },
    { id: 'period8', name: '第八節', time: '15:30~16:10' }
];

const ROOMS = [
    "禮堂", "智慧教室C304", "電腦教室(一)C212", "電腦教室(二)C213", "森林小屋",
    "三年級IPAD車(28台)", "四年級IPAD車(28台)", "五年級IPAD車(28台)", "六年級IPAD車(29台)", "校史室"
];

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// ===== 全域狀態 =====
let currentWeekStart = getMonday(new Date());
let currentMonth = new Date();
let bookings = [];
let monthBookings = [];
let selectedDate = null;
let isLoading = false;
let displayMode = 'week'; // 'week' 或 'range'
let viewMode = 'week'; // 'week' 或 'month'
let rangeStartDate = null;
let rangeEndDate = null;
let currentUser = null;
let unavailableSlots = []; // 當前場地的不開放時段 (例如: ["mon_period1", "wed_lunch"])

// ===== Rate Limiting 設定 =====
const RATE_LIMIT = {
    maxBookingsPerHour: 30,      // 每小時最多預約次數
    maxBookingsPerDay: 100,     // 每天最多預約次數
    storageKey: 'bookingRateLimit'
};

// ===== v2.40.0 (V.2): 場地常用置頂 (Room Usage Tracker) =====
const ROOM_USAGE_KEY = 'roomUsageCount';

/**
 * 預約成功時呼叫，累積該場地使用次數
 * @param {string} room
 */
function incrementRoomUsage(room) {
    if (!room) return;
    const counts = JSON.parse(localStorage.getItem(ROOM_USAGE_KEY) || '{}');
    counts[room] = (counts[room] || 0) + 1;
    localStorage.setItem(ROOM_USAGE_KEY, JSON.stringify(counts));
}

/**
 * 取得場地使用次數 map
 */
function getRoomUsageCounts() {
    return JSON.parse(localStorage.getItem(ROOM_USAGE_KEY) || '{}');
}

/**
 * 重排場地下拉選單：依使用次數降序，前 3 名加 ⭐ 標記
 * 同時更新主選單 (#roomSelect) 與彈窗選單 (#modalRoomSelect)
 */
function sortRoomDropdownByUsage() {
    const counts = getRoomUsageCounts();
    const ids = ['roomSelect', 'modalRoomSelect'];

    ids.forEach(id => {
        const select = document.getElementById(id);
        if (!select || select.options.length < 2) return;

        const currentValue = select.value;
        const items = Array.from(select.options).map(opt => ({
            value: opt.value,
            label: opt.textContent.replace(/^⭐\s/, '').trim(), // 清掉舊星號
            count: counts[opt.value] || 0
        }));

        // 排序：先按 count desc，count 相同維持原 order (用 index 穩定)
        const originalOrder = items.map((it, i) => ({ ...it, originalIdx: i }));
        originalOrder.sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.originalIdx - b.originalIdx;
        });

        // 重建 options
        select.innerHTML = '';
        originalOrder.forEach((item, idx) => {
            const opt = document.createElement('option');
            opt.value = item.value;
            opt.textContent = (idx < 3 && item.count > 0) ? `⭐ ${item.label}` : item.label;
            select.appendChild(opt);
        });

        // 還原使用者選擇
        if (currentValue) select.value = currentValue;
    });
}

/**
 * 重設場地排序（清除使用次數紀錄）
 */
function resetRoomUsageSorting() {
    if (confirm('確定要重設場地排序嗎？這會清除您的使用次數紀錄。')) {
        localStorage.removeItem(ROOM_USAGE_KEY);
        location.reload();
    }
}

/**
 * 取得或建立裝置識別碼
 */
function getDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
}

/**
 * 檢查是否超過預約頻率限制
 */
function checkRateLimit() {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    let records = JSON.parse(localStorage.getItem(RATE_LIMIT.storageKey) || '[]');

    // 清理過期記錄
    records = records.filter(time => time > dayAgo);
    localStorage.setItem(RATE_LIMIT.storageKey, JSON.stringify(records));

    // 計算各時段預約次數
    const hourlyCount = records.filter(time => time > hourAgo).length;
    const dailyCount = records.length;

    if (hourlyCount >= RATE_LIMIT.maxBookingsPerHour) {
        return { allowed: false, reason: `每小時最多 ${RATE_LIMIT.maxBookingsPerHour} 次預約，請稍後再試` };
    }

    if (dailyCount >= RATE_LIMIT.maxBookingsPerDay) {
        return { allowed: false, reason: `每天最多 ${RATE_LIMIT.maxBookingsPerDay} 次預約，請明天再試` };
    }

    return { allowed: true };
}

/**
 * 記錄一次預約
 */
function recordBooking() {
    let records = JSON.parse(localStorage.getItem(RATE_LIMIT.storageKey) || '[]');
    records.push(Date.now());
    localStorage.setItem(RATE_LIMIT.storageKey, JSON.stringify(records));
}

// ===== 工具函數 =====

/**
 * 取得某日期所在週的週一
 */
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * 格式化日期為 YYYY/MM/DD
 */
function formatDate(date, separator = '/') {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${separator}${month}${separator}${day}`;
}

/**
 * 格式化日期為 YYYY-MM-DD（用於 input date）
 */
function formatDateISO(date) {
    return formatDate(date, '-');
}

/**
 * 解析日期字串
 */
function parseDate(dateStr) {
    const parts = dateStr.replace(/\//g, '-').split('-');
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * 判斷兩個日期是否為同一天
 */
function isSameDay(date1, date2) {
    return formatDate(date1) === formatDate(date2);
}

/**
 * 取得日期的週幾（中文）
 */
function getWeekdayName(date) {
    return WEEKDAYS[date.getDay()];
}

// ===== Firebase Auth =====

/**
 * 監聽登入狀態變化
 */
auth.onAuthStateChanged((user) => {
    currentUser = user;
    updateAuthUI();
});

/**
 * 更新登入 UI
 */
function updateAuthUI() {
    const btn = document.getElementById('btnAdminLogin');
    const text = document.getElementById('adminLoginText');

    if (currentUser) {
        btn.classList.add('logged-in');
        text.textContent = '已登入';
        document.getElementById('btnOpenSettings').style.display = 'flex';
        document.getElementById('btnOpenDashboard').style.display = 'flex';
        // v2.41.0 (M.1): 顯示場地公告管理按鈕
        const annBtn = document.getElementById('btnOpenAnnouncements');
        if (annBtn) annBtn.style.display = 'flex';
    } else {
        btn.classList.remove('logged-in');
        text.textContent = '管理員';
        document.getElementById('btnOpenSettings').style.display = 'none';
        document.getElementById('btnOpenDashboard').style.display = 'none';
        // v2.41.0 (M.1): 隱藏場地公告管理按鈕
        const annBtn = document.getElementById('btnOpenAnnouncements');
        if (annBtn) annBtn.style.display = 'none';
    }
}

/**
 * 開啟登入彈窗
 */
function openAuthModal() {
    document.getElementById('authEmail').value = '';
    document.getElementById('authPassword').value = '';
    document.getElementById('authError').textContent = '';
    document.getElementById('authModalOverlay').classList.add('active');
    document.getElementById('authEmail').focus();
}

/**
 * 關閉登入彈窗
 */
function closeAuthModal() {
    document.getElementById('authModalOverlay').classList.remove('active');
}

/**
 * 執行登入
 */
async function doLogin() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;

    if (!email || !password) {
        document.getElementById('authError').textContent = '請輸入帳號密碼';
        return;
    }

    try {
        await auth.signInWithEmailAndPassword(email, password);
        closeAuthModal();
        showToast('登入成功！', 'success');
    } catch (error) {
        console.error('登入失敗:', error);
        let msg = '登入失敗';
        if (error.code === 'auth/user-not-found') {
            msg = '帳號不存在';
        } else if (error.code === 'auth/wrong-password') {
            msg = '密碼錯誤';
        } else if (error.code === 'auth/invalid-email') {
            msg = 'Email 格式錯誤';
        }
        document.getElementById('authError').textContent = `${msg} (${error.code})`;
        console.error('完整錯誤資訊:', error);
    }
}

/**
 * 執行登出
 */
async function doLogout() {
    try {
        await auth.signOut();
        showToast('已登出', 'info');
    } catch (error) {
        console.error('登出失敗:', error);
    }
}

// ===== Firebase 資料存取 =====

/**
 * 顯示骨架屏載入動畫
 */
function renderSkeleton() {
    if (viewMode === 'week') {
        const grid = document.getElementById('calendarGrid');
        if (grid) {
            grid.innerHTML = '';
            // Render 7 skeleton days
            for (let i = 0; i < 7; i++) {
                const dayEl = document.createElement('div');
                dayEl.className = 'calendar-day skeleton-day';
                dayEl.innerHTML = `
                    <div class="day-header">
                        <div class="skeleton skeleton-text short"></div>
                    </div>
                    <div class="day-bookings">
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                        <div class="skeleton skeleton-card"></div>
                    </div>
                `;
                grid.appendChild(dayEl);
            }
        }
    } else {
        const grid = document.getElementById('monthCalendarGrid');
        if (grid) {
            grid.innerHTML = '';
            // Render 35 skeleton cells
            for (let i = 0; i < 35; i++) {
                const cell = document.createElement('div');
                cell.className = 'month-day skeleton-cell';
                cell.innerHTML = `
                    <div class="skeleton skeleton-text short" style="width: 30%;"></div>
                    <div class="skeleton skeleton-text" style="width: 60%; margin-top: auto;"></div>
                `;
                grid.appendChild(cell);
            }
        }
    }
}

/**
 * 從 Firestore 載入預約資料
 */
async function loadBookingsFromFirebase() {
    if (isLoading) return;
    isLoading = true;
    renderSkeleton();

    try {
        let queryStart, queryEnd;

        if (displayMode === 'range' && rangeStartDate && rangeEndDate) {
            queryStart = formatDate(rangeStartDate);
            queryEnd = formatDate(rangeEndDate);
        } else {
            queryStart = formatDate(currentWeekStart);
            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(currentWeekStart.getDate() + 6);
            queryEnd = formatDate(weekEnd);
        }

        const room = getSelectedRoom();
        // v2.42.0: 透過 statsTrackedGet 收集快取命中率
        const snapshot = await statsTrackedGet(
            bookingsCollection
                .where('date', '>=', queryStart)
                .where('date', '<=', queryEnd)
        );

        bookings = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const bookingRoom = data.room || '禮堂'; // 正規化場地
            if (bookingRoom === room) {
                bookings.push({ ...data, id: doc.id, room: bookingRoom });
            }
        });

        // v2.42.0: 若是快取資料, 提示使用者 (debug 用, 不打擾)
        if (snapshot.metadata?.fromCache) {
            console.log(`[Cache HIT] ${queryStart} ~ ${queryEnd} loaded from IndexedDB (${bookings.length} bookings)`);
        }

        // 載入場地不開放設定
        await loadRoomSettings(room);

        renderCalendar();
    } catch (error) {
        console.error('載入預約資料失敗:', error);
        showToast('載入資料失敗，請重新整理頁面', 'error');
    } finally {
        isLoading = false;
    }
}

/**
 * 取得當前選擇的場地
 */
function getSelectedRoom() {
    // 優先獲取彈窗內的場地選擇 (若彈窗開啟中)
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay && modalOverlay.classList.contains('active')) {
        return document.getElementById('modalRoomSelect').value;
    }
    return document.getElementById('roomSelect').value;
}

/**
 * 載入整月預約資料
 */
async function loadMonthBookings() {
    renderSkeleton();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const queryStart = formatDate(firstDay);
    const queryEnd = formatDate(lastDay);
    const room = getSelectedRoom();

    try {
        // v2.42.0: 透過 statsTrackedGet 收集快取命中率
        const snapshot = await statsTrackedGet(
            bookingsCollection
                .where('date', '>=', queryStart)
                .where('date', '<=', queryEnd)
        );

        monthBookings = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const bookingRoom = data.room || '禮堂'; // 正規化場地
            if (bookingRoom === room) {
                monthBookings.push({ ...data, id: doc.id, room: bookingRoom });
            }
        });

        if (snapshot.metadata?.fromCache) {
            console.log(`[Cache HIT] Month ${queryStart}~${queryEnd} from IndexedDB`);
        }

        // 載入場地不開放設定
        await loadRoomSettings(room);

        renderMonthCalendar();
    } catch (error) {
        console.error('載入月曆資料失敗:', error);
        showToast('載入資料失敗', 'error');
    }
}

/**
 * 新增預約到 Firestore
 */
async function addBookingToFirebase(bookingData) {
    try {
        const docRef = await bookingsCollection.add({
            ...bookingData,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error('新增預約失敗:', error);
        throw error;
    }
}

/**
 * 刪除 Firestore 中的預約
 */
async function deleteBookingFromFirebase(bookingId) {
    try {
        await bookingsCollection.doc(bookingId).delete();
    } catch (error) {
        console.error('刪除預約失敗:', error);
        throw error;
    }
}

/**
 * 更新 Firestore 中的預約
 */
async function updateBookingInFirebase(bookingId, data) {
    try {
        await bookingsCollection.doc(bookingId).update(data);
    } catch (error) {
        console.error('更新預約失敗:', error);
        throw error;
    }
}

// ===== 資料查詢 =====

/**
 * 取得整合後的目前所有載入預約 (去重)
 */
function getAllLoadedBookings() {
    const combined = [...bookings, ...monthBookings];
    const uniqueMap = new Map();
    combined.forEach(b => {
        const id = b.id || `${b.date}_${b.room}_${b.periods.join('_')}`; // 若無 ID (剛新增但未刷新)，建立虛擬 ID
        uniqueMap.set(id, b);
    });
    return Array.from(uniqueMap.values());
}

/**
 * 取得指定日期的預約清單
 */
function getBookingsByDate(date) {
    const dateStr = formatDate(date);
    const room = getSelectedRoom();
    return getAllLoadedBookings().filter(b => b.date === dateStr && b.room === room);
}

/**
 * 檢查指定日期時段是否已被預約
 */
function isPeriodBooked(date, periodId) {
    const dateStr = formatDate(date);
    const room = getSelectedRoom();
    return getAllLoadedBookings().some(b => b.date === dateStr && b.periods.includes(periodId) && b.room === room);
}

/**
 * 取得指定日期時段的預約者
 */
function getBookerForPeriod(date, periodId) {
    const dateStr = formatDate(date);
    const room = getSelectedRoom();
    const booking = getAllLoadedBookings().find(b => b.date === dateStr && b.periods.includes(periodId) && b.room === room);
    return booking ? booking.booker : null;
}

/**
 * 取得指定日期時段的預約資訊
 */
function getBookingForPeriod(date, periodId) {
    const dateStr = formatDate(date);
    const room = getSelectedRoom();
    return getAllLoadedBookings().find(b => b.date === dateStr && b.periods.includes(periodId) && b.room === room);
}

// ===== UI 渲染 =====

/**
 * 渲染週曆
 */
/**
 * 渲染週曆
 */
function renderCalendar() {
    // 防止非週曆模式下渲染
    if (viewMode !== 'week') return;

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let startDate, endDate, totalDays;

    if (displayMode === 'range' && rangeStartDate && rangeEndDate) {
        startDate = new Date(rangeStartDate);
        endDate = new Date(rangeEndDate);
        totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        document.getElementById('currentWeekLabel').textContent =
            `${formatDate(startDate)} ~ ${formatDate(endDate)} (${totalDays} 天)`;
    } else {
        startDate = new Date(currentWeekStart);
        endDate = new Date(currentWeekStart);
        endDate.setDate(endDate.getDate() + 6);
        totalDays = 7;

        document.getElementById('currentWeekLabel').textContent =
            `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
    }

    for (let i = 0; i < totalDays; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);

        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = isSameDay(date, today);

        const dayEl = document.createElement('div');
        dayEl.className = `calendar-day${isWeekend ? ' weekend' : ''}${isToday ? ' today' : ''}`;

        const headerEl = document.createElement('div');
        headerEl.className = `day-header${isWeekend ? ' weekend' : ''}`;
        headerEl.innerHTML = `
            <span class="day-date">
                ${formatDate(date).slice(5)}
                <span class="weekday">(${getWeekdayName(date)})</span>
            </span>
            <button class="btn-book" data-date="${formatDate(date)}">預約</button>
        `;
        dayEl.appendChild(headerEl);

        const bookingsEl = document.createElement('div');
        bookingsEl.className = 'day-bookings';

        const dayBookings = getBookingsByDate(date);

        PERIODS.forEach(period => {
            const booking = dayBookings.find(b => b.periods.includes(period.id));

            if (booking) {
                const cardEl = document.createElement('div');
                cardEl.className = 'booking-card';
                cardEl.innerHTML = `
                    <span class="booking-period">${period.name}</span>
                    <span class="booking-name">${booking.booker}</span>
                `;
                cardEl.title = `預約理由：${booking.reason || '無'}`;
                cardEl.addEventListener('click', () => showBookingDetail(booking, period));
                bookingsEl.appendChild(cardEl);
            }
        });

        dayEl.appendChild(bookingsEl);

        // 新增底部預約按鈕（手機端專用）
        const footerEl = document.createElement('div');
        footerEl.className = 'day-footer';
        footerEl.innerHTML = `
            <button class="btn-book-mobile" data-date="${formatDate(date)}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                預約 ${formatDate(date).slice(5)} (${getWeekdayName(date)})
            </button>
        `;
        dayEl.appendChild(footerEl);

        grid.appendChild(dayEl);
    }

    document.querySelectorAll('.btn-book').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookingModal(btn.dataset.date);
        });
    });

    // 手機端底部預約按鈕
    document.querySelectorAll('.btn-book-mobile').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookingModal(btn.dataset.date);
        });
    });
}

/**
 * 渲染月曆
 */
function renderMonthCalendar() {
    // 防止非月曆模式下渲染
    if (viewMode !== 'month') return;

    const grid = document.getElementById('monthCalendarGrid');
    grid.innerHTML = '';

    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // 更新標題
    document.getElementById('currentWeekLabel').textContent =
        `${year}年${month + 1}月`;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 該月第一天
    const firstDay = new Date(year, month, 1);
    // 該月最後一天
    const lastDay = new Date(year, month + 1, 0);

    // 日曆起始日（該週日）
    const startDay = new Date(firstDay);
    startDay.setDate(firstDay.getDate() - firstDay.getDay());

    // 日曆結束日（週六）
    const endDay = new Date(lastDay);
    endDay.setDate(lastDay.getDate() + (6 - lastDay.getDay()));

    // 統計每日預約數
    const bookingCountByDate = {};
    monthBookings.forEach(b => {
        if (!bookingCountByDate[b.date]) {
            bookingCountByDate[b.date] = 0;
        }
        bookingCountByDate[b.date] += b.periods.length;
    });

    // 生成日期格子
    const currentDate = new Date(startDay);
    while (currentDate <= endDay) {
        // 判斷是否為不開放時段
        const dayId = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][currentDate.getDay()];
        const isUnavailable = unavailableSlots.some(slot => slot.startsWith(dayId));

        if (isUnavailable) {
            // 在月曆模式下，如果該天有任一節次被封鎖，我們雖然不鎖全天，但渲染時需注意
            // 這裡簡單處理：只要有預約或不開放，都會顯示在月曆格子內
        }

        const dateStr = formatDate(currentDate);
        const isOtherMonth = currentDate.getMonth() !== month;
        const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
        const isToday = isSameDay(currentDate, today);

        // 取得當日所有預約
        const dayBookings = monthBookings.filter(b => b.date === dateStr);

        // 整理預約顯示資料 (展開每個節次)
        let displayItems = [];
        dayBookings.forEach(booking => {
            booking.periods.forEach(periodId => {
                const periodName = PERIODS.find(p => p.id === periodId)?.name || periodId;
                // 簡化節次名稱顯示
                let shortPeriodName = periodName;
                if (periodName.includes('第一節')) shortPeriodName = '1';
                else if (periodName.includes('第二節')) shortPeriodName = '2';
                else if (periodName.includes('第三節')) shortPeriodName = '3';
                else if (periodName.includes('第四節')) shortPeriodName = '4';
                else if (periodName.includes('第五節')) shortPeriodName = '5';
                else if (periodName.includes('第六節')) shortPeriodName = '6';
                else if (periodName.includes('第七節')) shortPeriodName = '7';
                else if (periodName.includes('第八節')) shortPeriodName = '8';
                else if (periodName.includes('晨間')) shortPeriodName = '晨';
                else if (periodName.includes('午餐')) shortPeriodName = '午';

                displayItems.push({
                    periodId: periodId,
                    periodName: shortPeriodName,
                    booker: booking.booker,
                    fullPeriodName: periodName
                });
            });
        });

        // 排序節次
        const periodOrder = PERIODS.map(p => p.id);
        displayItems.sort((a, b) => periodOrder.indexOf(a.periodId) - periodOrder.indexOf(b.periodId));

        const dayEl = document.createElement('div');
        dayEl.className = 'month-day';
        if (isOtherMonth) dayEl.classList.add('other-month');
        if (isWeekend) dayEl.classList.add('weekend');
        if (isToday) dayEl.classList.add('today');

        // v2.40.0 (V.3): 衝突時段預警染色 (依該日當前場地的已預約節次數)
        const totalPeriods = PERIODS.length; // 10
        const bookedSlots = displayItems.length;
        const ratio = bookedSlots / totalPeriods;
        let heatLevel = 'free';
        if (ratio >= 0.9) heatLevel = 'full';
        else if (ratio >= 0.6) heatLevel = 'busy';
        else if (ratio >= 0.3) heatLevel = 'medium';
        else if (ratio > 0) heatLevel = 'light';
        dayEl.classList.add(`heat-${heatLevel}`);
        dayEl.dataset.bookedCount = `${bookedSlots}/${totalPeriods}`;

        let bookingsHtml = '';
        if (displayItems.length > 0) {
            bookingsHtml = `<div class="month-day-bookings">`;
            // 最多顯示 3 筆，超過顯示更多
            const maxDisplay = 3;
            displayItems.slice(0, maxDisplay).forEach(item => {
                bookingsHtml += `
                    <div class="month-booking-item" title="${item.fullPeriodName} - ${item.booker}">
                        <span class="mb-period">${item.periodName}</span>
                        <span class="mb-booker">${item.booker}</span>
                    </div>
                `;
            });

            if (displayItems.length > maxDisplay) {
                bookingsHtml += `
                    <div class="month-booking-more">
                        +${displayItems.length - maxDisplay} 更多
                    </div>
                `;
            }
            bookingsHtml += `</div>`;
        }

        dayEl.innerHTML = `
            <div class="month-day-header">
                <span class="month-day-date">${currentDate.getDate()}</span>
            </div>
            ${bookingsHtml}
        `;

        // 點擊直接開啟預約彈窗 (優化 UX)
        const clickDateStr = dateStr;
        dayEl.addEventListener('click', () => {
            openBookingModal(clickDateStr);
        });

        // v2.40.0 (V.4): 月視圖 hover 預覽 (詳細預約資訊)
        if (displayItems.length > 0) {
            dayEl.addEventListener('mouseenter', () => {
                showMonthDayTooltip(dayEl, clickDateStr, displayItems);
            });
            dayEl.addEventListener('mouseleave', hideMonthDayTooltip);

            // 手機長按 (touchstart 700ms)
            let touchTimer = null;
            dayEl.addEventListener('touchstart', () => {
                touchTimer = setTimeout(() => {
                    showMonthDayTooltip(dayEl, clickDateStr, displayItems);
                }, 700);
            }, { passive: true });
            dayEl.addEventListener('touchend', () => {
                if (touchTimer) clearTimeout(touchTimer);
            });
            dayEl.addEventListener('touchmove', () => {
                if (touchTimer) clearTimeout(touchTimer);
            }, { passive: true });
        }

        grid.appendChild(dayEl);
        currentDate.setDate(currentDate.getDate() + 1);
    }
}

// ===== v2.40.0 (V.4): 月視圖 hover Tooltip =====

let monthDayTooltipEl = null;

function ensureMonthDayTooltip() {
    if (monthDayTooltipEl) return monthDayTooltipEl;
    monthDayTooltipEl = document.createElement('div');
    monthDayTooltipEl.className = 'month-day-tooltip';
    monthDayTooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(monthDayTooltipEl);
    return monthDayTooltipEl;
}

function showMonthDayTooltip(anchorEl, dateStr, items) {
    const tip = ensureMonthDayTooltip();
    const lines = items.map(it =>
        `<div class="mdt-row"><span class="mdt-period">${it.fullPeriodName}</span><span class="mdt-booker">${it.booker}</span></div>`
    ).join('');
    tip.innerHTML = `
        <div class="mdt-header">📅 ${dateStr} <span class="mdt-count">(${items.length} 筆)</span></div>
        <div class="mdt-body">${lines}</div>
        <div class="mdt-hint">點擊日期可預約其他節次</div>
    `;

    // 計算位置：靠 anchor 上方，超出視窗則改下方
    const rect = anchorEl.getBoundingClientRect();
    tip.style.visibility = 'hidden';
    tip.classList.add('visible');
    const tipRect = tip.getBoundingClientRect();

    let top = rect.top + window.scrollY - tipRect.height - 8;
    let left = rect.left + window.scrollX + (rect.width - tipRect.width) / 2;

    // 邊界保護
    const margin = 8;
    if (top < window.scrollY + margin) {
        top = rect.bottom + window.scrollY + 8;
    }
    if (left < margin) left = margin;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - tipRect.width - margin;
    if (left > maxLeft) left = maxLeft;

    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
    tip.style.visibility = 'visible';
}

function hideMonthDayTooltip() {
    if (monthDayTooltipEl) monthDayTooltipEl.classList.remove('visible');
}

/**
 * 切換視圖模式
 */
function switchView(mode) {
    console.log('Switching view to:', mode);
    viewMode = mode;

    // 更新按鈕狀態
    document.getElementById('btnViewWeek').classList.toggle('active', mode === 'week');
    document.getElementById('btnViewMonth').classList.toggle('active', mode === 'month');

    const calendarGrid = document.getElementById('calendarGrid');
    const monthCalendar = document.getElementById('monthCalendar');

    if (mode === 'week') {
        console.log('Showing Week View');

        // 顯示週曆
        calendarGrid.classList.remove('hidden');
        calendarGrid.classList.add('fade-in');
        calendarGrid.style.removeProperty('display'); // 清除 inline style，讓 CSS 控制

        // 隱藏月曆並清空內容
        monthCalendar.classList.add('hidden');
        monthCalendar.classList.remove('fade-in');
        monthCalendar.style.removeProperty('display'); // 清除 inline style
        document.getElementById('monthCalendarGrid').innerHTML = '';

        loadBookingsFromFirebase();
    } else {
        console.log('Showing Month View');

        // 隱藏週曆並清空內容
        calendarGrid.classList.add('hidden');
        calendarGrid.classList.remove('fade-in');
        calendarGrid.style.removeProperty('display'); // 清除 inline style
        calendarGrid.innerHTML = '';

        // 顯示月曆
        monthCalendar.classList.remove('hidden');
        monthCalendar.classList.add('fade-in');
        monthCalendar.style.removeProperty('display'); // 清除 inline style

        loadMonthBookings();
    }

    // 自動滾動到日曆區域（改善手機端 UX）
    const calendarContainer = document.querySelector('.calendar-container');
    if (calendarContainer) {
        setTimeout(() => {
            calendarContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}

/**
 * 渲染節次勾選框
 */
function renderPeriodCheckboxes(date) {
    const container = document.getElementById('periodCheckboxes');
    container.innerHTML = '';

    PERIODS.forEach(period => {
        const isBooked = isPeriodBooked(parseDate(date), period.id);
        const booker = getBookerForPeriod(parseDate(date), period.id);

        // 檢查固定不開放
        const dateObj = parseDate(date);
        const dayId = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dateObj.getDay()];
        const slotId = `${dayId}_${period.id}`;
        const isUnavailable = unavailableSlots.includes(slotId);

        const isDisabled = isBooked || isUnavailable;
        const statusTip = isUnavailable ? '固定不開放時段' : (isBooked ? `已被 ${booker} 預約` : '可預約');

        const checkboxEl = document.createElement('div');
        checkboxEl.className = `period-checkbox ${isUnavailable ? 'unavailable' : ''}`;

        let labelContent = period.name;
        if (isUnavailable) {
            labelContent += ' <span class="lock-icon">🔒</span>';
        } else if (isBooked) {
            // 若被預約，顯示找空檔按鈕 (僅限非固定不開放)
            labelContent += ` <span class="booked-info">(${booker})</span>`;
        }

        checkboxEl.innerHTML = `
            <input type="checkbox" 
                   id="period_${period.id}" 
                   value="${period.id}"
                   ${isDisabled ? 'disabled' : ''}>
            <label for="period_${period.id}"
                   title="${statusTip}">
                ${labelContent}
            </label>
            ${isBooked && !isUnavailable ? `<button type="button" class="btn-find-alt" onclick="showSmartSuggestions('${period.id}')">🔍 找空檔</button>` : ''}
        `;
        container.appendChild(checkboxEl);
    });
}

// ===== 預約彈窗操作 =====

/**
 * 開啟預約彈窗
 */
function openBookingModal(dateStr) {
    selectedDate = dateStr;

    // 初始化批次日曆顯示月份為所選日期之月份
    const parsed = parseDate(dateStr);
    batchDisplayMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);

    document.getElementById('modalDate').textContent = dateStr;
    document.getElementById('modalRoomSelect').value = getSelectedRoom(); // 同步當前選單場地
    document.getElementById('bookerName').value = '';
    document.getElementById('bookingReason').value = '';
    document.getElementById('repeatBooking').checked = false;
    document.getElementById('repeatEndDate').value = '';
    document.getElementById('repeatEndDate').disabled = true;

    const date = parseDate(dateStr);
    document.getElementById('repeatFrequency').textContent = `每週${getWeekdayName(date)}`;

    // 重置並隱藏建議區域
    document.getElementById('smartSuggestions').classList.add('hidden');
    document.getElementById('suggestionsList').innerHTML = '';

    renderPeriodCheckboxes(dateStr);

    // v2.41.0 (M.1): 顯示場地公告 banner
    try {
        renderAnnouncementBannerInBookingModal(getSelectedRoom(), dateStr);
    } catch (e) { /* announcements not yet loaded */ }

    document.getElementById('modalOverlay').classList.add('active');
}

/**
 * 高亮並捲動至無效欄位
 * @param {string|HTMLElement} elementId 或 元素本體
 */
function highlightInvalidField(elementId) {
    const el = typeof elementId === 'string' ? document.getElementById(elementId) : elementId;
    if (!el) return;

    // 移除可能存在的舊類別
    el.classList.remove('invalid-shake');
    // 強制重繪以重啟動畫
    void el.offsetWidth;
    // 加入高亮類別
    el.classList.add('invalid-shake');

    // 自動捲動至視窗中心
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 3秒後移除高亮效果，讓 UI 恢復正常
    setTimeout(() => {
        el.classList.remove('invalid-shake');
    }, 3000);
}

/**
 * 關閉預約彈窗
 */
function closeBookingModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    selectedDate = null;
}

/**
 * 一鍵重複預約：以歷史紀錄為範本，預約「下週同日」
 * 若原日期已過去多週，自動推進至最近一個未來的同星期日期
 * @param {Object} booking 原預約資料 (含 room, periods, booker, reason, date)
 */
async function quickRebook(booking) {
    if (!booking || !booking.date || !Array.isArray(booking.periods)) {
        showToast('預約資料有誤，無法重複預約', 'error');
        return;
    }

    // 計算下個未來的同星期日期 (原日期 + 7n 天，且 > 今天)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextDate = parseDate(booking.date);
    do {
        nextDate.setDate(nextDate.getDate() + 7);
    } while (nextDate <= today);

    const newDateStr = formatDate(nextDate);

    // 關閉所有可能的來源彈窗 (歷史紀錄 + 搜尋結果)，避免多層彈窗重疊
    // v2.41.3: 補上搜尋彈窗 (原本只關歷史)
    ['historyModalOverlay', 'searchModalOverlay'].forEach(id => {
        const overlay = document.getElementById(id);
        if (overlay && overlay.classList.contains('active')) {
            overlay.classList.remove('active');
        }
    });

    // 同步切換主頁面下拉選單到該場地，讓背景週曆顯示正確
    const mainRoomSelect = document.getElementById('roomSelect');
    if (mainRoomSelect && booking.room) {
        const exists = Array.from(mainRoomSelect.options).some(o => o.value === booking.room);
        if (exists) {
            mainRoomSelect.value = booking.room;
            mainRoomSelect.dispatchEvent(new Event('change'));
        }
    }

    // 略等資料載入後再開啟預約彈窗
    setTimeout(() => {
        openBookingModal(newDateStr);

        // 預填欄位
        if (booking.room) {
            const modalRoomSelect = document.getElementById('modalRoomSelect');
            const exists = modalRoomSelect && Array.from(modalRoomSelect.options).some(o => o.value === booking.room);
            if (exists) modalRoomSelect.value = booking.room;
        }
        document.getElementById('bookerName').value = booking.booker || '';
        document.getElementById('bookingReason').value = booking.reason || '';

        // 勾選相同節次（已被預約的節次將維持 disabled）
        booking.periods.forEach(pid => {
            const cb = document.querySelector(`#periodCheckboxes input[value="${pid}"]`);
            if (cb && !cb.disabled) cb.checked = true;
        });

        // 修改彈窗標題為「快速續訂」模式
        const modalDateEl = document.getElementById('modalDate');
        if (modalDateEl) {
            modalDateEl.textContent = `🔁 快速續訂 ${newDateStr}`;
        }

        // 友善提示
        showToast(`已套用範本到 ${newDateStr}，請確認後送出`, 'success');
    }, 200);
}

/**
 * 提交預約
 */
async function submitBooking() {
    // Rate Limiting 檢查
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
        showToast(rateCheck.reason, 'error');
        return;
    }

    const booker = document.getElementById('bookerName').value.trim();
    const reason = document.getElementById('bookingReason').value.trim();
    const repeatChecked = document.getElementById('repeatBooking').checked;
    const repeatEndDate = document.getElementById('repeatEndDate').value;

    const selectedPeriods = [];
    document.querySelectorAll('#periodCheckboxes input:checked').forEach(input => {
        selectedPeriods.push(input.value);
    });

    if (!booker) {
        showToast('請輸入預約者姓名', 'warning');
        highlightInvalidField('bookerName');
        return;
    }

    if (selectedPeriods.length === 0) {
        showToast('請至少選擇一個節次', 'warning');
        highlightInvalidField('periodCheckboxes');
        return;
    }

    if (!reason) {
        showToast('請輸入預約理由', 'warning');
        highlightInvalidField('bookingReason');
        return;
    }

    const room = document.getElementById('modalRoomSelect').value;

    // 整合預約日期：主日期 + 批次日期
    let datesToBook = [selectedDate];
    const isBatchMode = document.getElementById('batchBooking').checked;
    if (isBatchMode && batchSelectedDates.length > 0) {
        // 使用 Set 確保日期不重複（例如主日期可能也在批次清單中）
        datesToBook = Array.from(new Set([...datesToBook, ...batchSelectedDates]));
    }

    // 處理重複預約邏輯（僅針對主選取日期進行週重複擴展，這是目前的設計行為）
    if (repeatChecked && repeatEndDate) {
        const startDate = parseDate(selectedDate);
        const endDate = new Date(repeatEndDate);

        let currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + 7);

        while (currentDate <= endDate) {
            const repeatDateStr = formatDate(currentDate);
            if (!datesToBook.includes(repeatDateStr)) {
                datesToBook.push(repeatDateStr);
            }
            currentDate.setDate(currentDate.getDate() + 7);
        }
    }

    // 檢查所有日期的固定不開放時段
    for (const dateStr of datesToBook) {
        const dateObj = parseDate(dateStr);
        const dayId = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dateObj.getDay()];
        for (const periodId of selectedPeriods) {
            const slotId = `${dayId}_${periodId}`;
            if (unavailableSlots.includes(slotId)) {
                showToast(`${dateStr} 的 ${PERIODS.find(p => p.id === periodId).name} 為固定禁排時段`, 'error');
                return;
            }
        }
    }

    // v2.41.0 (M.1): 公告鎖定檢查 — 若任一日期該場地有 lockBookings 公告，禁止預約
    for (const dateStr of datesToBook) {
        if (isRoomLockedByAnnouncement(room, dateStr)) {
            const lockedAnn = getActiveAnnouncements(room, dateStr).find(a => a.lockBookings);
            showToast(`🔒 ${dateStr} ${room} 已被公告鎖定：${lockedAnn?.message || '請見公告 banner'}`, 'error');
            return;
        }
    }

    const submitBtn = document.getElementById('btnModalSubmit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>處理中...</span>';

    try {
        for (const dateStr of datesToBook) {
            const snapshot = await bookingsCollection
                .where('date', '==', dateStr)
                .where('room', '==', room) // 檢查該場地的衝突
                .get();

            for (const doc of snapshot.docs) {
                const booking = doc.data();
                for (const periodId of selectedPeriods) {
                    if (booking.periods.includes(periodId)) {
                        const period = PERIODS.find(p => p.id === periodId);
                        showToast(`${dateStr} ${period.name} 已被 ${booking.booker} 預約`, 'error');
                        throw new Error('衝突');
                    }
                }
            }
        }

        const batch = db.batch();
        const createdRefs = []; // v2.40.0: 追蹤新建立 ID 供「撤銷」使用
        for (const dateStr of datesToBook) {
            const docRef = bookingsCollection.doc();
            createdRefs.push(docRef);
            batch.set(docRef, {
                date: dateStr,
                room: room, // 儲存場地資訊
                periods: selectedPeriods,
                booker: booker,
                reason: reason,
                deviceId: getDeviceId(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        await batch.commit();
        recordBooking(); // 記錄本次預約用於 Rate Limiting

        // v2.40.0: V.2 累積該場地使用次數供「常用置頂」排序
        try { incrementRoomUsage(room); } catch (e) { /* silent */ }

        // v2.43.0 (1.8): 稽核日誌 - 記錄預約建立
        logSystemAction('CREATE_BOOKING', {
            booker, room, periods: selectedPeriods, reason,
            dates: datesToBook,
            count: datesToBook.length,
            createdIds: createdRefs.map(r => r.id),
        }, createdRefs.map(r => r.id).join(','));

        // 預約成功後，若是批次模式則重置狀態
        if (isBatchMode) {
            batchSelectedDates = [];
            const batchBookingCheckbox = document.getElementById('batchBooking');
            if (batchBookingCheckbox) batchBookingCheckbox.checked = false;
            const batchContainer = document.getElementById('batchBookingContainer');
            if (batchContainer) batchContainer.classList.add('hidden');
            updateSelectedDatesDisplay();
        }

        await loadBookingsFromFirebase();
        closeBookingModal();

        const msg = datesToBook.length > 1
            ? `已成功預約 ${datesToBook.length} 個日期`
            : '預約成功！';

        // v2.40.0: V.5 預約撤銷按鈕 (Gmail 風格)
        showToast(msg, 'success', {
            action: {
                label: '↩ 撤銷',
                countdown: 30,
                onClick: () => undoRecentBookings(createdRefs.map(r => r.id))
            }
        });

    } catch (error) {
        if (error.message !== '衝突') {
            console.error('預約失敗:', error);
            showToast('預約失敗，請稍後再試', 'error');
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            預約
        `;
    }
}

/**
 * 顯示預約詳情
 */
let pendingDeleteBooking = null;
let pendingDeletePeriod = null;

function showBookingDetail(booking, period) {
    pendingDeleteBooking = booking;
    pendingDeletePeriod = period;

    const periodName = period ? period.name : '全部節次 (整筆刪除)';

    // 顯示預約詳情給所有人看
    document.getElementById('deleteBookingInfo').innerHTML = `
        <div class="info-item">
            <strong>日期：</strong>
            <span>${booking.date}</span>
        </div>
        <div class="info-item">
            <strong>節次：</strong>
            <span>${periodName}</span>
        </div>
        <div class="info-item">
            <strong>預約者：</strong>
            <span>${booking.booker}</span>
        </div>
        <div class="info-item">
            <strong>理由：</strong>
            <span>${booking.reason || '無'}</span>
        </div>
    `;

    // 根據登入狀態或 DeviceId 顯示不同的取消按鈕文字
    const deleteBtn = document.getElementById('btnDeleteConfirm');
    const localDeviceId = localStorage.getItem('deviceId');
    const isOwner = booking.deviceId && booking.deviceId === localDeviceId;

    if (currentUser) {
        deleteBtn.textContent = '取消預約';
        deleteBtn.style.display = 'block';
    } else if (isOwner) {
        deleteBtn.textContent = '取消預約 (我的預約)';
        deleteBtn.style.display = 'block';
    } else {
        deleteBtn.textContent = '登入後取消';
        // 若非管理員也非本人，保留按鈕但點擊會提示登入，維持各種 UX 一致性
    }

    document.getElementById('deleteModalOverlay').classList.add('active');
}

/**
 * 關閉刪除確認彈窗
 */
function closeDeleteModal() {
    document.getElementById('deleteModalOverlay').classList.remove('active');
    pendingDeleteBooking = null;
    pendingDeletePeriod = null;
}

/**
 * 執行刪除預約
 */
async function executeDeleteBooking() {
    if (!pendingDeleteBooking) return;

    const localDeviceId = localStorage.getItem('deviceId');
    const isOwner = pendingDeleteBooking.deviceId && pendingDeleteBooking.deviceId === localDeviceId;

    // 檢查是否已登入 或 是擁有者
    if (!currentUser && !isOwner) {
        closeDeleteModal();
        showToast('請先登入管理員帳號', 'warning');
        openAuthModal();
        return;
    }

    const deleteBtn = document.getElementById('btnDeleteConfirm');
    deleteBtn.disabled = true;
    deleteBtn.textContent = '處理中...';

    const bookingId = pendingDeleteBooking.id;
    const periodId = pendingDeletePeriod ? pendingDeletePeriod.id : null;
    const periodName = pendingDeletePeriod ? pendingDeletePeriod.name : 'ALL';
    const reason = pendingDeleteBooking.reason;
    const booker = pendingDeleteBooking.booker;

    try {
        let newPeriods = [];
        // 如果有指定節次，則過濾掉該節次；否則 (null) 代表刪除整筆 (清空所有節次)
        if (periodId) {
            newPeriods = pendingDeleteBooking.periods.filter(p => p !== periodId);
        } else {
            newPeriods = [];
        }

        if (currentUser) {
            // 管理員模式：直接刪除或更新
            if (newPeriods.length === 0) {
                await deleteBookingFromFirebase(bookingId);
            } else {
                await updateBookingInFirebase(bookingId, { periods: newPeriods });
            }
        } else {
            // 使用者自刪模式：必須使用 update 並帶上 deviceId 驗證
            await updateBookingInFirebase(bookingId, {
                periods: newPeriods,
                deviceId: localDeviceId
            });
        }

        await loadBookingsFromFirebase();
        closeDeleteModal();
        showToast('已取消預約', 'success');

        // 記錄日誌
        const actionType = periodId ? 'DELETE_BOOKING' : 'FORCE_DELETE_BOOKING';
        logSystemAction(actionType, {
            bookingId: bookingId,
            reason: reason,
            period: periodId || 'ALL',
            booker: booker
        }, bookingId);

        // 如果歷史記錄彈窗是開啟的，重新整理歷史記錄
        if (document.getElementById('historyModalOverlay').classList.contains('active')) {
            loadHistoryData();
        }

        // 如果搜尋結果彈窗是開啟的，重新整理搜尋結果
        if (document.getElementById('searchModalOverlay').classList.contains('active')) {
            // 只有當搜尋框有值時才重搜，避免報錯
            if (document.getElementById('searchInput').value.trim()) {
                executeAdvancedSearch();
            }
        }
    } catch (error) {
        console.error('取消預約失敗:', error);
        showToast('取消失敗，請稍後再試', 'error');
    } finally {
        deleteBtn.disabled = false;
        // 恢復按鈕文字會在 showBookingDetail 重設，這裡不用管
    }
}

/**
 * v2.40.0 (V.5): 撤銷剛建立的預約 (Gmail 風格 30 秒回復)
 * @param {string[]} bookingIds Firestore doc IDs
 */
async function undoRecentBookings(bookingIds) {
    if (!bookingIds || bookingIds.length === 0) return;
    try {
        const batch = db.batch();
        bookingIds.forEach(id => batch.delete(bookingsCollection.doc(id)));
        await batch.commit();
        await loadBookingsFromFirebase();
        showToast(`已撤銷 ${bookingIds.length} 筆預約`, 'info');

        // v2.43.0 (1.8): 稽核日誌 - 撤銷
        logSystemAction('UNDO_BOOKING', {
            count: bookingIds.length,
            ids: bookingIds,
            method: 'gmail_style_undo_30s',
        }, bookingIds.join(','));
    } catch (err) {
        console.error('[Undo] 撤銷失敗', err);
        showToast('撤銷失敗，請手動至歷史紀錄取消', 'error');
    }
}

// ===== Toast 通知 =====

let toastDismissTimer = null;
let toastCountdownTimer = null;

/**
 * 顯示 Toast 通知
 * @param {string} message 訊息
 * @param {string} type 'info' | 'success' | 'warning' | 'error'
 * @param {Object} [options] 進階選項 (v2.40.0)
 * @param {number} [options.duration=3000] 顯示時間 (ms)，傳 0 = 不自動關閉
 * @param {{label: string, onClick: Function, countdown?: number}} [options.action] 動作按鈕
 */
function showToast(message, type = 'info', options = {}) {
    const toast = document.getElementById('toast');
    const { duration = 3000, action } = options;

    // 清除既有 timer
    if (toastDismissTimer) { clearTimeout(toastDismissTimer); toastDismissTimer = null; }
    if (toastCountdownTimer) { clearInterval(toastCountdownTimer); toastCountdownTimer = null; }

    // 構建 toast 內容
    if (action) {
        const initial = action.countdown || 30;
        toast.innerHTML = `
            <span class="toast-message">${message}</span>
            <button class="toast-action-btn" type="button">
                ${action.label}
                <span class="toast-countdown">(${initial}s)</span>
            </button>
        `;
        const btn = toast.querySelector('.toast-action-btn');
        const countEl = toast.querySelector('.toast-countdown');

        let remaining = initial;
        toastCountdownTimer = setInterval(() => {
            remaining -= 1;
            if (countEl) countEl.textContent = `(${remaining}s)`;
            if (remaining <= 0) {
                clearInterval(toastCountdownTimer);
                toastCountdownTimer = null;
                toast.classList.remove('show');
            }
        }, 1000);

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try { await action.onClick(); }
            finally {
                if (toastCountdownTimer) { clearInterval(toastCountdownTimer); toastCountdownTimer = null; }
                toast.classList.remove('show');
            }
        });
    } else {
        toast.textContent = message;
    }

    toast.className = `toast ${type} show${action ? ' has-action' : ''}`;

    if (duration > 0 && !action) {
        toastDismissTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    } else if (action) {
        // 撤銷型 toast：用 countdown 控制關閉時機，超時後保留淡出
        toastDismissTimer = setTimeout(() => {
            toast.classList.remove('show');
        }, (action.countdown || 30) * 1000 + 500);
    }
}

// ===== 事件綁定 =====

function initEventListeners() {
    // 導航按鈕
    document.getElementById('btnPrev').addEventListener('click', () => {
        if (viewMode === 'week') {
            displayMode = 'week';
            rangeStartDate = null;
            rangeEndDate = null;
            currentWeekStart.setDate(currentWeekStart.getDate() - 7);
            loadBookingsFromFirebase();
        } else {
            currentMonth.setMonth(currentMonth.getMonth() - 1);
            loadMonthBookings();
        }
    });

    document.getElementById('btnNext').addEventListener('click', () => {
        if (viewMode === 'week') {
            displayMode = 'week';
            rangeStartDate = null;
            rangeEndDate = null;
            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            loadBookingsFromFirebase();
        } else {
            currentMonth.setMonth(currentMonth.getMonth() + 1);
            loadMonthBookings();
        }
    });

    // 視圖切換
    document.getElementById('btnViewWeek').addEventListener('click', () => switchView('week'));
    document.getElementById('btnViewMonth').addEventListener('click', () => switchView('month'));

    // 查詢按鈕
    document.getElementById('btnSearch').addEventListener('click', () => {
        const startDateValue = document.getElementById('startDate').value;
        const endDateValue = document.getElementById('endDate').value;

        if (startDateValue && endDateValue) {
            const start = new Date(startDateValue);
            const end = new Date(endDateValue);

            if (start > end) {
                showToast('開始日期不能晚於結束日期', 'warning');
                return;
            }

            const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

            if (days > 180) {
                showToast('查詢範圍不能超過 180 天', 'warning');
                return;
            }

            if (days <= 7) {
                displayMode = 'week';
                rangeStartDate = null;
                rangeEndDate = null;
                currentWeekStart = getMonday(start);
            } else {
                displayMode = 'range';
                rangeStartDate = start;
                rangeEndDate = end;
            }

            viewMode = 'week';
            switchView('week');
            scrollToCalendar();
        } else if (startDateValue) {
            displayMode = 'week';
            rangeStartDate = null;
            rangeEndDate = null;
            currentWeekStart = getMonday(new Date(startDateValue));
            viewMode = 'week';
            switchView('week');
            scrollToCalendar();
        }
    });

    // 預約彈窗
    document.getElementById('btnModalCancel').addEventListener('click', closeBookingModal);
    document.getElementById('btnModalSubmit').addEventListener('click', submitBooking);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'modalOverlay') closeBookingModal();
    });

    // 重複預約
    document.getElementById('repeatBooking').addEventListener('change', (e) => {
        document.getElementById('repeatEndDate').disabled = !e.target.checked;
    });

    // 管理員登入
    document.getElementById('btnAdminLogin').addEventListener('click', () => {
        if (currentUser) {
            if (confirm('確定要登出嗎？')) {
                doLogout();
            }
        } else {
            openAuthModal();
        }
    });

    // 登入表單
    document.getElementById('authForm').addEventListener('submit', (e) => {
        e.preventDefault();
        (async () => {
            await doLogin();
            if (firebase.auth().currentUser) {
                logSystemAction('ADMIN_LOGIN', { email: firebase.auth().currentUser.email });
            }
        })();
    });
    document.getElementById('btnAuthCancel').addEventListener('click', closeAuthModal);
    document.getElementById('authModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'authModalOverlay') closeAuthModal();
    });

    // 刪除確認彈窗
    document.getElementById('btnDeleteCancel').addEventListener('click', closeDeleteModal);
    document.getElementById('btnDeleteConfirm').addEventListener('click', executeDeleteBooking);
    document.getElementById('deleteModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'deleteModalOverlay') closeDeleteModal();
    });

    // 匯出 CSV
    document.getElementById('btnExport').addEventListener('click', exportToCSV);

    // 統計按鈕
    document.getElementById('btnStats').addEventListener('click', openStatsModal);
    document.getElementById('btnStatsClose').addEventListener('click', closeStatsModal);
    document.getElementById('statsModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'statsModalOverlay') closeStatsModal();
    });

    // 場地切換連動
    document.getElementById('roomSelect').addEventListener('change', () => {
        if (viewMode === 'week') {
            loadBookingsFromFirebase();
        } else {
            loadMonthBookings();
        }
    });

    // 預約彈窗場地切換 -> 刷新節次狀態 (修復衝突檢查失效)
    document.getElementById('modalRoomSelect').addEventListener('change', () => {
        if (selectedDate) {
            renderPeriodCheckboxes(selectedDate);
            // 重置 AI 建議 (因為場地變了)
            document.getElementById('smartSuggestions').classList.add('hidden');
            // v2.41.0 (M.1): 場地切換 → 重新整理公告 banner
            try {
                renderAnnouncementBannerInBookingModal(getSelectedRoom(), selectedDate);
            } catch (e) { /* silent */ }
        }
    });

    // 不開放時段設定監聽
    document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
    document.getElementById('btnSettingsClose').addEventListener('click', closeSettingsModal);
    document.getElementById('btnSaveSettings').addEventListener('click', saveRoomSettings);
    document.getElementById('settingsModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'settingsModalOverlay') closeSettingsModal();
    });

    // 初始化日期選擇器
    document.getElementById('startDate').value = formatDateISO(currentWeekStart);
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);
    document.getElementById('endDate').value = formatDateISO(weekEnd);
    document.getElementById('dateHint').textContent = '';

    // 儀表板事件綁定
    document.getElementById('btnOpenDashboard').addEventListener('click', openDashboard);
    document.getElementById('btnDashboardClose').addEventListener('click', closeDashboard);
    document.getElementById('btnDashRefresh').addEventListener('click', loadDashboardData);
    document.getElementById('dashboardModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'dashboardModalOverlay') closeDashboard();
    });

    // Audit Logs Refresh
    const btnRefreshLogs = document.getElementById('btnRefreshLogs');
    if (btnRefreshLogs) {
        btnRefreshLogs.addEventListener('click', loadAuditLogs);
    }
}

// ===== 儀表板功能 =====

/**
 * 開啟儀表板
 */
function openDashboard() {
    document.getElementById('dashboardModalOverlay').classList.add('active');
    loadDashboardData();
}

/**
 * 關閉儀表板
 */
function closeDashboard() {
    document.getElementById('dashboardModalOverlay').classList.remove('active');
}

/**
 * 載入儀表板數據
 */
async function loadDashboardData() {
    const refreshBtn = document.getElementById('btnDashRefresh');
    refreshBtn.disabled = true;
    refreshBtn.textContent = '載入中...';

    // Tab Logic
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active class from all
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => {
                c.style.display = 'none';
                c.classList.remove('active');
            });

            // Add active to current
            tab.classList.add('active');
            const targetId = `tab-${tab.dataset.tab}`;
            const targetContent = document.getElementById(targetId);
            targetContent.style.display = 'block';
            setTimeout(() => targetContent.classList.add('active'), 10);

            if (tab.dataset.tab === 'audit') {
                loadAuditLogs();
            } else if (tab.dataset.tab === 'analytics') {
                loadAdvancedAnalytics();
            }
        });
    });

    // Refresh Logs Logic
    const btnRefreshLogs = document.getElementById('btnRefreshLogs');
    if (btnRefreshLogs) {
        // Remove old listener to prevent duplicates (simple way: clone node)
        // OR just check if it already has logic. 
        // Better: bind it in initEventListeners, but here is context-aware.
        // Let's bind it once in initEventListeners instead.
    }

    try {
        const todayStr = formatDate(new Date());

        // 1. 取得今日所有預約
        const snapshot = await bookingsCollection.where('date', '==', todayStr).get();
        const todayBookings = [];
        snapshot.forEach(doc => {
            todayBookings.push(doc.data());
        });

        // 2. 計算當前時段
        const currentPeriod = getCurrentPeriod();
        document.getElementById('dashCurrentPeriod').textContent = currentPeriod
            ? `${currentPeriod.name} (${currentPeriod.time})`
            : '非預約時段';

        // 3. 更新數據卡
        document.getElementById('dashTodayCount').textContent = todayBookings.length;

        // 4. 計算並渲染場地狀態
        renderRoomStatus(todayBookings, currentPeriod);

        // 5. 渲染今日熱度圖
        renderTodayTrend(todayBookings);

        // 6. 更新時間
        const now = new Date();
        document.getElementById('dashUpdateTime').textContent =
            `最後更新：${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    } catch (error) {
        console.error('載入儀表板失敗:', error);
        showToast('載入失敗', 'error');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '重新整理';
    }
}

/**
 * 取得當前節次
 */
function getCurrentPeriod() {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    for (const period of PERIODS) {
        const [start, end] = period.time.split('~');
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);

        const startTime = startH * 60 + startM;
        const endTime = endH * 60 + endM;

        if (currentTime >= startTime && currentTime <= endTime) {
            return period;
        }
    }
    return null;
}

/**
 * 渲染場地即時狀態 (UI Optimized)
 */
function renderRoomStatus(bookings, currentPeriod) {
    const grid = document.getElementById('dashboardRoomGrid');
    grid.innerHTML = '';

    let activecount = 0;

    ROOMS.forEach(roomName => {
        let status = 'idle'; // idle, active
        let currentUser = '目前空閒';
        let periodName = '';

        if (currentPeriod) {
            const booking = bookings.find(b =>
                (b.room || '禮堂') === roomName &&
                b.periods.includes(currentPeriod.id)
            );

            if (booking) {
                status = 'active';
                currentUser = booking.booker;
                periodName = currentPeriod.name;
                activecount++;
            }
        }

        const card = document.createElement('div');
        card.className = `room-status-card ${status}`;

        // 狀態燈號與文字
        const statusBadgeHtml = status === 'active'
            ? `<span class="room-status-badge"><span class="status-pulse" style="width:8px;height:8px;margin-right:6px;"></span>使用中</span>`
            : `<span class="room-status-badge">空閒</span>`;

        card.innerHTML = `
            <div class="room-header">
                <span class="room-name">${roomName}</span>
                ${statusBadgeHtml}
            </div>
            <div class="room-user" title="${currentUser}">
                ${status === 'active'
                ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> ${currentUser}`
                : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> 可預約`}
            </div>
        `;
        grid.appendChild(card);
    });

    // 更新使用中場地數
    const activeEl = document.getElementById('dashActiveRooms');
    if (activeEl) activeEl.textContent = activecount;
}

/**
 * 渲染今日熱度趨勢 (UI Optimized & Rainbow)
 */
function renderTodayTrend(bookings) {
    const chart = document.getElementById('dashTrendChart');
    if (!chart) return;

    // 初始化計數
    const counts = {};
    PERIODS.forEach(p => counts[p.id] = 0);

    // 統計
    bookings.forEach(b => {
        b.periods.forEach(pid => {
            if (counts[pid] !== undefined) counts[pid]++;
        });
    });

    const maxVal = Math.max(...Object.values(counts), 1); // 避免除以 0

    // 生成 HTML (樣式完全由 CSS 控制)
    // 生成 HTML (樣式完全由 CSS 控制)
    chart.innerHTML = PERIODS.map((p, i) => {
        const count = counts[p.id];
        const height = (count / maxVal) * 100;
        const isEmpty = count === 0;

        // 如果是 0，不設定高度 (讓 CSS min-height: 4px 生效)，否則設定百分比 (至少 5%)
        const style = isEmpty ? '' : `style="height:${Math.max(height, 5)}%;"`;

        return `
            <div class="trend-bar-wrapper">
                <div class="trend-value">${count > 0 ? count : ''}</div>
                <div class="trend-bar ${isEmpty ? 'is-empty' : ''}" ${style} title="${p.name}: ${count}筆"></div>
                <div class="trend-label">${p.name.substring(0, 2)}</div>
            </div>
        `;
    }).join('');

    // 移除舊的行內樣式，這些現在都由 CSS .bar-chart 控制
    chart.style = '';
    chart.className = 'bar-chart';
}

// ===== Analytics v2 — 進階分析儀表板 =====

/**
 * 計算本學期起訖日（上學期：8/1~1/31，下學期：2/1~7/31）
 * @returns {{ start: Date, end: Date }}
 */
function getSemesterRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1; // 1-12
    let start, end;
    if (m >= 8) {
        // 上學期：本年 8/1 ~ 次年 1/31
        start = new Date(y, 7, 1);
        end = new Date(y + 1, 0, 31);
    } else {
        // 下學期：本年 2/1 ~ 7/31
        start = new Date(y, 1, 1);
        end = new Date(y, 6, 31);
    }
    return { start, end };
}

/**
 * 進階分析儀表板主入口
 */
async function loadAdvancedAnalytics() {
    // 初始化日期選擇器（若尚未設定）
    const startInput = document.getElementById('analyticsStart');
    const endInput = document.getElementById('analyticsEnd');
    if (!startInput.value || !endInput.value) {
        const { start, end } = getSemesterRange();
        startInput.value = formatDateISO(start);
        endInput.value = formatDateISO(end);
    }

    // 綁定「重新分析」按鈕（防止重複綁定）
    const runBtn = document.getElementById('btnRunAnalytics');
    if (runBtn && !runBtn._analyticsBound) {
        runBtn._analyticsBound = true;
        runBtn.addEventListener('click', runAnalyticsWithRange);
    }

    await runAnalyticsWithRange();
}

async function runAnalyticsWithRange() {
    const startInput = document.getElementById('analyticsStart');
    const endInput = document.getElementById('analyticsEnd');
    const startStr = startInput.value; // 'YYYY-MM-DD'
    const endStr = endInput.value;
    if (!startStr || !endStr) { showToast('請選擇分析區間', 'warning'); return; }

    // 轉換為 Firestore 查詢格式 YYYY/MM/DD
    const toFSDate = iso => iso.replace(/-/g, '/');
    const fsStart = toFSDate(startStr);
    const fsEnd = toFSDate(endStr);

    // 顯示載入中
    const loadingEl = document.getElementById('analyticsLoading');
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
        // 一次拉取區間內全部預約（含已清空的取消紀錄）
        const snapshot = await bookingsCollection
            .where('date', '>=', fsStart)
            .where('date', '<=', fsEnd)
            .get();

        const allDocs = [];
        snapshot.forEach(doc => allDocs.push({ id: doc.id, ...doc.data() }));

        // 有效預約（periods 非空）
        const validBookings = allDocs.filter(b => b.periods && b.periods.length > 0);
        // 已取消（periods 清空）
        const cancelledBookings = allDocs.filter(b => !b.periods || b.periods.length === 0);

        // 更新 KPI 卡
        const allBookers = new Set(validBookings.map(b => b.booker));
        const totalPeriods = validBookings.reduce((s, b) => s + b.periods.length, 0);
        document.getElementById('kpiTotalBookings').textContent = validBookings.length;
        document.getElementById('kpiTotalPeriods').textContent = totalPeriods;
        document.getElementById('kpiUniqBookers').textContent = allBookers.size;
        document.getElementById('kpiCancelCount').textContent = cancelledBookings.length;

        // 各圖表渲染
        buildHeatmap(validBookings, startStr, endStr);
        buildVenueRanking(validBookings);
        buildUserFrequency(validBookings);
        buildCancellationAnalysis(allDocs);
        buildLeadTimeDistribution(validBookings);

    } catch (err) {
        console.error('Analytics 載入失敗:', err);
        showToast('分析資料載入失敗', 'error');
    } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
    }
}

/**
 * 建立學期使用率熱力圖
 */
function buildHeatmap(bookings, startISO, endISO) {
    const grid = document.getElementById('heatmapGrid');
    const monthLabelsEl = document.getElementById('heatmapMonthLabels');
    if (!grid) return;

    // 統計每日節次數
    const dayCount = {};
    bookings.forEach(b => {
        const key = b.date; // 'YYYY/MM/DD'
        dayCount[key] = (dayCount[key] || 0) + (b.periods ? b.periods.length : 1);
    });
    const maxVal = Math.max(...Object.values(dayCount), 1);

    // 決定顏色等級
    const getLevel = (count) => {
        if (!count) return 0;
        if (count <= maxVal * 0.25) return 1;
        if (count <= maxVal * 0.50) return 2;
        if (count <= maxVal * 0.75) return 3;
        return 4;
    };

    // 從 startISO 往前到該週一
    const start = new Date(startISO);
    const end = new Date(endISO);
    // 將 start 往前退到週一 (getDay(): 0=日,1=一...)
    const startDay = start.getDay(); // 0=日
    const offset = startDay === 0 ? 6 : startDay - 1;
    const gridStart = new Date(start);
    gridStart.setDate(start.getDate() - offset);

    grid.innerHTML = '';
    monthLabelsEl.innerHTML = '';

    const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const CELL_SIZE = 16; // px（cell 13 + gap 3）
    let prevMonth = -1;

    let weekCol = null;
    let dayCursor = new Date(gridStart);
    let weekCount = 0;

    while (dayCursor <= end) {
        const dow = dayCursor.getDay() === 0 ? 6 : dayCursor.getDay() - 1; // 0=Mon..6=Sun
        if (dow === 0) {
            weekCol = document.createElement('div');
            weekCol.className = 'heatmap-week-col';
            grid.appendChild(weekCol);
            weekCount++;

            // 月份標籤
            const cm = dayCursor.getMonth();
            if (cm !== prevMonth) {
                const lbl = document.createElement('span');
                lbl.className = 'heatmap-month-label';
                lbl.textContent = MONTH_NAMES[cm];
                lbl.style.width = `${CELL_SIZE}px`;
                // 後續位置用佔位格補齊
                monthLabelsEl.appendChild(lbl);
                prevMonth = cm;
            } else {
                const ph = document.createElement('span');
                ph.style.width = `${CELL_SIZE}px`;
                ph.style.display = 'inline-block';
                monthLabelsEl.appendChild(ph);
            }
        }

        const fsKey = formatDate(dayCursor);
        const count = dayCount[fsKey] || 0;
        const inRange = dayCursor >= start && dayCursor <= end;
        const level = inRange ? getLevel(count) : 0;

        const cell = document.createElement('span');
        cell.className = `heatmap-cell level-${level}`;
        cell.title = `${formatDate(dayCursor)}：${count} 節次`;
        if (!inRange) cell.style.opacity = '0.3';
        if (weekCol) weekCol.appendChild(cell);

        dayCursor.setDate(dayCursor.getDate() + 1);
    }
}

/**
 * 場地使用率排行榜
 */
function buildVenueRanking(bookings) {
    const container = document.getElementById('venueRankingChart');
    if (!container) return;

    // 統計各場地節次總數
    const venueCount = {};
    ROOMS.forEach(r => { venueCount[r] = 0; });
    bookings.forEach(b => {
        const room = b.room || '禮堂';
        if (venueCount[room] !== undefined) {
            venueCount[room] += (b.periods ? b.periods.length : 1);
        }
    });

    const sorted = Object.entries(venueCount)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:1rem;">此區間無資料</div>';
        return;
    }
    const maxVal = sorted[0][1];
    const GRAD_COLORS = [
        'linear-gradient(90deg,#667eea,#764ba2)',
        'linear-gradient(90deg,#f093fb,#f5576c)',
        'linear-gradient(90deg,#4facfe,#00f2fe)',
        'linear-gradient(90deg,#43e97b,#38f9d7)',
        'linear-gradient(90deg,#fa709a,#fee140)',
        'linear-gradient(90deg,#a18cd1,#fbc2eb)',
        'linear-gradient(90deg,#fda085,#f6d365)',
        'linear-gradient(90deg,#89f7fe,#66a6ff)',
        'linear-gradient(90deg,#fddb92,#d1fdff)',
        'linear-gradient(90deg,#a1c4fd,#c2e9fb)',
    ];
    const rankClasses = ['gold', 'silver', 'bronze'];

    container.innerHTML = sorted.map(([room, count], i) => {
        const pct = (count / maxVal) * 100;
        return `
            <div class="analytics-bar-item">
                <span class="analytics-bar-rank ${rankClasses[i] || ''}">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
                <span class="analytics-bar-label" title="${room}">${room}</span>
                <div class="analytics-bar-track">
                    <div class="analytics-bar-fill" style="width:${Math.max(pct, 2)}%;background:${GRAD_COLORS[i % GRAD_COLORS.length]}"></div>
                </div>
                <span class="analytics-bar-value">${count} 節</span>
            </div>`;
    }).join('');
}

/**
 * 最活躍使用者 Top 10
 */
function buildUserFrequency(bookings) {
    const container = document.getElementById('userFrequencyChart');
    if (!container) return;

    const userCount = {};
    bookings.forEach(b => {
        const name = b.booker || '未知';
        userCount[name] = (userCount[name] || 0) + (b.periods ? b.periods.length : 1);
    });

    const sorted = Object.entries(userCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    if (sorted.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:1rem;">此區間無資料</div>';
        return;
    }
    const maxVal = sorted[0][1];
    const rankClasses = ['gold', 'silver', 'bronze'];

    container.innerHTML = sorted.map(([name, count], i) => {
        const pct = (count / maxVal) * 100;
        return `
            <div class="analytics-bar-item">
                <span class="analytics-bar-rank ${rankClasses[i] || ''}">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
                <span class="analytics-bar-label" title="${name}">${name}</span>
                <div class="analytics-bar-track">
                    <div class="analytics-bar-fill" style="width:${Math.max(pct, 2)}%"></div>
                </div>
                <span class="analytics-bar-value">${count} 節</span>
            </div>`;
    }).join('');
}

/**
 * 各場地取消率分析
 */
function buildCancellationAnalysis(allDocs) {
    const container = document.getElementById('cancellationChart');
    if (!container) return;

    // 統計各場地「成立」與「取消」筆數
    const stats = {};
    ROOMS.forEach(r => { stats[r] = { valid: 0, cancelled: 0 }; });

    allDocs.forEach(b => {
        const room = b.room || '禮堂';
        if (!stats[room]) stats[room] = { valid: 0, cancelled: 0 };
        const isEmpty = !b.periods || b.periods.length === 0;
        if (isEmpty) stats[room].cancelled++;
        else stats[room].valid++;
    });

    const sorted = Object.entries(stats)
        .filter(([, v]) => v.valid + v.cancelled > 0)
        .sort((a, b) => {
            const rateA = a[1].cancelled / (a[1].valid + a[1].cancelled);
            const rateB = b[1].cancelled / (b[1].valid + b[1].cancelled);
            return rateB - rateA;
        });

    if (sorted.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#999;padding:1rem;">此區間無取消資料</div>';
        return;
    }
    const maxRate = Math.max(...sorted.map(([, v]) => v.cancelled / (v.valid + v.cancelled)));

    container.innerHTML = sorted.map(([room, { valid, cancelled }], i) => {
        const total = valid + cancelled;
        const rate = cancelled / total;
        const pct = maxRate > 0 ? (rate / maxRate) * 100 : 0;
        const rateStr = (rate * 100).toFixed(1) + '%';
        return `
            <div class="analytics-bar-item">
                <span class="analytics-bar-rank">${i + 1}</span>
                <span class="analytics-bar-label" title="${room}">${room}</span>
                <div class="analytics-bar-track">
                    <div class="analytics-bar-fill cancel-fill" style="width:${Math.max(pct, cancelled > 0 ? 2 : 0)}%"></div>
                </div>
                <span class="analytics-bar-value" style="color:#dc2626">${rateStr} (${cancelled}/${total})</span>
            </div>`;
    }).join('');
}

/**
 * 預約提前天數分佈直方圖
 * 桶：0天 / 1~3天 / 4~7天 / 8~14天 / 15天+
 */
function buildLeadTimeDistribution(bookings) {
    const container = document.getElementById('leadTimeChart');
    if (!container) return;

    const BUCKETS = [0, 0, 0, 0, 0];
    const BUCKET_LABELS = ['當天', '1–3天', '4–7天', '8–14天', '15天+'];

    bookings.forEach(b => {
        if (!b.createdAt || !b.date) return;

        let createdDate;
        try {
            createdDate = b.createdAt.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
        } catch { return; }

        const bookDate = parseDate(b.date); // YYYY/MM/DD → Date
        if (!bookDate) return;

        const diffMs = bookDate - createdDate;
        const diffDays = Math.max(0, Math.floor(diffMs / 86400000));

        if (diffDays === 0) BUCKETS[0]++;
        else if (diffDays <= 3) BUCKETS[1]++;
        else if (diffDays <= 7) BUCKETS[2]++;
        else if (diffDays <= 14) BUCKETS[3]++;
        else BUCKETS[4]++;
    });

    const maxVal = Math.max(...BUCKETS, 1);

    container.innerHTML = BUCKETS.map((count, i) => {
        const heightPct = (count / maxVal) * 100;
        return `
            <div class="histogram-bar-wrap">
                <div class="histogram-bar-val">${count > 0 ? count : ''}</div>
                <div class="histogram-bar" style="height:${Math.max(heightPct, count > 0 ? 5 : 1)}%"
                    title="${BUCKET_LABELS[i]}：${count} 筆"></div>
            </div>`;
    }).join('');
}

// ===== CSV 匯出功能 =====

async function exportToCSV() {
    try {
        const confirmExport = confirm('確定要匯出所有歷史預約資料嗎？這可能需要一點時間。');
        if (!confirmExport) return;

        showToast('正在準備匯出所有資料...', 'info');

        // 1. 獲取所有資料 (OrderBy Date Desc)
        const snapshot = await bookingsCollection.orderBy('date', 'desc').get();

        if (snapshot.empty) {
            showToast('系統中沒有任何預約資料', 'warning');
            return;
        }

        // 2. CSV Header
        const headers = [
            '預約編號',
            '預約日期',
            '場地名稱',
            '預約節次',
            '預約者姓名',
            '預約理由/用途',
            '建立時間',
            '操作裝置ID',
            '狀態'
        ];

        const rows = [headers.join(',')];

        // 3. Process Data
        snapshot.forEach(doc => {
            const data = doc.data();

            // 處理節次顯示
            const periodsStr = (data.periods || [])
                .map(pId => PERIODS.find(p => p.id === pId)?.name || pId)
                .join(' & ');

            // 處理時間
            const createdAt = data.createdAt
                ? new Date(data.createdAt.toDate()).toLocaleString('zh-TW', { hour12: false })
                : '未知時間';

            // CSV 轉義函數 (處理逗號、換行、雙引號)
            const escape = (str) => {
                if (!str) return '';
                str = String(str).replace(/"/g, '""'); // Escape double quotes
                if (str.includes(',') || str.includes('\n') || str.includes('"')) {
                    return `"${str}"`;
                }
                return str;
            };

            const roomName = (data.room && data.room !== '未知場地') ? data.room : '禮堂';

            const row = [
                escape(doc.id),
                escape(data.date),
                escape(roomName),
                escape(periodsStr),
                escape(data.booker || '未知'),
                escape(data.reason || '無'),
                escape(createdAt),
                escape(data.deviceId || 'Unknown'),
                '有效' // 狀態 (目前資料庫只存有效的，刪除的在 audit log)
            ];

            rows.push(row.join(','));
        });

        // 4. Generate & Download
        const csvContent = '\uFEFF' + rows.join('\n'); // Add BOM for Excel
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.href = url;
        link.download = `完整預約匯出_${timestamp}.csv`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // 5. Log Action
        logSystemAction('EXPORT_CSV', { count: snapshot.size });
        showToast(`✅ 成功匯出 ${snapshot.size} 筆完整資料`, 'success');

    } catch (error) {
        console.error('匯出失敗:', error);
        showToast('❌ 匯出失敗: ' + error.message, 'error');
    }
}

// ===== 統計功能 =====

const CHART_COLORS = [
    '#4a9ebb', '#5cb8d6', '#7bc9e0', '#9ad9ea',
    '#f44336', '#ff9800', '#4caf50', '#9c27b0',
    '#2196f3', '#00bcd4'
];

/**
 * 開啟統計彈窗
 */
function openStatsModal() {
    document.getElementById('statsModalOverlay').classList.add('active');
    loadStatsData();
}

/**
 * 關閉統計彈窗
 */
function closeStatsModal() {
    document.getElementById('statsModalOverlay').classList.remove('active');
}

/**
 * 載入統計資料並渲染圖表
 */
async function loadStatsData() {
    try {
        showToast('正在載入統計資料...', 'info');

        // 查詢所有預約資料
        const snapshot = await bookingsCollection.get();

        if (snapshot.empty) {
            showToast('沒有預約資料', 'warning');
            return;
        }

        const room = getSelectedRoom();

        // 更新統計彈窗標題顯示場地名稱
        const displayEl = document.getElementById('statsRoomNameDisplay');
        if (displayEl) displayEl.textContent = room;

        const allBookings = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // 僅統計當前選擇場地的資料
            if ((data.room || '禮堂') === room) {
                allBookings.push({ id: doc.id, ...data });
            }
        });

        // 統計節次使用率
        const periodStats = {};
        PERIODS.forEach(p => { periodStats[p.id] = 0; });

        // 統計預約者
        const bookerStats = {};

        // 統計本月趨勢
        const today = new Date();
        const currentMonthStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}`;
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const trendStats = {};
        for (let i = 1; i <= daysInMonth; i++) {
            trendStats[i] = 0;
        }

        allBookings.forEach(booking => {
            // 節次統計
            booking.periods.forEach(periodId => {
                if (periodStats[periodId] !== undefined) {
                    periodStats[periodId]++;
                }
            });

            // 預約者統計
            const booker = booking.booker || '未知';
            bookerStats[booker] = (bookerStats[booker] || 0) + booking.periods.length;

            // 本月趨勢
            if (booking.date && booking.date.startsWith(currentMonthStr)) {
                const day = parseInt(booking.date.split('/')[2]);
                if (trendStats[day] !== undefined) {
                    trendStats[day] += booking.periods.length;
                }
            }
        });

        // 渲染圓餅圖
        renderPeriodPieChart(periodStats);

        // 渲染長條圖
        renderBookerBarChart(bookerStats);

        // 渲染趨勢圖
        renderTrendChart(trendStats);

        // 渲染摘要
        renderStatsSummary(allBookings, periodStats);

    } catch (error) {
        console.error('載入統計資料失敗:', error);
        showToast('載入統計資料失敗', 'error');
    }
}

/**
 * 渲染節次使用率圓餅圖
 */
function renderPeriodPieChart(periodStats) {
    const pieChart = document.getElementById('periodPieChart');
    const legend = document.getElementById('periodLegend');

    const total = Object.values(periodStats).reduce((a, b) => a + b, 0);
    if (total === 0) {
        pieChart.innerHTML = '<div style="text-align:center;color:#999;padding:2rem;">無資料</div>';
        legend.innerHTML = '';
        return;
    }

    // 計算各區段角度並排序
    const sortedPeriods = PERIODS
        .map((p, i) => ({ ...p, count: periodStats[p.id], color: CHART_COLORS[i % CHART_COLORS.length] }))
        .filter(p => p.count > 0)
        .sort((a, b) => b.count - a.count);

    // 建立 conic-gradient
    let gradientParts = [];
    let currentAngle = 0;
    sortedPeriods.forEach(p => {
        const percent = (p.count / total) * 100;
        gradientParts.push(`${p.color} ${currentAngle}deg ${currentAngle + percent * 3.6}deg`);
        currentAngle += percent * 3.6;
    });

    pieChart.style.background = `conic-gradient(${gradientParts.join(', ')})`;

    // 建立圖例 (更新為新的類別)
    legend.innerHTML = sortedPeriods.slice(0, 6).map(p => `
        <div class="pie-legend-item">
            <span class="pie-legend-color" style="background:${p.color}"></span>
            <span class="pie-legend-name">${p.name}</span>
            <span class="pie-legend-value">${p.count} 節</span>
        </div>
    `).join('');
}

/**
 * 渲染預約者長條圖
 */
function renderBookerBarChart(bookerStats) {
    const chart = document.getElementById('bookerBarChart');

    const sorted = Object.entries(bookerStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (sorted.length === 0) {
        chart.innerHTML = '<div style="text-align:center;color:#999;padding:1rem;">無資料</div>';
        return;
    }

    const maxValue = sorted[0][1];

    chart.innerHTML = sorted.map(([name, count], i) => {
        const percent = (count / maxValue) * 100;
        return `
            <div class="bar-item">
                <div class="bar-info">
                    <span class="bar-label" title="${name}">${name}</span>
                    <span class="bar-value">${count} 節</span>
                </div>
                <div class="bar-container">
                    <div class="bar-fill" style="width:${percent}%;background:${CHART_COLORS[i % CHART_COLORS.length]}"></div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 渲染本月趨勢圖
 */
function renderTrendChart(trendStats) {
    const chart = document.getElementById('trendChart');

    const values = Object.values(trendStats);
    const maxValue = Math.max(...values, 1);

    chart.innerHTML = Object.entries(trendStats).map(([day, count]) => {
        const height = (count / maxValue) * 100;
        return `<div class="trend-bar" style="height:${Math.max(height, 4)}%" data-value="${day}日: ${count}節" title="${day}日: ${count}節"></div>`;
    }).join('');
}

/**
 * 渲染統計摘要
 */
function renderStatsSummary(allBookings, periodStats) {
    const summary = document.getElementById('statsSummary');

    const totalBookings = allBookings.length;
    const totalPeriods = Object.values(periodStats).reduce((a, b) => a + b, 0);
    const uniqueBookers = new Set(allBookings.map(b => b.booker)).size;

    summary.innerHTML = `
        <div class="summary-card">
            <span class="summary-value">${totalBookings}</span>
            <span class="summary-label">總預約筆數</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${totalPeriods}</span>
            <span class="summary-label">總預約節次</span>
        </div>
        <div class="summary-card">
            <span class="summary-value">${uniqueBookers}</span>
            <span class="summary-label">不同預約者</span>
        </div>
    `;
}

// ===== 進階搜尋功能 =====

/**
 * 開啟搜尋結果彈窗
 */
function openSearchModal() {
    document.getElementById('searchModalOverlay').classList.add('active');
}

/**
 * 關閉搜尋結果彈窗
 */
function closeSearchModal() {
    document.getElementById('searchModalOverlay').classList.remove('active');
}

/**
 * 執行進階搜尋
 */
async function executeAdvancedSearch() {
    const searchInput = document.getElementById('searchInput').value.trim();
    const periodFilter = document.getElementById('searchPeriodFilter').value;

    // v2.41.2: 場地過濾 - 預設僅搜目前場地, 使用者可切換為全部
    const scopeBtn = document.getElementById('btnSearchScope');
    const isAllRooms = scopeBtn?.dataset.scope === 'all';
    const currentRoom = getSelectedRoom();

    // v2.41.7 (Bug Fix): 搜尋範圍改採智慧策略
    // 優先順序: (1) 主畫面已設的日期範圍 → (2) 過去 90 + 未來 180 天 (含當週預約)
    let startDateStr, endDateStr, dateRangeSource;
    const mainStartDate = document.getElementById('startDate')?.value;
    const mainEndDate = document.getElementById('endDate')?.value;

    if (mainStartDate && mainEndDate) {
        // 使用主畫面的日期範圍
        startDateStr = mainStartDate.replaceAll('-', '/');
        endDateStr = mainEndDate.replaceAll('-', '/');
        dateRangeSource = 'main-filter';
    } else {
        // 預設: 過去 90 天 ~ 未來 180 天 (避免遺漏當週/近期預約)
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - 90);
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 180);
        startDateStr = formatDate(pastDate);
        endDateStr = formatDate(futureDate);
        dateRangeSource = 'default-range';
    }

    // 驗證至少有一個搜尋條件
    if (!searchInput && !periodFilter) {
        showToast('請輸入搜尋關鍵字或選擇節次', 'warning');
        return;
    }

    const scopeMsg = isAllRooms ? '跨全部場地' : `「${currentRoom}」`;
    const rangeMsg = dateRangeSource === 'main-filter'
        ? `主畫面日期範圍 (${startDateStr} ~ ${endDateStr})`
        : `${startDateStr} ~ ${endDateStr}`;
    showToast(`正在${scopeMsg} ${rangeMsg} 內搜尋預約...`, 'info');

    try {
        // 建立查詢 (直接查未來半年)
        let query = bookingsCollection
            .where('date', '>=', startDateStr)
            .where('date', '<=', endDateStr);

        const snapshot = await query.get();
        let results = [];

        snapshot.forEach(doc => {
            const booking = { id: doc.id, ...doc.data() };

            // v2.41.2: 場地過濾 - 預設只看目前場地
            if (!isAllRooms) {
                const bookingRoom = booking.room || '禮堂'; // 舊資料無 room 欄位 → 視為禮堂
                if (bookingRoom !== currentRoom) {
                    return;
                }
            }

            // 關鍵字篩選（同時搜尋姓名與理由）
            if (searchInput) {
                const keyword = searchInput.toLowerCase();
                const matchBooker = booking.booker && booking.booker.toLowerCase().includes(keyword);
                const matchReason = booking.reason && booking.reason.toLowerCase().includes(keyword);

                if (!matchBooker && !matchReason) {
                    return;
                }
            }

            // 節次篩選
            if (periodFilter) {
                if (!booking.periods || !booking.periods.includes(periodFilter)) {
                    return;
                }
            }

            results.push(booking);
        });

        // 按日期排序
        results.sort((a, b) => a.date.localeCompare(b.date));

        // 渲染搜尋結果 (v2.41.7: 傳遞完整搜尋條件供摘要顯示)
        renderSearchResults(results, searchInput, {
            scope: isAllRooms ? 'all' : currentRoom,
            periodFilter,
            startDateStr,
            endDateStr,
            dateRangeSource,
        });
        openSearchModal();

    } catch (error) {
        console.error('搜尋失敗:', error);
        showToast('搜尋失敗，請稍後再試', 'error');
    }
}

/**
 * 渲染搜尋結果
 * @param {Array} results
 * @param {string} searchTerm
 * @param {Object} [opts] { scope, periodFilter } v2.41.7 完整搜尋條件
 */
function renderSearchResults(results, searchTerm, opts = {}) {
    const summaryEl = document.getElementById('searchResultSummary');
    const listEl = document.getElementById('searchResultList');

    // v2.41.7: 完整顯示「搜尋條件」與「結果分布」, 讓使用者一眼看懂為何結果如此
    const scopeBadge = opts.scope === 'all'
        ? '<span class="search-criteria-chip chip-scope-all">🌐 跨全部場地</span>'
        : opts.scope
            ? `<span class="search-criteria-chip chip-scope-current">🏠 ${escapeHtml(opts.scope)}</span>`
            : '';

    // 節次條件 chip
    const periodName = opts.periodFilter
        ? (PERIODS.find(p => p.id === opts.periodFilter)?.name || opts.periodFilter)
        : null;
    const periodChip = periodName
        ? `<span class="search-criteria-chip chip-period">⏰ ${escapeHtml(periodName)}</span>`
        : '<span class="search-criteria-chip chip-empty">⏰ 所有節次</span>';

    // 關鍵字 chip
    const keywordChip = searchTerm
        ? `<span class="search-criteria-chip chip-keyword">🔍 「${escapeHtml(searchTerm)}」</span>`
        : '<span class="search-criteria-chip chip-empty">🔍 不限關鍵字</span>';

    // 期間 chip (v2.41.7: 顯示實際使用的日期範圍)
    let dateRangeChipText = '📅 今天 ~ 未來 180 天';
    if (opts.startDateStr && opts.endDateStr) {
        const sourceLabel = opts.dateRangeSource === 'main-filter'
            ? '📅 (主畫面範圍)'
            : '📅';
        dateRangeChipText = `${sourceLabel} ${opts.startDateStr} ~ ${opts.endDateStr}`;
    }
    const dateRangeChip = `<span class="search-criteria-chip chip-date">${escapeHtml(dateRangeChipText)}</span>`;

    // v2.41.7: 場地分布統計 - 解釋「為什麼結果這樣」
    let distributionHint = '';
    if (opts.scope === 'all' && results.length > 0) {
        const roomCounts = {};
        results.forEach(b => {
            const room = b.room || '禮堂';
            roomCounts[room] = (roomCounts[room] || 0) + 1;
        });
        const roomNames = Object.keys(roomCounts);
        if (roomNames.length === 1) {
            // 全部結果集中在單一場地
            distributionHint = `
                <div class="search-distribution-hint">
                    💡 <strong>結果說明</strong>:符合條件的預約全部來自「<strong>${escapeHtml(roomNames[0])}</strong>」,
                    其他場地此期間無對應預約。
                </div>
            `;
        } else {
            // 多場地分布
            const distLine = roomNames
                .sort((a, b) => roomCounts[b] - roomCounts[a])
                .map(r => `${escapeHtml(r)} ${roomCounts[r]} 筆`)
                .join(' / ');
            distributionHint = `
                <div class="search-distribution-hint">
                    📊 <strong>場地分布</strong>:${distLine}
                </div>
            `;
        }
    }

    // 渲染摘要
    summaryEl.innerHTML = `
        <div class="search-summary-main">
            <span>找到 <span class="count">${results.length}</span> 筆預約記錄</span>
        </div>
        <div class="search-criteria-chips">
            ${scopeBadge}
            ${periodChip}
            ${keywordChip}
            ${dateRangeChip}
        </div>
        ${distributionHint}
    `;

    // 渲染結果列表
    if (results.length === 0) {
        listEl.innerHTML = `
            <div class="search-no-result">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <p>沒有找到符合條件的預約記錄</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = results.map(booking => {
        const itemHTML = createBookingItemHTML(booking, {
            searchTerm: searchTerm,
            showDeleteBtn: false,
            showRebookBtn: true
        });

        return `
            <div class="search-result-item" data-booking-id="${booking.id}" data-date="${booking.date}">
                ${itemHTML}
            </div>
        `;
    }).join('');

    // 綁定點擊事件 - 跳轉到該週
    listEl.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // 如果點擊的是按鈕或動作區域，不執行跳轉
            if (e.target.closest('.history-actions') || e.target.closest('button')) return;

            const dateStr = item.dataset.date;
            const date = parseDate(dateStr);
            currentWeekStart = getMonday(date);
            viewMode = 'week';
            closeSearchModal();
            switchView('week');
        });
    });
}

/**
 * 轉義正則表達式特殊字符
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 初始化搜尋功能事件監聽器
 */
function initSearchEventListeners() {
    const searchInput = document.getElementById('searchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    const btnAdvancedSearch = document.getElementById('btnAdvancedSearch');
    const btnSearchClose = document.getElementById('btnSearchClose');
    const searchModalOverlay = document.getElementById('searchModalOverlay');

    // 搜尋輸入框 - 顯示/隱藏清除按鈕
    searchInput.addEventListener('input', () => {
        if (searchInput.value.trim()) {
            searchClearBtn.classList.remove('hidden');
        } else {
            searchClearBtn.classList.add('hidden');
        }
    });

    // 清除按鈕
    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchClearBtn.classList.add('hidden');
        searchInput.focus();
    });

    // 搜尋按鈕
    btnAdvancedSearch.addEventListener('click', executeAdvancedSearch);

    // v2.41.5: 場地搜尋範圍切換按鈕 (動態顯示實際場地名)
    const btnScope = document.getElementById('btnSearchScope');
    const scopeLabel = document.getElementById('searchScopeLabel');

    /**
     * 依當前 scope state 與目前選定場地, 同步更新按鈕標籤
     */
    function refreshScopeButtonLabel() {
        if (!btnScope || !scopeLabel) return;
        const isAll = btnScope.dataset.scope === 'all';
        const currentRoom = document.getElementById('roomSelect')?.value || '禮堂';
        if (isAll) {
            btnScope.classList.add('all-rooms');
            btnScope.firstChild.textContent = '🌐 ';
            scopeLabel.textContent = '全部場地一起搜';
            btnScope.title = '目前搜尋「全部場地」的預約。點擊切換為僅搜尋目前選定的場地。';
        } else {
            btnScope.classList.remove('all-rooms');
            btnScope.firstChild.textContent = '🏠 ';
            scopeLabel.textContent = `僅看「${currentRoom}」`;
            btnScope.title = `目前只搜尋「${currentRoom}」的預約。點擊切換為跨全部場地搜尋。`;
        }
    }

    if (btnScope) {
        btnScope.addEventListener('click', () => {
            const isAll = btnScope.dataset.scope === 'all';
            btnScope.dataset.scope = isAll ? 'current' : 'all';
            refreshScopeButtonLabel();
        });
    }

    // 主畫面場地切換時, 同步更新按鈕標籤
    document.getElementById('roomSelect')?.addEventListener('change', refreshScopeButtonLabel);

    // 初始化載入時呼叫一次
    refreshScopeButtonLabel();

    // Enter 鍵觸發搜尋
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeAdvancedSearch();
        }
    });

    // 關閉搜尋結果彈窗
    btnSearchClose.addEventListener('click', closeSearchModal);
    searchModalOverlay.addEventListener('click', (e) => {
        if (e.target.id === 'searchModalOverlay') {
            closeSearchModal();
        }
    });
}



// ===== 歷史記錄功能 =====

/**
 * 統一產生預約記錄的 HTML 結構 (用於歷史紀錄與搜尋結果)
 * @param {Object} booking 預約資料
 * @param {Object} options 選項 { searchTerm, showDeleteBtn }
 */
function createBookingItemHTML(booking, options = {}) {
    const { searchTerm = '', showDeleteBtn = false, showRebookBtn = false } = options;

    const roomName = (booking.room && booking.room !== '未知場地') ? booking.room : '禮堂';

    const periodTags = (booking.periods || [])
        .map(pId => {
            const name = PERIODS.find(p => p.id === pId)?.name || pId;
            return `<span class="history-period-tag">${name}</span>`;
        })
        .join('');

    // 關鍵字高亮處理
    const highlight = (text, keyword) => {
        if (!keyword || !text) return text || '-';
        const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
        return text.replace(regex, '<span class="highlight">$1</span>');
    };

    const bookerDisplay = highlight(booking.booker, searchTerm);
    const reasonDisplay = highlight(booking.reason, searchTerm);

    let deleteBtnHTML = '';
    if (showDeleteBtn) {
        const isOwner = booking.deviceId && booking.deviceId === localStorage.getItem('deviceId');
        const isAdmin = !!firebase.auth().currentUser;

        if (isAdmin || isOwner) {
            // 存入全域供 onclick 使用 (已有的 window.historyBookings)
            if (window.historyBookings) window.historyBookings[booking.id] = booking;

            deleteBtnHTML = `
                <button class="btn-history-delete" onclick="showBookingDetail(window.historyBookings['${booking.id}'], null)" title="刪除此筆記錄">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>`;
        }
    }

    // ===== 一鍵重複預約按鈕 (v2.39.0) =====
    let rebookBtnHTML = '';
    if (showRebookBtn && booking.id) {
        // 確保 booking 存入全域供 onclick 取用
        if (!window.historyBookings) window.historyBookings = {};
        window.historyBookings[booking.id] = booking;

        rebookBtnHTML = `
            <button class="btn-history-rebook"
                    onclick="quickRebook(window.historyBookings['${booking.id}'])"
                    title="以此筆為範本，預約下週同日">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                </svg>
                <span>再預約</span>
            </button>`;
    }

    return `
        <div class="history-item" data-booking-id="${booking.id || ''}">
            <span class="history-date">${booking.date}</span>
            <div class="history-periods-container">
                ${periodTags}
            </div>
            <span class="history-room">${roomName}</span>
            <span class="history-booker">${bookerDisplay}</span>
            <div class="history-actions">
                <span class="history-reason" title="${booking.reason || ''}">${reasonDisplay}</span>
                ${rebookBtnHTML}
                ${deleteBtnHTML}
            </div>
        </div>
    `;
}

/**
 * 開啟歷史記錄彈窗
 */
function openHistoryModal() {
    document.getElementById('historyModalOverlay').classList.add('active');
    // 預設載入當月
    const now = new Date();
    document.getElementById('historyMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    loadHistoryData();
}

/**
 * 關閉歷史記錄彈窗
 */
function closeHistoryModal() {
    document.getElementById('historyModalOverlay').classList.remove('active');
}

/**
 * 載入歷史記錄資料
 */
async function loadHistoryData() {
    const monthInput = document.getElementById('historyMonth').value;
    if (!monthInput) {
        showToast('請選擇月份', 'warning');
        return;
    }

    const [year, month] = monthInput.split('-');
    const startDate = `${year}/${month}/01`;
    const endDate = `${year}/${month}/31`;

    showToast('正在載入歷史記錄...', 'info');

    try {
        const snapshot = await bookingsCollection
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .orderBy('date', 'desc')
            .get();

        const historyList = document.getElementById('historyList');

        if (snapshot.empty) {
            historyList.innerHTML = `
                <div style="text-align:center; padding:2rem; color:var(--text-muted);">
                    <p>該月份沒有預約記錄</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = '';
        window.historyBookings = {}; // 初始化歷史預約暫存

        historyList.innerHTML = '';
        snapshot.forEach(doc => {
            const booking = doc.data();
            booking.id = doc.id;

            // 過濾已刪除（空節次）的預約
            if (!booking.periods || booking.periods.length === 0) return;

            // 存入全域變數供 onclick 使用
            window.historyBookings[booking.id] = booking;

            historyList.innerHTML += createBookingItemHTML(booking, { showDeleteBtn: true, showRebookBtn: true });
        });

        showToast(`已載入 ${snapshot.size} 筆記錄`, 'success');
    } catch (error) {
        console.error('載入歷史記錄失敗:', error);
        showToast('載入失敗，請稍後再試', 'error');
    }
}

/**
 * 初始化歷史記錄事件監聽器
 */
function initHistoryEventListeners() {
    document.getElementById('btnHistory').addEventListener('click', openHistoryModal);
    document.getElementById('btnHistoryClose').addEventListener('click', closeHistoryModal);
    document.getElementById('historyModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'historyModalOverlay') closeHistoryModal();
    });
    document.getElementById('btnHistoryLoad').addEventListener('click', loadHistoryData);
}

// ===== 批次預約功能 =====

let batchSelectedDates = [];
let batchDisplayMonth = new Date(); // 追蹤批次日曆目前顯示的月份

/**
 * 初始化批次預約功能
 */
function initBatchBooking() {
    const batchCheckbox = document.getElementById('batchBooking');
    const batchContainer = document.getElementById('batchDatesContainer');

    if (!batchCheckbox || !batchContainer) return;

    batchCheckbox.addEventListener('change', () => {
        if (batchCheckbox.checked) {
            batchContainer.classList.remove('hidden');
            renderBatchCalendar();
        } else {
            batchContainer.classList.add('hidden');
            batchSelectedDates = [];
            updateSelectedDatesDisplay();
        }
    });
}

/**
 * 渲染批次預約日曆
 */
function renderBatchCalendar() {
    const calendar = document.getElementById('batchCalendar');
    if (!calendar) return;

    const year = batchDisplayMonth.getFullYear();
    const month = batchDisplayMonth.getMonth();
    const now = new Date();

    // 取得該月第一天和最後一天
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 建立導覽標頭
    let html = `
        <div class="batch-calendar-header" style="grid-column: span 7; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 0 5px;">
            <button type="button" onclick="changeBatchMonth(-1)" style="background:none; border:none; cursor:pointer; padding:5px; color:var(--primary-color); display: flex; align-items: center; justify-content: center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span style="font-weight: 700; color: var(--text-primary); font-size: 1.1rem;">${year}年${month + 1}月</span>
            <button type="button" onclick="changeBatchMonth(1)" style="background:none; border:none; cursor:pointer; padding:5px; color:var(--primary-color); display: flex; align-items: center; justify-content: center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
        </div>
    `;

    // 星期標題
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    html += weekdays.map(d => `<div class="batch-calendar-day" style="background:#f0f0f0;cursor:default;font-weight:700;">${d}</div>`).join('');

    // 填充空白
    for (let i = 0; i < firstDay.getDay(); i++) {
        html += '<div class="batch-calendar-day disabled"></div>';
    }

    // 日期
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dateStr = `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        const isSelected = batchSelectedDates.includes(dateStr);
        const dayDate = new Date(year, month, day);
        const isPast = dayDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

        html += `
            <div class="batch-calendar-day ${isSelected ? 'selected' : ''} ${isPast ? 'disabled' : ''}" 
                 data-date="${dateStr}" 
                 ${!isPast ? 'onclick="toggleBatchDate(this)"' : ''}>
                ${day}
            </div>
        `;
    }

    calendar.innerHTML = html;
}

/**
 * 切換批次日曆月份
 */
function changeBatchMonth(offset) {
    batchDisplayMonth.setMonth(batchDisplayMonth.getMonth() + offset);
    renderBatchCalendar();
}

/**
 * 切換批次選取日期
 */
function toggleBatchDate(element) {
    const date = element.dataset.date;
    const index = batchSelectedDates.indexOf(date);

    if (index > -1) {
        batchSelectedDates.splice(index, 1);
        element.classList.remove('selected');
    } else {
        batchSelectedDates.push(date);
        element.classList.add('selected');
    }

    updateSelectedDatesDisplay();
}

/**
 * 更新已選日期顯示
 */
function updateSelectedDatesDisplay() {
    const display = document.getElementById('selectedDatesDisplay');
    if (!display) return;

    if (batchSelectedDates.length === 0) {
        display.innerHTML = '<p style="color:var(--text-muted);">尚未選擇日期</p>';
        return;
    }

    batchSelectedDates.sort();
    display.innerHTML = batchSelectedDates.map(date => `
        <span class="selected-date-tag">
            ${date}
            <button onclick="removeBatchDate('${date}')">×</button>
        </span>
    `).join('');
}

/**
 * 移除批次選取的日期
 */
function removeBatchDate(date) {
    const index = batchSelectedDates.indexOf(date);
    if (index > -1) {
        batchSelectedDates.splice(index, 1);
        renderBatchCalendar();
        updateSelectedDatesDisplay();
    }
}


/**
 * 開啟不開放時段設定彈窗
 */
async function openSettingsModal() {
    const room = getSelectedRoom();
    document.getElementById('settingsRoomName').textContent = room;
    showToast('正在載入設定...', 'info');
    await loadRoomSettings(room); // 確保開啟時資料是最新的
    renderSettingsTable();
    document.getElementById('settingsModalOverlay').classList.add('active');
}

/**
 * 關閉設定彈窗
 */
function closeSettingsModal() {
    document.getElementById('settingsModalOverlay').classList.remove('active');
}

/**
 * 渲染設定表格矩陣
 */
function renderSettingsTable() {
    const tbody = document.getElementById('settingsTableBody');
    const dayIds = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

    tbody.innerHTML = PERIODS.map(period => `
        <tr>
            <td>${period.name}</td>
            ${dayIds.map(dayId => {
        const slotId = `${dayId}_${period.id}`;
        const isChecked = unavailableSlots.includes(slotId);
        return `<td><input type="checkbox" class="unavailable-check" data-slot="${slotId}" ${isChecked ? 'checked' : ''}></td>`;
    }).join('')}
        </tr>
    `).join('');
}

/**
 * 載入場地設定
 */
async function loadRoomSettings(room) {
    try {
        const doc = await db.collection('roomSettings').doc(room).get();
        if (doc.exists) {
            unavailableSlots = doc.data().unavailableSlots || [];
        } else {
            unavailableSlots = [];
        }
    } catch (error) {
        console.error('載入場地設定失敗:', error);
        unavailableSlots = [];
    }
}

/**
 * 儲存場地設定
 */
async function saveRoomSettings() {
    const room = getSelectedRoom();
    const checks = document.querySelectorAll('.unavailable-check:checked');
    const newSlots = Array.from(checks).map(cb => cb.dataset.slot);

    try {
        showToast('正在儲存設定...', 'info');
        await db.collection('roomSettings').doc(room).set({
            unavailableSlots: newSlots,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        unavailableSlots = newSlots;
        showToast('設定已儲存', 'success');
        closeSettingsModal();

        // 重新整理目前的畫面
        if (viewMode === 'week') {
            loadBookingsFromFirebase();
        } else {
            loadMonthBookings();
        }
    } catch (error) {
        console.error('儲存場地設定失敗:', error);
        showToast('儲存失敗: ' + error.message, 'error');
    }
}

// ===== 初始化 =====

document.addEventListener('DOMContentLoaded', () => {
    currentWeekStart = getMonday(new Date());
    currentMonth = new Date();
    displayMode = 'week';
    viewMode = 'week';
    rangeStartDate = null;
    rangeEndDate = null;

    initEventListeners();
    initSearchEventListeners();
    initHistoryEventListeners();
    initBatchBooking();
    sortRoomDropdownByUsage();   // v2.40.0 V.2 場地常用置頂
    initKeyboardShortcuts();     // v2.40.0 V.1 鍵盤快捷鍵
    loadBookingsFromFirebase();
});

// ===== AI 智慧預約建議核心邏輯 =====

/**
 * 尋找智慧替代方案
 * @param {string} dateStr 目標日期 (YYYY/MM/DD)
 * @param {string} periodId 目標節次 ID
 * @param {string} roomName 目標場地名稱
 */
async function findSmartAlternatives(dateStr, periodId, roomName) {
    const suggestions = [];
    const targetDate = parseDate(dateStr);
    const targetPeriod = PERIODS.find(p => p.id === periodId);

    // 準備查詢範圍：前後 7 天
    const startDate = new Date(targetDate);
    startDate.setDate(targetDate.getDate() - 7);
    const startDateStr = formatDate(startDate);

    const endDate = new Date(targetDate);
    endDate.setDate(targetDate.getDate() + 7);
    const endDateStr = formatDate(endDate);

    // 一次性查詢範圍內所有資料 (包含所有場地)
    // 這樣可以同時滿足 Strategy A (同場地不同日), B (同日不同場地), C (同日同場地不同時段)
    const snapshot = await bookingsCollection
        .where('date', '>=', startDateStr)
        .where('date', '<=', endDateStr)
        .get();

    const rangeBookings = [];
    snapshot.forEach(doc => {
        rangeBookings.push(doc.data());
    });

    // 輔助：檢查是否被預約 (基於本次查詢結果)
    function isBookedInRange(checkDateStr, checkPeriodId, checkRoom) {
        return rangeBookings.some(b =>
            b.date === checkDateStr &&
            (b.room || '禮堂') === checkRoom &&
            b.periods.includes(checkPeriodId)
        );
    }

    // 1. [策略 A] 同場地，鄰近日期 (前後 7 天)
    for (let i = 1; i <= 7; i++) {
        // 往前找
        const prevDate = new Date(targetDate);
        prevDate.setDate(targetDate.getDate() - i);
        const prevDateStr = formatDate(prevDate);

        if (prevDate >= new Date()) { // 不找過去的時間
            // 檢查預約 & 固定不開放 (假設固定不開放設定不隨日期變動，或是全域的)
            // 註：unavailableSlots 僅針對「當前選定場地」。若 targetRoom 即為當前選定場地，則可直接用。
            // 若不是 (例如在 dashboard 觸發?)，則可能不準。但此函式目前主要在 modal (已選定 room) 觸發。
            if (!isBookedInRange(prevDateStr, periodId, roomName) && !isPeriodUnavailable(prevDate, periodId)) {
                suggestions.push({
                    type: 'date',
                    date: prevDateStr,
                    period: periodId,
                    room: roomName,
                    score: 100 - i * 5,
                    desc: `前 ${i} 天同一時段`
                });
            }
        }

        // 往後找
        const nextDate = new Date(targetDate);
        nextDate.setDate(targetDate.getDate() + i);
        const nextDateStr = formatDate(nextDate);

        if (!isBookedInRange(nextDateStr, periodId, roomName) && !isPeriodUnavailable(nextDate, periodId)) {
            suggestions.push({
                type: 'date',
                date: nextDateStr,
                period: periodId,
                room: roomName,
                score: 100 - i * 5,
                desc: `後 ${i} 天同一時段`
            });
        }
    }

    // 2. [策略 B] 同時段，其他場地
    const similarRooms = {
        '禮堂': ['智慧教室C304'],
        '智慧教室C304': ['電腦教室(一)C212', '電腦教室(二)C213'],
        '電腦教室(一)C212': ['電腦教室(二)C213', '智慧教室C304'],
        '電腦教室(二)C213': ['電腦教室(一)C212', '智慧教室C304'],
        '三年級IPAD車(28台)': ['四年級IPAD車(28台)', '五年級IPAD車(28台)', '六年級IPAD車(29台)'],
        '四年級IPAD車(28台)': ['三年級IPAD車(28台)', '五年級IPAD車(28台)', '六年級IPAD車(29台)'],
        '五年級IPAD車(28台)': ['三年級IPAD車(28台)', '四年級IPAD車(28台)', '六年級IPAD車(29台)'],
        '六年級IPAD車(29台)': ['三年級IPAD車(28台)', '四年級IPAD車(28台)', '五年級IPAD車(28台)'],
    };

    const recommendedRooms = similarRooms[roomName] || ROOMS.filter(r => r !== roomName);

    recommendedRooms.forEach(otherRoom => {
        // 檢查該場地是否被預約
        const isOccupied = isBookedInRange(dateStr, periodId, otherRoom);

        // 檢查是否為不開放 (需額外邏輯，暫略)
        // 這裡我們假設其他場地沒有特殊的 "固定不開放"，或者我們無法得知 (因沒載入設定)。
        // 為了避免推薦了也不能用的，理想上應 fetch 設定。但為求效能，暫時忽略。

        if (!isOccupied) {
            const isSimilar = (similarRooms[roomName] || []).includes(otherRoom);
            suggestions.push({
                type: 'room',
                date: dateStr,
                period: periodId,
                room: otherRoom,
                score: isSimilar ? 95 : 80,
                desc: `同時間可用的 ${otherRoom}`
            });
        }
    });

    // 3. [策略 C] 同場地，鄰近節次 (前後 2 節)
    const periodIndex = PERIODS.findIndex(p => p.id === periodId);
    if (periodIndex !== -1) {
        [-2, -1, 1, 2].forEach(offset => {
            const newIndex = periodIndex + offset;
            if (newIndex >= 0 && newIndex < PERIODS.length) {
                const newPeriod = PERIODS[newIndex];
                if (!isBookedInRange(dateStr, newPeriod.id, roomName) && !isPeriodUnavailable(targetDate, newPeriod.id)) {
                    suggestions.push({
                        type: 'period',
                        date: dateStr,
                        period: newPeriod.id,
                        room: roomName,
                        score: 90 - Math.abs(offset) * 10,
                        desc: `當天 ${newPeriod.time}`
                    });
                }
            }
        });
    }

    // 排序並取前 3 名
    return suggestions
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
}

/**
 * 輔助：檢查特定場地的特定時段是否為固定不開放
 * (維持原用全域變數 unavailableSlots 的邏輯，僅適用於「當前選定場地」)
 */
function isPeriodUnavailable(date, periodId) {
    const dayId = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
    const slotId = `${dayId}_${periodId}`;
    return unavailableSlots.includes(slotId);
}

function isPeriodUnavailableInRoom(date, periodId, roomName) {
    // 理想狀況應讀取該場地設定。
    // 暫時回傳 false，不阻擋建議 (讓最後提交時再檢查)
    return false;
}

/**
 * 顯示智慧建議
 */
async function showSmartSuggestions(periodId) {
    const container = document.getElementById('smartSuggestions');
    const list = document.getElementById('suggestionsList');

    // 顯示載入中
    container.classList.remove('hidden');
    list.innerHTML = '<div class="loading-text" style="color:#666;text-align:center;padding:10px;">🔍 AI 正在分析最佳替代方案...</div>';

    const room = document.getElementById('modalRoomSelect').value;
    const date = document.getElementById('modalDate').textContent;

    try {
        const suggestions = await findSmartAlternatives(date, periodId, room);

        list.innerHTML = '';
        if (suggestions.length === 0) {
            list.innerHTML = '<div style="color:#666;text-align:center;padding:10px;">找不到合適的替代方案 😅</div>';
            return;
        }

        suggestions.forEach(s => {
            const pName = PERIODS.find(p => p.id === s.period).name;
            const wName = getWeekdayName(parseDate(s.date));
            const typeLabel = s.type === 'room' ? '🏢 換教室' : (s.type === 'date' ? '📅 換日期' : '⏱️ 換時段');
            const typeColor = s.type === 'room' ? '#10b981' : (s.type === 'date' ? '#3b82f6' : '#8b5cf6');

            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.innerHTML = `
                <div class="suggestion-info">
                    <span class="suggestion-main">
                        <span style="font-size:0.75rem; background:${typeColor}20; color:${typeColor}; padding:2px 8px; border-radius:12px; font-weight:700; border:1px solid ${typeColor}40;">${typeLabel}</span>
                        ${s.date}
                    </span>
                    <span class="suggestion-sub">
                        <strong>${s.room}</strong> - ${pName} (${wName})
                    </span>
                    <span class="suggestion-sub" style="color:#f97316; font-weight:600; font-style:italic;">
                        ✨ ${s.desc}
                    </span>
                </div>
                <button class="btn-apply-suggestion">立即使用 🚀</button>
            `;

            card.addEventListener('click', () => applySuggestion(s));
            list.appendChild(card);
        });

        // 自動捲動到建議區域 (提升 UX)
        setTimeout(() => {
            container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);


    } catch (error) {
        console.error('AI 建議分析失敗:', error);
        list.innerHTML = '<div style="color:red;text-align:center;">分析發生錯誤</div>';
    }
}

/**
 * 應用建議
 */
function applySuggestion(suggestion) {
    // 1. 更新日期
    selectedDate = suggestion.date;
    document.getElementById('modalDate').textContent = selectedDate;
    document.getElementById('repeatFrequency').textContent = `每週${getWeekdayName(parseDate(selectedDate))}`;

    // 2. 更新場地 (若不同)
    const roomSelect = document.getElementById('modalRoomSelect');
    if (roomSelect.value !== suggestion.room) {
        roomSelect.value = suggestion.room;
        // 觸發場地變更邏輯 (例如重新載入 unavailableSlots)
        // 這裡簡化：直接呼叫載入設定
        loadRoomSettings(suggestion.room).then(() => {
            renderPeriodCheckboxes(selectedDate);
            checkSuggestionPeriod(suggestion.period);
        });
    } else {
        renderPeriodCheckboxes(selectedDate);
        checkSuggestionPeriod(suggestion.period);
    }

    // 3. 隱藏建議區
    document.getElementById('smartSuggestions').classList.add('hidden');

    // 4. 提示
    showToast('已切換至建議時段，請確認後預約', 'success');
}

/**
 * 勾選指定節次
 */
function checkSuggestionPeriod(periodId) {
    const cb = document.getElementById(`period_${periodId}`);
    if (cb && !cb.disabled) {
        cb.checked = true;
    }
}
/**
 * 輔助：捲動至日曆區域
 */
function scrollToCalendar() {
    const calendarContainer = document.querySelector('.calendar-container');
    if (calendarContainer) {
        setTimeout(() => {
            calendarContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
    }
}
// ===== 資料匯出與報表功能 =====

// (Legacy exportToCSV removed)

/**
 * 產生月報表
 */
function generateMonthlyReport() {
    if (!bookings || bookings.length === 0) {
        showToast('目前沒有預約資料可分析', 'info');
        return;
    }

    const currentMonthStr = currentMonth.toISOString().slice(0, 7); // YYYY-MM
    const monthBookings = bookings.filter(b => b.date.startsWith(currentMonthStr));

    if (monthBookings.length === 0) {
        showToast(`${currentMonthStr} 無預約資料`, 'info');
        return;
    }

    // 統計計算
    const totalBookings = monthBookings.length;

    // 場地使用率
    const roomCounts = {};
    monthBookings.forEach(b => roomCounts[b.room] = (roomCounts[b.room] || 0) + 1);
    const sortedRooms = Object.entries(roomCounts).sort((a, b) => b[1] - a[1]);

    // 熱門時段
    const periodCounts = {};
    monthBookings.forEach(b => {
        const pName = PERIODS.find(p => p.id === b.period)?.name || b.period;
        periodCounts[pName] = (periodCounts[pName] || 0) + 1;
    });
    const sortedPeriods = Object.entries(periodCounts).sort((a, b) => b[1] - a[1]);

    // 活躍預約者
    const userCounts = {};
    monthBookings.forEach(b => userCounts[b.booker] = (userCounts[b.booker] || 0) + 1);
    const sortedUsers = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // 產生報告內容
    let report = `【${currentMonthStr} 預約統計月報】\n\n`;
    report += `總預約數: ${totalBookings} 筆\n\n`;

    report += `🏆 熱門場地排行榜:\n`;
    sortedRooms.forEach(([room, count]) => {
        const percentage = Math.round((count / totalBookings) * 100);
        report += `- ${room}: ${count} 次 (${percentage}%)\n`;
    });

    report += `\n⏰ 熱門時段分佈:\n`;
    sortedPeriods.forEach(([period, count]) => {
        report += `- ${period}: ${count} 次\n`;
    });

    report += `\n👤 活躍預約者 Top 5:\n`;
    sortedUsers.forEach(([user, count]) => {
        report += `- ${user}: ${count} 次\n`;
    });

    // 下載報告
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `預約月報_${currentMonthStr}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * 初始化匯出按鈕監聽器
 */
function setupExportButtons() {
    const btnCSV = document.getElementById('btnExportCSV');
    const btnReport = document.getElementById('btnExportReport');

    if (btnCSV) {
        btnCSV.addEventListener('click', exportToCSV);
    }

    if (btnReport) {
        btnReport.addEventListener('click', generateMonthlyReport);
    }
}

// 確保在頁面載入且 DOM 元素存在後初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延遲一點點確保 HTML 結構完整 (雖然 dashboard 在靜態 HTML中)
    setTimeout(setupExportButtons, 500);
});


// ===== PWA 安裝提示功能 =====

let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    // 防止 Chrome 67 及更早版本自動顯示安裝提示
    e.preventDefault();
    // 儲存事件以便稍後觸發
    deferredPrompt = e;
    // 更新 UI 通知使用者可以安裝 (檢查是否已 dismissed)
    if (!sessionStorage.getItem('pwaDismissed')) {
        showInstallPromotion();
    }
});

function showInstallPromotion() {
    const prompt = document.getElementById('pwa-install-prompt');
    const btnInstall = document.getElementById('btnPwaInstall');
    const btnDismiss = document.getElementById('btnPwaDismiss');

    if (prompt) {
        prompt.classList.remove('hidden');

        // 安裝按鈕
        btnInstall.addEventListener('click', async () => {
            prompt.classList.add('hidden');
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredPrompt = null;
        });

        // 稍後再說按鈕
        btnDismiss.addEventListener('click', () => {
            prompt.classList.add('dismissed');
            // 存入 SessionStorage，本次會話不再顯示
            sessionStorage.setItem('pwaDismissed', 'true');
            setTimeout(() => {
                prompt.classList.add('hidden');
            }, 600); // 等待動畫結束
        });
    }
}

window.addEventListener('appinstalled', () => {
    const prompt = document.getElementById('pwa-install-prompt');
    if (prompt) {
        prompt.classList.add('hidden');
    }
    // 清除 deferredPrompt
    deferredPrompt = null;
    console.log('PWA was installed');
    showToast('已成功安裝應用程式！', 'success');
});

// ===== 系統稽核日誌 (Audit Logs) =====

/**
 * 記錄系統操作日誌
 * @param {string} action 操作名稱 (e.g., 'DELETE_BOOKING', 'EXPORT_CSV')
 * @param {object} details 詳細資訊
 * @param {string} targetId 目標 ID (可選)
 */
async function logSystemAction(action, details = {}, targetId = null) {
    try {
        const currentUser = firebase.auth().currentUser;
        const localDeviceId = localStorage.getItem('deviceId') || 'unknown';

        let ip = 'unknown';
        try {
            const ipRes = await fetch('https://api.ipify.org?format=json');
            if (ipRes.ok) {
                const ipData = await ipRes.json();
                ip = ipData.ip;
            }
        } catch (e) {
            // Ignore IP fetch error
        }

        const logData = {
            action: action,
            targetId: targetId || 'N/A',
            details: details,
            performedBy: currentUser ? currentUser.uid : 'Guest',
            userEmail: currentUser ? currentUser.email : null,
            deviceId: localDeviceId,
            userAgent: navigator.userAgent,
            ip: ip,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('audit_logs').add(logData);
        console.log(`[Audit] ${action} logged.`);
    } catch (error) {
        console.error('Failed to log action:', error);
    }
}

/**
 * 載入並顯示稽核日誌
 */
// v2.43.0: 完整 action 對應表 (含 v2.41 新增的 actions)
const AUDIT_ACTION_META = {
    CREATE_BOOKING:           { name: '建立預約',      class: 'action-create',  icon: '📅' },
    DELETE_BOOKING:           { name: '取消預約',      class: 'action-delete',  icon: '🗑' },
    FORCE_DELETE_BOOKING:     { name: '強制刪除',      class: 'action-warning', icon: '⚠' },
    UNDO_BOOKING:             { name: '撤銷預約',      class: 'action-undo',    icon: '↩' },
    BATCH_CANCEL_BOOKINGS:    { name: '批次取消',      class: 'action-batch',   icon: '✂' },
    CREATE_ANNOUNCEMENT:      { name: '建立場地公告',  class: 'action-create',  icon: '📢' },
    UPDATE_ANNOUNCEMENT:      { name: '更新場地公告',  class: 'action-update',  icon: '✏' },
    DELETE_ANNOUNCEMENT:      { name: '刪除場地公告',  class: 'action-warning', icon: '🗑' },
    EXPORT_CSV:               { name: '匯出 CSV',      class: 'action-export',  icon: '📥' },
    ADMIN_LOGIN:              { name: '管理員登入',    class: 'action-login',   icon: '🔑' },
};

/**
 * v2.43.0: 格式化詳情為人類可讀字串
 */
function formatAuditDetails(log) {
    const d = log.details || {};
    switch (log.action) {
        case 'CREATE_BOOKING':
            return `${d.booker || '?'} 預約 ${d.room || '?'} ${d.dates?.length || 1} 個日期 ${d.periods?.length || 0} 節 (${d.reason?.substring(0, 30) || '無理由'})`;
        case 'DELETE_BOOKING':
        case 'FORCE_DELETE_BOOKING':
            return `預約人: ${d.booker || '?'} | 原因: ${(d.reason || '無').substring(0, 40)} | 節次: ${d.period || 'ALL'}`;
        case 'UNDO_BOOKING':
            return `撤銷 ${d.count || 0} 筆 (Gmail 風格 30 秒內)`;
        case 'BATCH_CANCEL_BOOKINGS':
            return `批次取消 ${d.successCount || 0} / ${d.attemptedCount || 0} 筆 (執行者: ${d.executedBy || '?'}, 過濾: ${d.filteredOut || 0})`;
        case 'CREATE_ANNOUNCEMENT':
        case 'UPDATE_ANNOUNCEMENT':
            return `${d.room || '?'} | ${d.importance || 'info'} | ${(d.message || '').substring(0, 40)} | ${d.startDate || ''} ~ ${d.endDate || ''}`;
        case 'DELETE_ANNOUNCEMENT':
            return `刪除公告: ${d.before?.room || '?'} | ${(d.before?.message || '').substring(0, 40)}`;
        case 'EXPORT_CSV':
            return `匯出 ${d.count || 0} 筆預約記錄`;
        case 'ADMIN_LOGIN':
            return `登入 email: ${d.email || '?'}`;
        default:
            try {
                const clone = { ...d };
                delete clone.userAgent;
                const json = JSON.stringify(clone);
                return json.length > 80 ? json.substring(0, 80) + '...' : json;
            } catch { return ''; }
    }
}

async function loadAuditLogs() {
    const list = document.getElementById('auditLogList');
    if (!list) return;

    list.innerHTML = '<div class="loading-spinner"></div>';

    // v2.43.0: 讀取篩選條件
    const filterAction = document.getElementById('auditFilterAction')?.value || '';
    const filterUser = document.getElementById('auditFilterUser')?.value.trim().toLowerCase() || '';
    const filterDateFrom = document.getElementById('auditFilterDateFrom')?.value || '';
    const filterDateTo = document.getElementById('auditFilterDateTo')?.value || '';

    try {
        let query = db.collection('audit_logs').orderBy('timestamp', 'desc');

        // 伺服器端篩選 (action + 日期)
        if (filterAction) {
            query = query.where('action', '==', filterAction);
        }
        if (filterDateFrom) {
            query = query.where('timestamp', '>=', new Date(filterDateFrom + 'T00:00:00'));
        }
        if (filterDateTo) {
            query = query.where('timestamp', '<=', new Date(filterDateTo + 'T23:59:59'));
        }

        // 預設限制 200 筆 (避免過大)
        query = query.limit(200);
        const snapshot = await query.get();

        // 前端篩選 (使用者搜尋)
        let logs = [];
        snapshot.forEach(doc => {
            const log = { id: doc.id, ...doc.data() };
            if (filterUser) {
                const haystack = [
                    log.userEmail || '',
                    log.performedBy || '',
                    log.details?.booker || '',
                    log.deviceId || ''
                ].join(' ').toLowerCase();
                if (!haystack.includes(filterUser)) return;
            }
            logs.push(log);
        });

        // v2.43.0: 統計列
        const statsEl = document.getElementById('auditStatsBar');
        if (statsEl) {
            const actionCounts = {};
            logs.forEach(l => {
                actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
            });
            const topActions = Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([action, count]) => {
                    const meta = AUDIT_ACTION_META[action] || { icon: '📝', name: action };
                    return `<span class="audit-stat-chip">${meta.icon} ${meta.name}: ${count}</span>`;
                }).join('');
            statsEl.innerHTML = `
                <span class="audit-stat-chip primary">總計 ${logs.length} 筆</span>
                ${topActions}
            `;
        }

        if (logs.length === 0) {
            list.innerHTML = '<div class="no-data">📭 無符合條件的日誌</div>';
            return;
        }

        list.innerHTML = '';
        logs.forEach(log => {
            const date = log.timestamp ? log.timestamp.toDate() : new Date();
            const timeStr = date.toLocaleString('zh-TW', {
                month: 'numeric', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            const meta = AUDIT_ACTION_META[log.action] || { name: log.action, class: 'action-other', icon: '📝' };
            const detailsStr = formatAuditDetails(log);
            const userLabel = log.userEmail ? log.userEmail.split('@')[0] : (log.performedBy === 'Guest' ? '訪客' : 'System');
            const ipLabel = log.ip || 'Unknown IP';
            const deviceLabel = log.deviceId ? log.deviceId.substring(0, 12) + '...' : '';

            const item = document.createElement('div');
            item.className = `audit-log-item ${meta.class}`;

            // v2.43.0: 加入展開原始 JSON 的 details 元素
            item.innerHTML = `
                <div class="log-header">
                    <span class="log-action">${meta.icon} ${meta.name}</span>
                    <span class="log-time">${timeStr}</span>
                </div>
                <div class="log-details">${escapeHtml(detailsStr)}</div>
                <div class="log-meta">
                    <span class="meta-item">👤 ${escapeHtml(userLabel)}</span>
                    <span class="meta-item">🌐 ${escapeHtml(ipLabel)}</span>
                    ${deviceLabel ? `<span class="meta-item">📱 ${escapeHtml(deviceLabel)}</span>` : ''}
                    <button class="meta-expand-btn" type="button" data-log-id="${log.id}">📋 原始 JSON</button>
                </div>
                <pre class="log-raw-json" id="raw-${log.id}" style="display:none;">${escapeHtml(JSON.stringify(log, null, 2))}</pre>
            `;
            list.appendChild(item);
        });

        // 綁定展開按鈕
        list.querySelectorAll('.meta-expand-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.logId;
                const pre = document.getElementById(`raw-${id}`);
                if (pre) {
                    const isShown = pre.style.display !== 'none';
                    pre.style.display = isShown ? 'none' : 'block';
                    btn.textContent = isShown ? '📋 原始 JSON' : '📋 收起';
                }
            });
        });

    } catch (error) {
        console.error('Load logs error:', error);
        list.innerHTML = '<div class="error-text">❌ 載入失敗: ' + escapeHtml(error.message || '') + '</div>';
    }
}



/**
 * 匯出系統日誌 (Audit Logs) 至 CSV
 */
async function exportLogsToCSV() {
    try {
        const confirmExport = confirm('確定要匯出「系統操作日誌」嗎？\n(包含刪除、登入、匯出紀錄)');
        if (!confirmExport) return;

        showToast('正在下載日誌資料...', 'info');

        // 1. 獲取日誌 (OrderBy Timestamp Desc)
        const snapshot = await db.collection('audit_logs').orderBy('timestamp', 'desc').get();

        if (snapshot.empty) {
            showToast('沒有日誌資料', 'warning');
            return;
        }

        // 2. CSV Header
        const headers = [
            '時間',
            '操作類型',
            '詳細內容',
            '操作者',
            'IP位址',
            'User Agent'
        ];

        const rows = [headers.join(',')];

        // 3. Process Data
        snapshot.forEach(doc => {
            const log = doc.data();

            const timeStr = log.timestamp
                ? new Date(log.timestamp.toDate()).toLocaleString('zh-TW', { hour12: false })
                : '未知時間';

            const escape = (str) => {
                if (str === null || str === undefined) return '';
                str = String(str).replace(/"/g, '""');
                if (str.includes(',') || str.includes('\n') || str.includes('"')) return `"${str}"`;
                return str;
            };

            // Action Translation
            let actionName = log.action;
            if (log.action === 'DELETE_BOOKING') actionName = '刪除預約';
            else if (log.action === 'FORCE_DELETE_BOOKING') actionName = '強制刪除';
            else if (log.action === 'EXPORT_CSV') actionName = '匯出預約';
            else if (log.action === 'ADMIN_LOGIN') actionName = '管理員登入';

            const userLabel = log.userEmail || (log.performedBy === 'Guest' ? '訪客' : log.performedBy) || 'System';

            // 確保 details 是字串
            let detailsStr = '';
            try {
                detailsStr = typeof log.details === 'string' ? log.details : JSON.stringify(log.details || {});
            } catch (e) {
                detailsStr = 'Format Error';
            }

            rows.push([
                escape(timeStr),
                escape(actionName),
                escape(detailsStr),
                escape(userLabel),
                escape(log.ip || '-'),
                escape(log.userAgent || '-')
            ].join(','));
        });

        // 4. Download
        const csvContent = '\uFEFF' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
        link.href = url;
        link.download = `系統日誌匯出_${timestamp}.csv`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up

        showToast(`✅ 成功匯出 ${snapshot.size} 筆日誌`, 'success');

    } catch (error) {
        console.error('日誌匯出失敗:', error);
        showToast('❌ 日誌匯出失敗', 'error');
    }
}

// ===== 初始化事件監聽 =====

// ===== 初始化事件監聽 (Event Delegation for Robustness) =====

document.addEventListener('click', (e) => {
    // 匯出日誌按鈕 (Logs)
    const btnLogs = e.target.closest('#btnExportLogs');
    if (btnLogs) {
        e.preventDefault();
        console.log('📌 Export Logs button clicked (via Delegation)');
        exportLogsToCSV();
        return;
    }

    // 匯出報表按鈕 (Report)
    const btnReport = e.target.closest('#btnExportReport');
    if (btnReport) {
        e.preventDefault();
        console.log('📌 Export Report button clicked (via Delegation)');
        generateMonthlyReport();
        return;
    }

    // 匯出 CSV 按鈕 (CSV)
    const btnCsv = e.target.closest('#btnExportCSV');
    if (btnCsv) {
        e.preventDefault();
        console.log('📌 Export CSV button clicked (via Delegation)');
        exportToCSV();
        return;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('✅ App initialized with Event Delegation for Dashboard buttons');
    // 其他初始化...
});

// ===== v2.40.0 (V.1): 鍵盤快捷鍵 =====

const KEYBOARD_SHORTCUTS = [
    { key: 'N',          desc: '新預約 (今天)' },
    { key: 'H',          desc: '開啟歷史紀錄' },
    { key: 'S',          desc: '開啟搜尋' },
    { key: 'T',          desc: '跳到本週/本月' },
    { key: '←',          desc: '上一週 / 上個月' },
    { key: '→',          desc: '下一週 / 下個月' },
    { key: '1',          desc: '切換到週視圖' },
    { key: '2',          desc: '切換到月視圖' },
    { key: 'D',          desc: '開啟管理員儀表板' },
    { key: 'Esc',        desc: '關閉所有彈窗' },
    { key: 'Ctrl+Enter', desc: '送出預約 (彈窗開啟時)' },
    { key: '?',          desc: '顯示此說明' },
];

/**
 * 判斷是否處於可輸入狀態 (input/textarea/select/contenteditable)
 */
function isTypingFocus() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
}

/**
 * 是否有任何彈窗開啟
 */
function isAnyModalOpen() {
    return document.querySelectorAll('.modal-overlay.active').length > 0
        || document.querySelectorAll('[id$="ModalOverlay"].active').length > 0;
}

/**
 * 關閉所有彈窗
 */
function closeAllModals() {
    document.querySelectorAll('.modal-overlay.active, [id$="ModalOverlay"].active')
        .forEach(el => el.classList.remove('active'));
    // 關閉鍵盤說明彈窗
    const help = document.getElementById('keyboardHelpOverlay');
    if (help) help.classList.remove('active');
}

/**
 * 顯示鍵盤快捷鍵說明 (動態建立 / 已存在則直接顯示)
 */
function showKeyboardHelp() {
    let overlay = document.getElementById('keyboardHelpOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'keyboardHelpOverlay';
        overlay.className = 'modal-overlay keyboard-help-overlay';
        overlay.innerHTML = `
            <div class="modal keyboard-help-modal">
                <div class="modal-header">
                    <h2>⌨️ 鍵盤快捷鍵</h2>
                    <button class="btn-close" type="button" aria-label="關閉">×</button>
                </div>
                <div class="modal-body">
                    <table class="keyboard-help-table">
                        <thead>
                            <tr><th style="width:35%">按鍵</th><th>動作</th></tr>
                        </thead>
                        <tbody>
                            ${KEYBOARD_SHORTCUTS.map(s => `
                                <tr>
                                    <td><kbd>${s.key}</kbd></td>
                                    <td>${s.desc}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <p class="keyboard-help-hint">💡 在輸入框輸入時快捷鍵會自動關閉，避免干擾打字</p>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.querySelector('.btn-close').addEventListener('click', () => overlay.classList.remove('active'));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    }
    overlay.classList.add('active');
}

/**
 * 跳到本週 (週視圖) 或本月 (月視圖)
 */
function jumpToToday() {
    if (viewMode === 'week') {
        currentWeekStart = getMonday(new Date());
        displayMode = 'week';
        rangeStartDate = null;
        rangeEndDate = null;
        loadBookingsFromFirebase();
    } else {
        currentMonth = new Date();
        loadMonthBookings();
    }
    showToast('已跳到今天', 'info');
}

/**
 * 初始化鍵盤快捷鍵監聽
 */
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // 處於輸入狀態時，僅允許 Esc 與 Ctrl+Enter
        const isTyping = isTypingFocus();

        // Esc - 關閉所有彈窗 (任何時候)
        if (e.key === 'Escape') {
            if (isAnyModalOpen()) {
                e.preventDefault();
                closeAllModals();
            }
            return;
        }

        // Ctrl+Enter - 送出預約 (彈窗開啟時)
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            const submitBtn = document.getElementById('btnModalSubmit');
            if (submitBtn && !submitBtn.disabled
                && document.getElementById('modalOverlay')?.classList.contains('active')) {
                e.preventDefault();
                submitBtn.click();
            }
            return;
        }

        // 其他快捷鍵：輸入中或彈窗開啟時不觸發
        if (isTyping || isAnyModalOpen()) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        switch (e.key) {
            case 'n': case 'N':
                e.preventDefault();
                openBookingModal(formatDate(new Date()));
                break;
            case 'h': case 'H':
                e.preventDefault();
                document.getElementById('btnHistory')?.click();
                break;
            case 's': case 'S':
                e.preventDefault();
                document.getElementById('btnAdvancedSearch')?.click();
                break;
            case 't': case 'T':
                e.preventDefault();
                jumpToToday();
                break;
            case 'd': case 'D':
                e.preventDefault();
                document.getElementById('btnOpenDashboard')?.click();
                break;
            case '1':
                e.preventDefault();
                switchView('week');
                break;
            case '2':
                e.preventDefault();
                switchView('month');
                break;
            case 'ArrowLeft':
                e.preventDefault();
                document.getElementById('btnPrev')?.click();
                break;
            case 'ArrowRight':
                e.preventDefault();
                document.getElementById('btnNext')?.click();
                break;
            case '?':
                e.preventDefault();
                showKeyboardHelp();
                break;
        }
    });

    console.log('✅ Keyboard shortcuts initialized (press ? for help)');
}

// ==========================================================================
// v2.41.0 (M.1): 場地維護公告系統
// ==========================================================================

let cachedAnnouncements = [];   // 全域快取，啟動時載入一次

/**
 * 載入所有公告 (供管理 UI + 預約彈窗 banner 使用)
 */
async function loadAllAnnouncements() {
    try {
        const snapshot = await announcementsCollection
            .orderBy('startDate', 'desc')
            .get();
        cachedAnnouncements = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        return cachedAnnouncements;
    } catch (err) {
        console.error('[Announcements] 載入失敗', err);
        return [];
    }
}

/**
 * 取得指定場地、指定日期當下生效中的公告
 * @param {string} room
 * @param {string} dateStr 'YYYY/MM/DD' (預設今天)
 * @returns {Array} 生效中的公告陣列
 */
function getActiveAnnouncements(room, dateStr) {
    if (!room) return [];
    const target = dateStr || formatDate(new Date());
    return cachedAnnouncements.filter(a =>
        a.room === room && a.startDate <= target && a.endDate >= target
    );
}

/**
 * 是否該日該場地有「鎖定預約」公告 → 阻擋預約
 */
function isRoomLockedByAnnouncement(room, dateStr) {
    return getActiveAnnouncements(room, dateStr).some(a => a.lockBookings === true);
}

/**
 * 顯示公告管理彈窗
 */
async function openAnnouncementManager() {
    const overlay = document.getElementById('announcementModalOverlay');
    if (!overlay) return;
    overlay.classList.add('active');
    resetAnnouncementForm();
    await loadAllAnnouncements();
    renderAnnouncementList();
}

function closeAnnouncementManager() {
    document.getElementById('announcementModalOverlay')?.classList.remove('active');
}

function resetAnnouncementForm() {
    const form = document.getElementById('announcementForm');
    if (!form) return;
    form.reset();
    document.getElementById('annEditId').value = '';
    document.getElementById('btnAnnSubmit').textContent = '💾 儲存公告';
}

/**
 * 渲染現有公告列表
 */
function renderAnnouncementList() {
    const list = document.getElementById('announcementList');
    if (!list) return;
    if (cachedAnnouncements.length === 0) {
        list.innerHTML = `<p class="ann-empty">尚無任何公告。請使用上方表單新增。</p>`;
        return;
    }
    const today = formatDate(new Date());
    list.innerHTML = cachedAnnouncements.map(a => {
        const isActive = a.startDate <= today && a.endDate >= today;
        const isExpired = a.endDate < today;
        const statusBadge = isActive
            ? `<span class="ann-badge ann-badge-active">🟢 生效中</span>`
            : isExpired
                ? `<span class="ann-badge ann-badge-expired">⏷ 已過期</span>`
                : `<span class="ann-badge ann-badge-future">⏰ 未生效</span>`;
        const importanceIcon = a.importance === 'critical' ? '🚨'
            : a.importance === 'warning' ? '⚠'
            : 'ℹ';
        const lockHint = a.lockBookings ? `<span class="ann-lock">🔒 已鎖定預約</span>` : '';
        return `
            <div class="announcement-item ann-imp-${a.importance}">
                <div class="ann-item-head">
                    <span class="ann-item-room">${importanceIcon} ${a.room}</span>
                    ${statusBadge}
                    ${lockHint}
                </div>
                <div class="ann-item-dates">${a.startDate} ~ ${a.endDate}</div>
                <div class="ann-item-msg">${escapeHtml(a.message)}</div>
                <div class="ann-item-actions">
                    <button class="btn-ann-edit" data-id="${a.id}" type="button">✏ 編輯</button>
                    <button class="btn-ann-delete" data-id="${a.id}" type="button">🗑 刪除</button>
                </div>
            </div>
        `;
    }).join('');

    // 綁定事件
    list.querySelectorAll('.btn-ann-edit').forEach(btn => {
        btn.addEventListener('click', () => loadAnnouncementToForm(btn.dataset.id));
    });
    list.querySelectorAll('.btn-ann-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteAnnouncement(btn.dataset.id));
    });
}

function loadAnnouncementToForm(id) {
    const a = cachedAnnouncements.find(x => x.id === id);
    if (!a) return;
    document.getElementById('annEditId').value = a.id;
    document.getElementById('annRoom').value = a.room;
    document.getElementById('annImportance').value = a.importance;
    document.getElementById('annStartDate').value = a.startDate.replaceAll('/', '-');
    document.getElementById('annEndDate').value = a.endDate.replaceAll('/', '-');
    document.getElementById('annMessage').value = a.message;
    document.getElementById('annLockBookings').checked = !!a.lockBookings;
    document.getElementById('btnAnnSubmit').textContent = '💾 更新公告';
    document.getElementById('annMessage').focus();
}

async function submitAnnouncementForm(e) {
    if (e) e.preventDefault();
    if (!firebase.auth().currentUser) {
        showToast('請先以管理員身份登入', 'warning');
        return;
    }
    const editId = document.getElementById('annEditId').value;
    const room = document.getElementById('annRoom').value;
    const importance = document.getElementById('annImportance').value;
    const startDateRaw = document.getElementById('annStartDate').value;
    const endDateRaw = document.getElementById('annEndDate').value;
    const message = document.getElementById('annMessage').value.trim();
    const lockBookings = document.getElementById('annLockBookings').checked;

    if (!startDateRaw || !endDateRaw || !message) {
        showToast('請完整填寫所有欄位', 'warning');
        return;
    }
    if (startDateRaw > endDateRaw) {
        showToast('開始日期不能晚於結束日期', 'warning');
        return;
    }

    const data = {
        room,
        importance,
        startDate: startDateRaw.replaceAll('-', '/'),
        endDate: endDateRaw.replaceAll('-', '/'),
        message,
        lockBookings,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const submitBtn = document.getElementById('btnAnnSubmit');
    submitBtn.disabled = true;
    try {
        if (editId) {
            await announcementsCollection.doc(editId).update(data);
            showToast('✅ 公告已更新', 'success');
            // v2.43.0 (1.8): 稽核日誌 - 更新公告
            logSystemAction('UPDATE_ANNOUNCEMENT', { id: editId, ...data }, editId);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            const docRef = await announcementsCollection.add(data);
            showToast('✅ 公告已建立', 'success');
            // v2.43.0 (1.8): 稽核日誌 - 建立公告
            logSystemAction('CREATE_ANNOUNCEMENT', { id: docRef.id, ...data }, docRef.id);
        }
        await loadAllAnnouncements();
        renderAnnouncementList();
        resetAnnouncementForm();
    } catch (err) {
        console.error('[Announcements] 儲存失敗', err);
        showToast('儲存失敗，請檢查權限', 'error');
    } finally {
        submitBtn.disabled = false;
    }
}

async function deleteAnnouncement(id) {
    if (!confirm('確定要刪除這則公告嗎？此動作無法復原。')) return;
    try {
        // v2.43.0: 刪除前先撈內容供稽核
        const snapshot = await announcementsCollection.doc(id).get();
        const beforeData = snapshot.exists ? snapshot.data() : null;

        await announcementsCollection.doc(id).delete();
        await loadAllAnnouncements();
        renderAnnouncementList();
        showToast('✅ 公告已刪除', 'success');

        // v2.43.0 (1.8): 稽核日誌 - 刪除公告 (含原內容快照)
        logSystemAction('DELETE_ANNOUNCEMENT', { id, before: beforeData }, id);
    } catch (err) {
        console.error('[Announcements] 刪除失敗', err);
        showToast('刪除失敗', 'error');
    }
}

/**
 * 在預約彈窗顯示對應場地的公告 banner
 * @param {string} room
 * @param {string} dateStr
 */
function renderAnnouncementBannerInBookingModal(room, dateStr) {
    const banner = document.getElementById('modalAnnouncementBanner');
    if (!banner) return;
    const active = getActiveAnnouncements(room, dateStr);
    if (active.length === 0) {
        banner.style.display = 'none';
        banner.innerHTML = '';
        return;
    }
    // 多則公告依重要度排序
    const order = { critical: 0, warning: 1, info: 2 };
    active.sort((a, b) => (order[a.importance] ?? 9) - (order[b.importance] ?? 9));
    banner.innerHTML = active.map(a => {
        const icon = a.importance === 'critical' ? '🚨'
            : a.importance === 'warning' ? '⚠'
            : 'ℹ';
        const lock = a.lockBookings ? '<span class="banner-lock">🔒 此期間禁止新增預約</span>' : '';
        return `
            <div class="banner-item banner-${a.importance}">
                <span class="banner-icon">${icon}</span>
                <div class="banner-content">
                    <div class="banner-msg">${escapeHtml(a.message)}</div>
                    <div class="banner-meta">${a.startDate} ~ ${a.endDate} ${lock}</div>
                </div>
            </div>
        `;
    }).join('');
    banner.style.display = 'flex';
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================================================
// v2.41.0 (M.2): 批次取消功能
// ==========================================================================

let isBatchSelectMode = false;
const batchSelectedIds = new Set();

// v2.41.8: 批次模式權限工具函式
function isBatchAdmin() {
    return !!firebase.auth().currentUser;
}

/**
 * 判斷使用者是否能批次取消某筆預約
 * - 管理員: 任何預約皆可
 * - 一般使用者: 僅自己 deviceId 建立的預約
 */
function canBatchCancelBooking(booking) {
    if (!booking) return false;
    if (isBatchAdmin()) return true;
    return booking.deviceId === getDeviceId();
}

function toggleBatchSelectMode() {
    isBatchSelectMode = !isBatchSelectMode;
    batchSelectedIds.clear();
    const toolbar = document.getElementById('historyBatchToolbar');
    const toggleBtn = document.getElementById('btnBatchSelectToggle');
    if (toolbar) toolbar.style.display = isBatchSelectMode ? 'flex' : 'none';
    if (toggleBtn) {
        toggleBtn.textContent = isBatchSelectMode ? '✕ 結束批次' : '✓ 批次選取';
        toggleBtn.classList.toggle('active', isBatchSelectMode);
    }
    document.querySelectorAll('.history-list .history-item').forEach(updateItemCheckbox);
    updateBatchSelectionUI();

    // v2.41.8: 進入批次模式時, 非管理員顯示權限提示
    if (isBatchSelectMode && !isBatchAdmin()) {
        const items = Array.from(document.querySelectorAll('.history-list .history-item'));
        const total = items.length;
        const ownCount = items.filter(el => {
            const b = window.historyBookings?.[el.dataset.bookingId];
            return b && b.deviceId === getDeviceId();
        }).length;
        if (total > 0 && ownCount < total) {
            showToast(
                `批次模式: 您僅能選取本機預約 (${ownCount}/${total} 筆可選)。如需取消他人預約請先登入管理員。`,
                'info',
                { duration: 6000 }
            );
        }
    }
}

function updateItemCheckbox(itemEl) {
    const id = itemEl.dataset.bookingId;
    let checkbox = itemEl.querySelector('.history-batch-checkbox');

    if (isBatchSelectMode) {
        // v2.41.8: 權限檢查 - 非管理員只能選自己 deviceId 的預約
        const booking = window.historyBookings?.[id];
        const canSelect = canBatchCancelBooking(booking);

        if (!checkbox) {
            checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'history-batch-checkbox';
            checkbox.addEventListener('click', (e) => e.stopPropagation());
            checkbox.addEventListener('change', () => {
                // v2.41.8: 權限再次驗證 (防止 DOM 操作繞過)
                if (!canBatchCancelBooking(window.historyBookings?.[id])) {
                    checkbox.checked = false;
                    showToast('此預約非本機建立，僅管理員可批次取消', 'warning');
                    return;
                }
                if (checkbox.checked) batchSelectedIds.add(id);
                else batchSelectedIds.delete(id);
                updateBatchSelectionUI();
            });
            itemEl.prepend(checkbox);
        }

        // v2.41.8: 套用權限 → 無權限者 disabled + 視覺指示
        checkbox.disabled = !canSelect;
        if (!canSelect) {
            checkbox.checked = false;
            checkbox.title = '此預約非本機建立，僅管理員可批次取消';
            batchSelectedIds.delete(id); // 確保未授權的不在 selected set 中
        } else {
            checkbox.checked = batchSelectedIds.has(id);
            checkbox.title = '勾選以加入批次取消清單';
        }

        itemEl.classList.add('batch-mode');
        itemEl.classList.toggle('batch-not-allowed', !canSelect);
    } else {
        if (checkbox) checkbox.remove();
        itemEl.classList.remove('batch-mode', 'batch-selected', 'batch-not-allowed');
    }
}

function updateBatchSelectionUI() {
    const count = batchSelectedIds.size;
    document.getElementById('batchSelectedCount').textContent = String(count);
    document.getElementById('btnBatchCancel').disabled = count === 0;

    // v2.41.8: 工具列加入權限提示 chip (僅非管理員顯示)
    const toolbar = document.getElementById('historyBatchToolbar');
    let permHint = toolbar?.querySelector('.batch-perm-hint');
    if (toolbar && isBatchSelectMode && !isBatchAdmin()) {
        if (!permHint) {
            permHint = document.createElement('span');
            permHint.className = 'batch-perm-hint';
            permHint.textContent = '🔒 僅可選取本機預約';
            const countEl = toolbar.querySelector('.batch-count');
            if (countEl) countEl.after(permHint);
        }
    } else if (permHint) {
        permHint.remove();
    }

    // 高亮已選 row
    document.querySelectorAll('.history-list .history-item').forEach(el => {
        const id = el.dataset.bookingId;
        el.classList.toggle('batch-selected', isBatchSelectMode && batchSelectedIds.has(id));
    });
}

function batchSelectAll() {
    let skippedCount = 0;
    document.querySelectorAll('.history-list .history-item').forEach(el => {
        const id = el.dataset.bookingId;
        if (!id) return;
        // v2.41.8: 全選時跳過無權限的預約
        const booking = window.historyBookings?.[id];
        if (!canBatchCancelBooking(booking)) {
            skippedCount += 1;
            return;
        }
        batchSelectedIds.add(id);
        const cb = el.querySelector('.history-batch-checkbox');
        if (cb && !cb.disabled) cb.checked = true;
    });
    updateBatchSelectionUI();
    if (skippedCount > 0) {
        showToast(`已全選 ${batchSelectedIds.size} 筆本機預約 (跳過 ${skippedCount} 筆他人預約)`, 'info');
    }
}

function batchDeselectAll() {
    batchSelectedIds.clear();
    document.querySelectorAll('.history-batch-checkbox').forEach(cb => cb.checked = false);
    updateBatchSelectionUI();
}

async function executeBatchCancel() {
    // v2.41.8: 執行前再次過濾權限 (防止有人 console 操作繞過 UI)
    const allIds = Array.from(batchSelectedIds);
    const ids = allIds.filter(id => canBatchCancelBooking(window.historyBookings?.[id]));
    const filteredOut = allIds.length - ids.length;

    if (ids.length === 0) {
        if (filteredOut > 0) {
            showToast(`所選 ${filteredOut} 筆皆非本機預約，無權限取消`, 'warning');
            // 清掉選取狀態
            batchSelectedIds.clear();
            document.querySelectorAll('.history-list .history-item').forEach(updateItemCheckbox);
            updateBatchSelectionUI();
        }
        return;
    }

    // 若有部分被過濾,提示使用者
    let confirmExtra = '';
    if (filteredOut > 0) {
        confirmExtra = `\n(已自動排除 ${filteredOut} 筆無權限的預約)`;
    }

    // 二次確認 - 必須輸入確認字樣
    const expected = `確認取消 ${ids.length} 筆`;
    const input = prompt(
        `⚠ 即將批次取消 ${ids.length} 筆預約，此動作無法復原。${confirmExtra}\n\n` +
        `請輸入「${expected}」以確認執行：`
    );
    if (input !== expected) {
        showToast('輸入不符，已取消批次操作', 'info');
        return;
    }

    const cancelBtn = document.getElementById('btnBatchCancel');
    cancelBtn.disabled = true;
    cancelBtn.textContent = '處理中...';

    try {
        const isAdmin = !!firebase.auth().currentUser;
        const localDeviceId = getDeviceId();
        // Firestore batch write 上限 500 筆，分批處理
        const CHUNK = 400;
        let successCount = 0;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const batch = db.batch();
            for (const id of chunk) {
                const booking = window.historyBookings?.[id];
                if (!booking) continue;
                // 一般使用者僅能取消自己裝置的預約
                if (!isAdmin && booking.deviceId !== localDeviceId) continue;
                if (isAdmin) {
                    batch.delete(bookingsCollection.doc(id));
                } else {
                    batch.update(bookingsCollection.doc(id), { periods: [], deviceId: localDeviceId });
                }
                successCount += 1;
            }
            await batch.commit();
        }

        await loadBookingsFromFirebase();
        await loadHistoryData();
        toggleBatchSelectMode(); // 結束批次模式
        showToast(`✅ 已批次取消 ${successCount} 筆預約`, 'success');

        // v2.43.0 (1.8): 稽核日誌 - 批次取消
        logSystemAction('BATCH_CANCEL_BOOKINGS', {
            attemptedCount: ids.length,
            successCount,
            filteredOut,
            ids,
            executedBy: isAdmin ? 'admin' : 'user',
        }, ids.join(','));
    } catch (err) {
        console.error('[Batch Cancel] 失敗', err);
        showToast('批次取消失敗，請稍後再試', 'error');
    } finally {
        cancelBtn.disabled = false;
        cancelBtn.textContent = '🗑 批次取消';
    }
}

// ==========================================================================
// v2.41.0 初始化掛載 (在 DOMContentLoaded 後另外綁定)
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // M.1 綁定按鈕
    const btnOpen = document.getElementById('btnOpenAnnouncements');
    const btnClose = document.getElementById('btnAnnouncementClose');
    const overlay = document.getElementById('announcementModalOverlay');
    const form = document.getElementById('announcementForm');
    const btnFormReset = document.getElementById('btnAnnFormReset');

    btnOpen?.addEventListener('click', openAnnouncementManager);
    btnClose?.addEventListener('click', closeAnnouncementManager);
    overlay?.addEventListener('click', (e) => {
        if (e.target === overlay) closeAnnouncementManager();
    });
    form?.addEventListener('submit', submitAnnouncementForm);
    btnFormReset?.addEventListener('click', resetAnnouncementForm);

    // M.2 綁定按鈕
    document.getElementById('btnBatchSelectToggle')?.addEventListener('click', toggleBatchSelectMode);
    document.getElementById('btnBatchSelectAll')?.addEventListener('click', batchSelectAll);
    document.getElementById('btnBatchDeselect')?.addEventListener('click', batchDeselectAll);
    document.getElementById('btnBatchCancel')?.addEventListener('click', executeBatchCancel);

    // 啟動時載入公告 (供 banner 使用)
    loadAllAnnouncements().then(() => {
        console.log(`✅ Loaded ${cachedAnnouncements.length} announcements`);
    });
});

// ==========================================================================
// v2.44.0 (1.1): LINE 綁定模組
// ==========================================================================

const LINE_FUNCTIONS_BASE = 'https://asia-east1-schedule-10ed3.cloudfunctions.net';
let lineBindPollTimer = null;
let lineBindCountdownTimer = null;

/**
 * 開啟 LINE 綁定彈窗 — 自動依綁定狀態顯示對應 step
 */
async function openLineBindModal() {
    const overlay = document.getElementById('lineBindOverlay');
    if (!overlay) return;

    // 重置所有 step
    ['lineBindStep0', 'lineBindStep1', 'lineBindStep2', 'lineBindStep3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    overlay.classList.add('active');

    // 檢查是否已綁定
    try {
        const deviceId = getDeviceId();
        const doc = await db.collection('lineBindings').doc(deviceId).get();
        if (doc.exists) {
            // 已綁定 → 顯示 Step 0
            const data = doc.data();
            document.getElementById('lineBindBoundName').textContent =
                data.lineDisplayName || '(未取得名稱)';
            document.getElementById('lineBindStep0').style.display = 'block';

            // v2.46.0 (Phase 3): 若是登入管理員,顯示「訂閱告警」區
            const isAdmin = !!firebase.auth().currentUser;
            const adminSection = document.getElementById('adminAlertsSection');
            if (adminSection) {
                adminSection.style.display = isAdmin ? 'block' : 'none';
                if (isAdmin) {
                    refreshAdminAlertStatus(deviceId);
                }
            }
            return;
        }
    } catch (err) {
        console.warn('[LINE Bind] 檢查綁定狀態失敗', err);
    }

    // 未綁定 → 顯示 Step 1 (開始綁定表單)
    document.getElementById('lineBindStep1').style.display = 'block';
}

// ===== v2.46.0 (Phase 3): 管理員告警訂閱邏輯 =====

async function refreshAdminAlertStatus(deviceId) {
    const subBtn = document.getElementById('btnSubscribeAdminAlerts');
    const unsubBtn = document.getElementById('btnUnsubscribeAdminAlerts');
    const statusEl = document.getElementById('adminAlertsStatus');
    if (!subBtn || !unsubBtn || !statusEl) return;

    statusEl.textContent = '查詢中…';

    try {
        const res = await fetch(`${LINE_FUNCTIONS_BASE}/checkAdminAlertStatus?deviceId=${encodeURIComponent(deviceId)}`);
        const data = await res.json();

        if (data.subscribed) {
            subBtn.style.display = 'none';
            unsubBtn.style.display = 'block';
            statusEl.textContent = '✅ 已訂閱中,系統異常會即時推 LINE';
            statusEl.style.color = '#15803d';
        } else {
            subBtn.style.display = 'block';
            unsubBtn.style.display = 'none';
            statusEl.textContent = '⚠ 尚未訂閱告警';
            statusEl.style.color = '#92400e';
        }
    } catch (err) {
        console.warn('[adminAlerts] 查詢失敗', err);
        statusEl.textContent = '查詢失敗';
        statusEl.style.color = '#dc2626';
    }
}

async function toggleAdminAlerts(action) {
    const subBtn = document.getElementById('btnSubscribeAdminAlerts');
    const unsubBtn = document.getElementById('btnUnsubscribeAdminAlerts');
    const statusEl = document.getElementById('adminAlertsStatus');
    const deviceId = getDeviceId();

    [subBtn, unsubBtn].forEach(b => { if (b) b.disabled = true; });

    try {
        const res = await fetch(`${LINE_FUNCTIONS_BASE}/subscribeAdminAlerts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, action }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '操作失敗');

        showToast(
            action === 'unsubscribe'
                ? '🔕 已取消訂閱告警'
                : '🔔 已訂閱系統告警!請查看 LINE 確認訊息',
            'success'
        );
        await refreshAdminAlertStatus(deviceId);
    } catch (err) {
        console.error('[adminAlerts] toggle 失敗', err);
        showToast('操作失敗:' + err.message, 'error');
        if (statusEl) {
            statusEl.textContent = '操作失敗';
            statusEl.style.color = '#dc2626';
        }
    } finally {
        [subBtn, unsubBtn].forEach(b => { if (b) b.disabled = false; });
    }
}

function closeLineBindModal() {
    document.getElementById('lineBindOverlay')?.classList.remove('active');
    if (lineBindPollTimer) { clearInterval(lineBindPollTimer); lineBindPollTimer = null; }
    if (lineBindCountdownTimer) { clearInterval(lineBindCountdownTimer); lineBindCountdownTimer = null; }
}

/**
 * 點「開始綁定」→ 呼叫 createBindingCode → 顯示 Step 2 + QR
 */
async function startLineBinding() {
    const btn = document.getElementById('btnLineBindStart');
    const nameInput = document.getElementById('lineBindName');
    const displayName = nameInput?.value.trim() || '';

    btn.disabled = true;
    btn.textContent = '產生中...';

    try {
        const deviceId = getDeviceId();
        const res = await fetch(`${LINE_FUNCTIONS_BASE}/createBindingCode`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, displayName }),
        });

        if (!res.ok) {
            throw new Error(`API ${res.status}`);
        }

        const data = await res.json();

        // 顯示 Step 2
        document.getElementById('lineBindStep1').style.display = 'none';
        document.getElementById('lineBindStep2').style.display = 'block';
        document.getElementById('lineBindCode').textContent = data.code;

        // 啟動倒數 (5 分鐘)
        startBindCountdown(data.expiresInSeconds || 300);

        // 啟動輪詢綁定狀態 (每 3 秒)
        startBindPolling(data.code);

    } catch (err) {
        console.error('[LINE Bind] 產生綁定碼失敗', err);
        showToast('產生綁定碼失敗，請稍後再試', 'error');
        btn.disabled = false;
        btn.textContent = '🔗 開始綁定';
    }
}

function startBindCountdown(seconds) {
    if (lineBindCountdownTimer) clearInterval(lineBindCountdownTimer);
    let remain = seconds;
    const update = () => {
        const m = Math.floor(remain / 60);
        const s = remain % 60;
        const el = document.getElementById('lineBindCountdown');
        if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
        if (remain <= 0) {
            clearInterval(lineBindCountdownTimer);
            const statusBar = document.getElementById('lineBindStatusBar');
            if (statusBar) statusBar.innerHTML = '⏰ 綁定碼已過期，請重新產生';
            stopBindPolling();
        }
        remain -= 1;
    };
    update();
    lineBindCountdownTimer = setInterval(update, 1000);
}

function startBindPolling(code) {
    if (lineBindPollTimer) clearInterval(lineBindPollTimer);
    lineBindPollTimer = setInterval(async () => {
        try {
            const res = await fetch(`${LINE_FUNCTIONS_BASE}/checkBindingStatus?code=${code}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.status === 'bound') {
                // 綁定成功!
                stopBindPolling();
                onBindingSuccess();
            }
        } catch (err) {
            console.warn('[LINE Bind] Poll 失敗', err);
        }
    }, 3000);
}

function stopBindPolling() {
    if (lineBindPollTimer) { clearInterval(lineBindPollTimer); lineBindPollTimer = null; }
    if (lineBindCountdownTimer) { clearInterval(lineBindCountdownTimer); lineBindCountdownTimer = null; }
}

async function onBindingSuccess() {
    // 從 Firestore 讀取綁定資訊顯示
    try {
        const deviceId = getDeviceId();
        const doc = await db.collection('lineBindings').doc(deviceId).get();
        const lineName = doc.exists ? (doc.data().lineDisplayName || '') : '';
        document.getElementById('lineBindNewName').textContent = lineName || '(未取得)';
    } catch (e) { /* silent */ }

    document.getElementById('lineBindStep2').style.display = 'none';
    document.getElementById('lineBindStep3').style.display = 'block';
    showToast('🎉 LINE 綁定成功！', 'success');
}

// ===== 事件綁定 =====
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnLineBind')?.addEventListener('click', openLineBindModal);
    document.getElementById('btnLineBindClose')?.addEventListener('click', closeLineBindModal);
    document.getElementById('btnLineBindStart')?.addEventListener('click', startLineBinding);
    document.getElementById('btnLineBindCancel')?.addEventListener('click', closeLineBindModal);
    document.getElementById('btnLineBindDone')?.addEventListener('click', closeLineBindModal);
    document.getElementById('lineBindOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'lineBindOverlay') closeLineBindModal();
    });

    // v2.46.0 (Phase 3): 管理員告警訂閱
    document.getElementById('btnSubscribeAdminAlerts')?.addEventListener('click',
        () => toggleAdminAlerts('subscribe'));
    document.getElementById('btnUnsubscribeAdminAlerts')?.addEventListener('click',
        () => toggleAdminAlerts('unsubscribe'));

    // v2.47.0: 意見回饋系統
    initFeedbackSystem();
});

// ==========================================================================
// v2.47.0: 意見回饋系統
// ==========================================================================

function initFeedbackSystem() {
    const fab = document.getElementById('btnFeedbackFab');
    const overlay = document.getElementById('feedbackOverlay');
    const closeBtn = document.getElementById('btnFeedbackClose');
    const cancelBtn = document.getElementById('btnFeedbackCancel');
    const form = document.getElementById('feedbackForm');
    const messageInput = document.getElementById('feedbackMessage');
    const charCount = document.getElementById('feedbackCharCount');

    if (!fab || !overlay) return;

    fab.addEventListener('click', openFeedbackModal);
    closeBtn?.addEventListener('click', closeFeedbackModal);
    cancelBtn?.addEventListener('click', closeFeedbackModal);
    overlay.addEventListener('click', (e) => {
        if (e.target.id === 'feedbackOverlay') closeFeedbackModal();
    });

    // 字數即時統計
    messageInput?.addEventListener('input', () => {
        if (charCount) charCount.textContent = String(messageInput.value.length);
    });

    form?.addEventListener('submit', submitFeedback);
}

function openFeedbackModal() {
    const overlay = document.getElementById('feedbackOverlay');
    overlay.classList.add('active');
    // 預填姓名 (若以前 LINE 綁定有存)
    const nameInput = document.getElementById('feedbackName');
    if (nameInput && !nameInput.value) {
        const lastName = localStorage.getItem('lastBookerName') || '';
        if (lastName) nameInput.value = lastName;
    }
    document.getElementById('feedbackMessage')?.focus();
}

function closeFeedbackModal() {
    document.getElementById('feedbackOverlay')?.classList.remove('active');
}

async function submitFeedback(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('btnFeedbackSubmit');
    const message = document.getElementById('feedbackMessage').value.trim();
    const name = document.getElementById('feedbackName').value.trim();
    const type = document.querySelector('input[name="feedbackType"]:checked')?.value || 'other';

    if (!message) {
        showToast('請填寫回饋內容', 'warning');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '送出中…';

    try {
        const res = await fetch(`${LINE_FUNCTIONS_BASE}/submitFeedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                name,
                message,
                deviceId: getDeviceId(),
            }),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || '送出失敗');
        }

        // 成功 — 顯示 toast + 清表單 + 關閉
        if (data.pushedToAdmins > 0) {
            showToast(`📤 已送出!管理員會盡快回覆`, 'success');
        } else {
            showToast(`📤 已收到回饋(管理員尚未訂閱告警,將透過後台處理)`, 'info', { duration: 5000 });
        }

        // 記住姓名給下次用
        if (name) localStorage.setItem('lastBookerName', name);

        // 清空表單
        document.getElementById('feedbackMessage').value = '';
        const charCount = document.getElementById('feedbackCharCount');
        if (charCount) charCount.textContent = '0';

        closeFeedbackModal();

    } catch (err) {
        console.error('[Feedback] 送出失敗', err);
        showToast(err.message || '送出失敗', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '📤 送出回饋';
    }
}
