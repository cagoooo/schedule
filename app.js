/**
 * 禮堂預約系統 - 核心應用邏輯
 * 使用 Firebase Firestore 進行資料存取
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
let bookings = [];
let selectedDate = null;
let isLoading = false;
let displayMode = 'week'; // 'week' 或 'range'
let rangeStartDate = null;
let rangeEndDate = null;

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

// ===== Firebase 資料存取 =====

/**
 * 從 Firestore 載入預約資料
 */
async function loadBookingsFromFirebase() {
    if (isLoading) return;
    isLoading = true;

    try {
        let queryStart, queryEnd;

        if (displayMode === 'range' && rangeStartDate && rangeEndDate) {
            // 區間模式：使用選擇的日期範圍
            queryStart = formatDate(rangeStartDate);
            queryEnd = formatDate(rangeEndDate);
        } else {
            // 週模式：使用當週日期
            queryStart = formatDate(currentWeekStart);
            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(currentWeekStart.getDate() + 6);
            queryEnd = formatDate(weekEnd);
        }

        // 查詢日期範圍內的預約
        const snapshot = await bookingsCollection
            .where('date', '>=', queryStart)
            .where('date', '<=', queryEnd)
            .get();

        bookings = [];
        snapshot.forEach(doc => {
            bookings.push({ id: doc.id, ...doc.data() });
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
    const booking = bookings.find(b => b.date === dateStr && b.periods.includes(periodId));
    return booking ? booking.booker : null;
}

/**
 * 取得指定日期時段的預約資訊
 */
function getBookingForPeriod(date, periodId) {
    const dateStr = formatDate(date);
    return bookings.find(b => b.date === dateStr && b.periods.includes(periodId));
}

// ===== UI 渲染 =====

/**
 * 渲染日曆（支援單週或多週模式）
 */
function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let startDate, endDate, totalDays;

    if (displayMode === 'range' && rangeStartDate && rangeEndDate) {
        // 區間模式：顯示選擇的日期範圍
        startDate = new Date(rangeStartDate);
        endDate = new Date(rangeEndDate);
        totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

        // 更新標籤顯示
        document.getElementById('currentWeekLabel').textContent =
            `${formatDate(startDate)} ~ ${formatDate(endDate)} (${totalDays} 天)`;

        // 更新 grid 樣式以適應不同週數
        const weeks = Math.ceil(totalDays / 7);
        grid.style.gridTemplateColumns = `repeat(7, minmax(120px, 1fr))`;
    } else {
        // 週模式：顯示一週
        startDate = new Date(currentWeekStart);
        endDate = new Date(currentWeekStart);
        endDate.setDate(endDate.getDate() + 6);
        totalDays = 7;

        // 更新週標籤
        document.getElementById('currentWeekLabel').textContent =
            `${formatDate(startDate)} ~ ${formatDate(endDate)}`;

        grid.style.gridTemplateColumns = `repeat(7, minmax(140px, 1fr))`;
    }

    // 生成日期欄位
    for (let i = 0; i < totalDays; i++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + i);

        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = isSameDay(date, today);

        const dayEl = document.createElement('div');
        dayEl.className = `calendar-day${isWeekend ? ' weekend' : ''}${isToday ? ' today' : ''}`;

        // 日期標題
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

        // 預約清單
        const bookingsEl = document.createElement('div');
        bookingsEl.className = 'day-bookings';

        const dayBookings = getBookingsByDate(date);

        // 按時段順序顯示預約
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
        grid.appendChild(dayEl);
    }

    // 綁定預約按鈕事件
    document.querySelectorAll('.btn-book').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookingModal(btn.dataset.date);
        });
    });
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

    // 更新彈窗內容
    document.getElementById('modalDate').textContent = dateStr;
    document.getElementById('bookerName').value = '';
    document.getElementById('bookingReason').value = '';
    document.getElementById('repeatBooking').checked = false;
    document.getElementById('repeatEndDate').value = '';
    document.getElementById('repeatEndDate').disabled = true;

    // 更新重複預約頻率顯示
    const date = parseDate(dateStr);
    document.getElementById('repeatFrequency').textContent = `每週${getWeekdayName(date)}`;

    // 渲染節次選項
    renderPeriodCheckboxes(dateStr);

    // 顯示彈窗
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
    const booker = document.getElementById('bookerName').value.trim();
    const reason = document.getElementById('bookingReason').value.trim();
    const repeatChecked = document.getElementById('repeatBooking').checked;
    const repeatEndDate = document.getElementById('repeatEndDate').value;

    // 取得選中的節次
    const selectedPeriods = [];
    document.querySelectorAll('#periodCheckboxes input:checked').forEach(input => {
        selectedPeriods.push(input.value);
    });

    // 驗證
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

    // 準備預約日期清單
    const datesToBook = [selectedDate];

    if (repeatChecked && repeatEndDate) {
        const startDate = parseDate(selectedDate);
        const endDate = new Date(repeatEndDate);

        let currentDate = new Date(startDate);
        currentDate.setDate(currentDate.getDate() + 7); // 從下一週開始

        while (currentDate <= endDate) {
            datesToBook.push(formatDate(currentDate));
            currentDate.setDate(currentDate.getDate() + 7);
        }
    }

    // 顯示載入狀態
    const submitBtn = document.getElementById('btnModalSubmit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>處理中...</span>';

    try {
        // 先檢查所有日期是否有衝突（從 Firestore 即時查詢）
        for (const dateStr of datesToBook) {
            const snapshot = await bookingsCollection
                .where('date', '==', dateStr)
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

        // 批次新增預約
        const batch = db.batch();
        for (const dateStr of datesToBook) {
            const docRef = bookingsCollection.doc();
            batch.set(docRef, {
                date: dateStr,
                periods: selectedPeriods,
                booker: booker,
                reason: reason,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
        await batch.commit();

        // 重新載入並更新 UI
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
 * 顯示預約詳情（可用於檢視/取消）
 */
let pendingDeleteBooking = null;
let pendingDeletePeriod = null;

async function showBookingDetail(booking, period) {
    // 儲存待刪除的預約資訊
    pendingDeleteBooking = booking;
    pendingDeletePeriod = period;

    // 顯示預約資訊
    document.getElementById('passwordBookingInfo').innerHTML = `
        <strong>日期：</strong>${booking.date}<br>
        <strong>節次：</strong>${period.name}<br>
        <strong>預約者：</strong>${booking.booker}<br>
        <strong>理由：</strong>${booking.reason || '無'}
    `;

    // 清空密碼輸入與錯誤訊息
    document.getElementById('adminPassword').value = '';
    document.getElementById('passwordError').textContent = '';

    // 顯示密碼驗證彈窗
    document.getElementById('passwordModalOverlay').classList.add('active');
    document.getElementById('adminPassword').focus();
}

/**
 * 執行刪除預約（密碼驗證成功後）
 */
async function executeDeleteBooking() {
    if (!pendingDeleteBooking || !pendingDeletePeriod) return;

    try {
        // 移除該節次
        const newPeriods = pendingDeleteBooking.periods.filter(p => p !== pendingDeletePeriod.id);

        if (newPeriods.length === 0) {
            // 如果沒有剩餘節次，刪除整筆預約
            await deleteBookingFromFirebase(pendingDeleteBooking.id);
        } else {
            // 更新預約
            await updateBookingInFirebase(pendingDeleteBooking.id, { periods: newPeriods });
        }

        await loadBookingsFromFirebase();
        closePasswordModal();
        showToast('已取消預約', 'success');
    } catch (error) {
        console.error('取消預約失敗:', error);
        showToast('取消失敗，請稍後再試', 'error');
    }
}

/**
 * 關閉密碼驗證彈窗
 */
function closePasswordModal() {
    document.getElementById('passwordModalOverlay').classList.remove('active');
    pendingDeleteBooking = null;
    pendingDeletePeriod = null;
}

// ===== Toast 通知 =====

/**
 * 顯示 Toast 通知
 */
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
    // 週導航（回到週模式）
    document.getElementById('btnPrevWeek').addEventListener('click', () => {
        displayMode = 'week';
        rangeStartDate = null;
        rangeEndDate = null;
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        loadBookingsFromFirebase();
    });

    document.getElementById('btnNextWeek').addEventListener('click', () => {
        displayMode = 'week';
        rangeStartDate = null;
        rangeEndDate = null;
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        loadBookingsFromFirebase();
    });

    // 查詢按鈕（區間模式）
    document.getElementById('btnSearch').addEventListener('click', () => {
        const startDateValue = document.getElementById('startDate').value;
        const endDateValue = document.getElementById('endDate').value;

        if (startDateValue && endDateValue) {
            const start = new Date(startDateValue);
            const end = new Date(endDateValue);

            // 檢查日期順序
            if (start > end) {
                showToast('開始日期不能晚於結束日期', 'warning');
                return;
            }

            // 計算天數
            const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

            if (days > 31) {
                showToast('查詢範圍不能超過 31 天', 'warning');
                return;
            }

            if (days <= 7) {
                // 7 天以內使用週模式
                displayMode = 'week';
                rangeStartDate = null;
                rangeEndDate = null;
                currentWeekStart = getMonday(start);
            } else {
                // 超過 7 天使用區間模式
                displayMode = 'range';
                rangeStartDate = start;
                rangeEndDate = end;
            }

            loadBookingsFromFirebase();
        } else if (startDateValue) {
            // 只有開始日期，使用週模式
            displayMode = 'week';
            rangeStartDate = null;
            rangeEndDate = null;
            currentWeekStart = getMonday(new Date(startDateValue));
            loadBookingsFromFirebase();
        }
    });

    // 返回按鈕
    document.getElementById('btnBack').addEventListener('click', () => {
        history.back();
    });

    // 彈窗操作
    document.getElementById('btnModalCancel').addEventListener('click', closeBookingModal);
    document.getElementById('btnModalSubmit').addEventListener('click', submitBooking);

    // 點擊遮罩關閉彈窗
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'modalOverlay') {
            closeBookingModal();
        }
    });

    // 重複預約勾選
    document.getElementById('repeatBooking').addEventListener('change', (e) => {
        document.getElementById('repeatEndDate').disabled = !e.target.checked;
    });

    // ===== 密碼驗證彈窗事件 =====
    const ADMIN_PASSWORD = 'smes1234';

    document.getElementById('btnPasswordCancel').addEventListener('click', closePasswordModal);

    document.getElementById('btnPasswordConfirm').addEventListener('click', () => {
        const password = document.getElementById('adminPassword').value;
        if (password === ADMIN_PASSWORD) {
            executeDeleteBooking();
        } else {
            document.getElementById('passwordError').textContent = '密碼錯誤，請重新輸入';
            document.getElementById('adminPassword').value = '';
            document.getElementById('adminPassword').focus();
        }
    });

    // 密碼輸入框 Enter 鍵確認
    document.getElementById('adminPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btnPasswordConfirm').click();
        }
    });

    // 點擊遮罩關閉密碼彈窗
    document.getElementById('passwordModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'passwordModalOverlay') {
            closePasswordModal();
        }
    });

    // ===== 匯出 CSV 按鈕事件 =====
    document.getElementById('btnExport').addEventListener('click', exportToCSV);

    // 初始化日期選擇器
    const today = new Date();

    document.getElementById('startDate').value = formatDateISO(currentWeekStart);

    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(currentWeekStart.getDate() + 6);
    document.getElementById('endDate').value = formatDateISO(weekEnd);

    // 移除日期限制，讓系統更通用
    document.getElementById('dateHint').textContent = '';
}

