/**
 * 禮堂預約系統 - 核心應用邏輯
 * 使用 Firebase Firestore + Auth 進行資料存取與驗證
 */

// ===== Firebase 設定 =====
const firebaseConfig = {
    apiKey: "AIzaSyAZsa34-uV2eWPjOykUU2_4dJDy-Sq7p2E",
    authDomain: "schedule-10ed3.firebaseapp.com",
    projectId: "schedule-10ed3",
    storageBucket: "schedule-10ed3.firebasestorage.app",
    messagingSenderId: "495024952462",
    appId: "1:495024952462:web:96058ecdd4c18fb78fe5df"
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const bookingsCollection = db.collection('bookings');

// ===== 常數設定 =====
const PERIODS = [
    { id: 'morning', name: '晨間/早會/導師時間' },
    { id: 'period1', name: '第一節' },
    { id: 'period2', name: '第二節' },
    { id: 'period3', name: '第三節' },
    { id: 'period4', name: '第四節' },
    { id: 'lunch', name: '午餐/午休時段' },
    { id: 'period5', name: '第五節' },
    { id: 'period6', name: '第六節' },
    { id: 'period7', name: '第七節' },
    { id: 'period8', name: '第八節' }
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
    maxBookingsPerHour: 5,      // 每小時最多預約次數
    maxBookingsPerDay: 10,      // 每天最多預約次數
    storageKey: 'bookingRateLimit'
};

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
    } else {
        btn.classList.remove('logged-in');
        text.textContent = '管理員';
        document.getElementById('btnOpenSettings').style.display = 'none';
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
        const snapshot = await bookingsCollection
            .where('date', '>=', queryStart)
            .where('date', '<=', queryEnd)
            .get();

        bookings = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // 相容性處理：若無 room 欄位，預設為「禮堂」；僅加入符合當前選擇場地的預約
            if ((data.room || '禮堂') === room) {
                bookings.push({ id: doc.id, ...data });
            }
        });

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
        const snapshot = await bookingsCollection
            .where('date', '>=', queryStart)
            .where('date', '<=', queryEnd)
            .get();

        monthBookings = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // 相容性處理：若無 room 欄位，預設為「禮堂」
            if ((data.room || '禮堂') === room) {
                monthBookings.push({ id: doc.id, ...data });
            }
        });

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
 * 取得指定日期的預約清單
 */
function getBookingsByDate(date) {
    const dateStr = formatDate(date);
    return bookings.filter(b => b.date === dateStr);
}

/**
 * 檢查指定日期時段是否已被預約
 */
function isPeriodBooked(date, periodId) {
    const dateStr = formatDate(date);
    return bookings.some(b => b.date === dateStr && b.periods.includes(periodId));
}

/**
 * 取得指定日期時段的預約者
 */
function getBookerForPeriod(date, periodId) {
    const dateStr = formatDate(date);
    const room = getSelectedRoom();
    const booking = bookings.find(b => b.date === dateStr && b.periods.includes(periodId) && b.room === room);
    return booking ? booking.booker : null;
}

/**
 * 取得指定日期時段的預約資訊
 */
function getBookingForPeriod(date, periodId) {
    const dateStr = formatDate(date);
    const room = getSelectedRoom();
    return bookings.find(b => b.date === dateStr && b.periods.includes(periodId) && b.room === room);
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
            const dayId = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
            const slotId = `${dayId}_${period.id}`;
            const isUnavailable = unavailableSlots.includes(slotId);

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
            } else if (isUnavailable) {
                const cardEl = document.createElement('div');
                cardEl.className = 'booking-card unavailable';
                cardEl.innerHTML = `
                    <span class="booking-period">${period.name}</span>
                    <span class="unavailable-badge">固定不開放</span>
                `;
                cardEl.title = `此時段已設定為固定不開放預約`;
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
                點擊預約此日
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

        // 點擊跳轉週視圖
        const clickDate = new Date(currentDate);
        dayEl.addEventListener('click', () => {
            viewMode = 'week';
            currentWeekStart = getMonday(clickDate);
            switchView('week');
        });

        grid.appendChild(dayEl);
        currentDate.setDate(currentDate.getDate() + 1);
    }
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

        const checkboxEl = document.createElement('div');
        checkboxEl.className = 'period-checkbox';
        checkboxEl.innerHTML = `
            <input type="checkbox" 
                   id="period_${period.id}" 
                   value="${period.id}"
                   ${isBooked ? 'disabled' : ''}>
            <label for="period_${period.id}"
                   title="${isBooked ? `已被 ${booker} 預約` : '可預約'}">
                ${period.name}
            </label>
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

    document.getElementById('modalDate').textContent = dateStr;
    document.getElementById('modalRoomSelect').value = getSelectedRoom(); // 同步當前選單場地
    document.getElementById('bookerName').value = '';
    document.getElementById('bookingReason').value = '';
    document.getElementById('repeatBooking').checked = false;
    document.getElementById('repeatEndDate').value = '';
    document.getElementById('repeatEndDate').disabled = true;

    const date = parseDate(dateStr);
    document.getElementById('repeatFrequency').textContent = `每週${getWeekdayName(date)}`;

    renderPeriodCheckboxes(dateStr);

    document.getElementById('modalOverlay').classList.add('active');
}

/**
 * 關閉預約彈窗
 */
function closeBookingModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    selectedDate = null;
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
        return;
    }

    if (selectedPeriods.length === 0) {
        showToast('請至少選擇一個節次', 'warning');
        return;
    }

    if (!reason) {
        showToast('請輸入預約理由', 'warning');
        return;
    }

    const room = document.getElementById('modalRoomSelect').value;
    const datesToBook = [selectedDate];

    // 檢查固定不開放時段
    for (const dateStr of [selectedDate]) {
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

    if (repeatChecked && repeatEndDate) {
        const startDate = parseDate(selectedDate);
        const endDate = new Date(repeatEndDate);

        let currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + 7);

        while (currentDate <= endDate) {
            datesToBook.push(formatDate(currentDate));
            currentDate.setDate(currentDate.getDate() + 7);
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
        for (const dateStr of datesToBook) {
            const docRef = bookingsCollection.doc();
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

        await loadBookingsFromFirebase();
        closeBookingModal();

        const msg = datesToBook.length > 1
            ? `已成功預約 ${datesToBook.length} 個日期`
            : '預約成功！';
        showToast(msg, 'success');

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

    // 顯示預約詳情給所有人看
    document.getElementById('deleteBookingInfo').innerHTML = `
        <strong>日期：</strong>${booking.date}<br>
        <strong>節次：</strong>${period.name}<br>
        <strong>預約者：</strong>${booking.booker}<br>
        <strong>理由：</strong>${booking.reason || '無'}
    `;

    // 根據登入狀態顯示不同的取消按鈕文字
    const deleteBtn = document.getElementById('btnDeleteConfirm');
    if (currentUser) {
        deleteBtn.textContent = '取消預約';
    } else {
        deleteBtn.textContent = '登入後取消';
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
    if (!pendingDeleteBooking || !pendingDeletePeriod) return;

    // 檢查是否已登入
    if (!currentUser) {
        closeDeleteModal();
        showToast('請先登入管理員帳號', 'warning');
        openAuthModal();
        return;
    }

    try {
        const newPeriods = pendingDeleteBooking.periods.filter(p => p !== pendingDeletePeriod.id);

        if (newPeriods.length === 0) {
            await deleteBookingFromFirebase(pendingDeleteBooking.id);
        } else {
            await updateBookingInFirebase(pendingDeleteBooking.id, { periods: newPeriods });
        }

        await loadBookingsFromFirebase();
        closeDeleteModal();
        showToast('已取消預約', 'success');
    } catch (error) {
        console.error('取消預約失敗:', error);
        showToast('取消失敗，請稍後再試', 'error');
    }
}

// ===== Toast 通知 =====

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
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
        } else if (startDateValue) {
            displayMode = 'week';
            rangeStartDate = null;
            rangeEndDate = null;
            currentWeekStart = getMonday(new Date(startDateValue));
            viewMode = 'week';
            switchView('week');
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
        doLogin();
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

    // 初始化日期選擇器
    document.getElementById('startDate').value = formatDateISO(currentWeekStart);
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);
    document.getElementById('endDate').value = formatDateISO(weekEnd);
    document.getElementById('dateHint').textContent = '';
}

// ===== CSV 匯出功能 =====

async function exportToCSV() {
    try {
        showToast('正在匯出資料...', 'info');

        const snapshot = await bookingsCollection.orderBy('date').get();

        if (snapshot.empty) {
            showToast('沒有預約資料可匯出', 'warning');
            return;
        }

        const headers = ['日期', '場地', '節次', '預約者', '預約理由', '建立時間'];
        const rows = [headers.join(',')];

        snapshot.forEach(doc => {
            const booking = doc.data();
            const periodsStr = booking.periods
                .map(pId => PERIODS.find(p => p.id === pId)?.name || pId)
                .join('、');
            const createdAt = booking.createdAt
                ? new Date(booking.createdAt.toDate()).toLocaleString('zh-TW')
                : '未知';

            const escapeCsv = (str) => {
                if (str && (str.includes(',') || str.includes('"') || str.includes('\n'))) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str || '';
            };

            rows.push([
                booking.date,
                escapeCsv(booking.room || '禮堂'),
                escapeCsv(periodsStr),
                escapeCsv(booking.booker),
                escapeCsv(booking.reason),
                createdAt
            ].join(','));
        });

        const csvContent = '\uFEFF' + rows.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `禮堂預約資料_${formatDate(new Date(), '')}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`已匯出 ${snapshot.size} 筆預約資料`, 'success');
    } catch (error) {
        console.error('匯出失敗:', error);
        showToast('匯出失敗，請稍後再試', 'error');
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

    // 建立圖例
    legend.innerHTML = sortedPeriods.slice(0, 5).map(p => `
        <div class="pie-legend-item">
            <span class="pie-legend-color" style="background:${p.color}"></span>
            <span>${p.name}</span>
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
                <span class="bar-label" title="${name}">${name}</span>
                <div class="bar-container">
                    <div class="bar-fill" style="width:${percent}%;background:${CHART_COLORS[i % CHART_COLORS.length]}">
                        <span class="bar-value">${count}</span>
                    </div>
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
        <div class="summary-item">
            <div class="summary-value">${totalBookings}</div>
            <div class="summary-label">總預約筆數</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${totalPeriods}</div>
            <div class="summary-label">總預約節次</div>
        </div>
        <div class="summary-item">
            <div class="summary-value">${uniqueBookers}</div>
            <div class="summary-label">不同預約者</div>
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

    // 自動設定搜尋範圍：今天起至未來 180 天
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + 180);

    const startDateStr = formatDate(today);
    const endDateStr = formatDate(futureDate);

    // 驗證至少有一個搜尋條件
    if (!searchInput && !periodFilter) {
        showToast('請輸入搜尋關鍵字或選擇節次', 'warning');
        return;
    }

    showToast('正在搜尋未來半年內的預約...', 'info');

    try {
        // 建立查詢 (直接查未來半年)
        let query = bookingsCollection
            .where('date', '>=', startDateStr)
            .where('date', '<=', endDateStr);

        const snapshot = await query.get();
        let results = [];

        snapshot.forEach(doc => {
            const booking = { id: doc.id, ...doc.data() };

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

        // 渲染搜尋結果
        renderSearchResults(results, searchInput);
        openSearchModal();

    } catch (error) {
        console.error('搜尋失敗:', error);
        showToast('搜尋失敗，請稍後再試', 'error');
    }
}

/**
 * 渲染搜尋結果
 */
function renderSearchResults(results, searchTerm) {
    const summaryEl = document.getElementById('searchResultSummary');
    const listEl = document.getElementById('searchResultList');

    // 渲染摘要
    summaryEl.innerHTML = `
        <span>找到 <span class="count">${results.length}</span> 筆預約記錄</span>
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
        const periodNames = booking.periods
            .map(pId => PERIODS.find(p => p.id === pId)?.name || pId)
            .join('、');

        // 高亮搜尋詞
        let bookerDisplay = booking.booker;
        if (searchTerm) {
            const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
            bookerDisplay = booking.booker.replace(regex, '<span class="search-highlight">$1</span>');
        }

        return `
            <div class="search-result-item" data-booking-id="${booking.id}" data-date="${booking.date}">
                <span class="search-result-date">${booking.date}</span>
                <span class="search-result-period">${periodNames}</span>
                <span class="search-result-booker">${bookerDisplay}</span>
                <span class="search-result-reason" title="${booking.reason || ''}">${booking.reason || '-'}</span>
            </div>
        `;
    }).join('');

    // 綁定點擊事件 - 跳轉到該週
    listEl.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
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
        snapshot.forEach(doc => {
            const booking = doc.data();
            const periodNames = booking.periods
                .map(pId => PERIODS.find(p => p.id === pId)?.name || pId)
                .join('、');

            historyList.innerHTML += `
                <div class="history-item">
                    <span class="history-date">${booking.date}</span>
                    <span class="history-period">${periodNames}</span>
                    <span class="history-booker">${booking.booker || '未知'}</span>
                    <span class="history-reason" title="${booking.reason || ''}">${booking.reason || '-'}</span>
                </div>
            `;
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

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // 取得該月第一天和最後一天
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // 星期標題
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    let html = weekdays.map(d => `<div class="batch-calendar-day" style="background:#f0f0f0;cursor:default;">${d}</div>`).join('');

    // 填充空白
    for (let i = 0; i < firstDay.getDay(); i++) {
        html += '<div class="batch-calendar-day disabled"></div>';
    }

    // 日期
    for (let day = 1; day <= lastDay.getDate(); day++) {
        const dateStr = `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        const isSelected = batchSelectedDates.includes(dateStr);
        const isPast = new Date(year, month, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate());

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
    loadBookingsFromFirebase();
});