// ===== CSV 匯出功能 =====

/**
 * 匯出所有預約資料為 CSV
 */
async function exportToCSV() {
    try {
        showToast('正在匯出資料...', 'info');

        // 查詢所有預約資料
        const snapshot = await bookingsCollection.orderBy('date').get();

        if (snapshot.empty) {
            showToast('沒有預約資料可匯出', 'warning');
            return;
        }

        // 準備 CSV 資料
        const headers = ['日期', '節次', '預約者', '預約理由', '建立時間'];
        const rows = [headers.join(',')];

        snapshot.forEach(doc => {
            const booking = doc.data();
            const periodsStr = booking.periods
                .map(pId => PERIODS.find(p => p.id === pId)?.name || pId)
                .join('、');
            const createdAt = booking.createdAt
                ? new Date(booking.createdAt.toDate()).toLocaleString('zh-TW')
                : '未知';

            // 處理 CSV 中可能包含逗號的欄位
            const escapeCsv = (str) => {
                if (str && (str.includes(',') || str.includes('"') || str.includes('\n'))) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str || '';
            };

            rows.push([
                booking.date,
                escapeCsv(periodsStr),
                escapeCsv(booking.booker),
                escapeCsv(booking.reason),
                createdAt
            ].join(','));
        });

        // 產生 CSV 檔案並下載
        const csvContent = '\uFEFF' + rows.join('\n'); // 加入 BOM 讓 Excel 正確識別 UTF-8
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

// ===== 初始化 =====

document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadBookingsFromFirebase();
});

