#!/usr/bin/env python3
"""
新增歷史記錄與批次預約功能到禮堂&專科教室&IPAD平板車預約系統
"""

def update_html():
    """更新 index.html"""
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. 新增歷史記錄按鈕（在統計按鈕後）
    old_stats_btn = '''                    </svg>
                    統計
                </button>
            </div>'''
    
    new_stats_btn = '''                    </svg>
                    統計
                </button>
                <button class="btn-history" id="btnHistory">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    歷史
                </button>
            </div>'''
    
    if old_stats_btn in content:
        content = content.replace(old_stats_btn, new_stats_btn)
        print("✓ 已新增歷史記錄按鈕")
    else:
        print("✗ 找不到統計按鈕位置")
    
    # 2. 新增歷史記錄彈窗（在 Firebase SDK 前）
    history_modal = '''
    <!-- 歷史記錄彈窗 -->
    <div class="history-modal-overlay" id="historyModalOverlay">
        <div class="history-modal">
            <div class="history-modal-header">
                <h3>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                    預約歷史記錄
                </h3>
                <button class="btn-history-close" id="btnHistoryClose">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
            <div class="history-modal-body">
                <div class="history-filters">
                    <input type="month" id="historyMonth" class="history-month-input">
                    <button class="btn-history-load" id="btnHistoryLoad">載入</button>
                </div>
                <div class="history-list" id="historyList">
                    <!-- 由 JavaScript 動態生成 -->
                </div>
            </div>
        </div>
    </div>

    <!-- Firebase SDK -->'''
    
    if '<!-- Firebase SDK -->' in content and 'history-modal-overlay' not in content:
        content = content.replace('    <!-- Firebase SDK -->', history_modal)
        print("✓ 已新增歷史記錄彈窗")
    else:
        print("✗ 歷史記錄彈窗已存在或找不到位置")
    
    # 3. 新增批次預約選項（在預約理由前）
    batch_html = '''                <div class="form-group batch-booking-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="batchBooking">
                        批次預約（選擇多個日期）
                    </label>
                    <div class="batch-dates hidden" id="batchDatesContainer">
                        <p class="batch-hint">點擊下方日曆選擇多個日期：</p>
                        <div class="batch-calendar" id="batchCalendar"></div>
                        <div class="selected-dates" id="selectedDatesDisplay"></div>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label required">*預約理由：</label>'''
    
    old_reason = '''                <div class="form-group">
                    <label class="form-label required">*預約理由：</label>'''
    
    if old_reason in content and 'batch-booking-group' not in content:
        content = content.replace(old_reason, batch_html)
        print("✓ 已新增批次預約選項")
    else:
        print("✗ 批次預約選項已存在或找不到位置")
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("HTML 更新完成！")

def update_css():
    """更新 styles.css"""
    css_additions = '''

/* ===== 歷史記錄功能 ===== */

.btn-history {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
    color: white;
    border: none;
    padding: 0.6rem 1.25rem;
    border-radius: var(--radius-sm);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition-fast);
    box-shadow: var(--shadow-sm);
}

.btn-history:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
}

/* 歷史記錄彈窗 */
.history-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(26, 58, 74, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    opacity: 0;
    visibility: hidden;
    transition: var(--transition-normal);
}

.history-modal-overlay.active {
    opacity: 1;
    visibility: visible;
}

.history-modal {
    background: var(--card-bg);
    border-radius: var(--radius-lg);
    width: 90%;
    max-width: 900px;
    max-height: 85vh;
    overflow: hidden;
    box-shadow: var(--shadow-lg);
    animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.history-modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
    color: white;
}

.history-modal-header h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
}

.btn-history-close {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 50%;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: white;
    transition: var(--transition-fast);
}

.btn-history-close:hover {
    background: rgba(255, 255, 255, 0.3);
}

.history-modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    max-height: calc(85vh - 80px);
}

.history-filters {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    align-items: center;
}

.history-month-input {
    padding: 0.6rem 1rem;
    border: 2px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: 1rem;
    font-family: inherit;
}

.btn-history-load {
    background: var(--primary-gradient);
    color: white;
    border: none;
    padding: 0.6rem 1.5rem;
    border-radius: var(--radius-sm);
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition-fast);
}

.btn-history-load:hover {
    transform: translateY(-2px);
}

.history-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.history-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
    border: 1px solid var(--border-color);
    border-left: 4px solid #8b5cf6;
    border-radius: var(--radius-sm);
    transition: var(--transition-fast);
}

.history-item:hover {
    transform: translateX(4px);
}

.history-date {
    min-width: 100px;
    font-weight: 600;
    color: var(--text-primary);
}

.history-period {
    background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
}

.history-booker {
    flex: 1;
    color: var(--text-secondary);
    font-weight: 500;
}

.history-reason {
    max-width: 200px;
    color: var(--text-muted);
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ===== 批次預約功能 ===== */

.batch-booking-group {
    border: 2px dashed var(--border-color);
    border-radius: var(--radius-md);
    padding: 1rem;
    margin-bottom: 1rem;
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
}

.batch-dates {
    margin-top: 1rem;
}

.batch-hint {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
}

.batch-calendar {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
    margin-bottom: 1rem;
}

.batch-calendar-day {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.85rem;
    transition: var(--transition-fast);
    background: white;
}

.batch-calendar-day:hover {
    background: var(--bg-color);
}

.batch-calendar-day.selected {
    background: var(--primary-gradient);
    color: white;
    border-color: var(--primary-color);
}

.batch-calendar-day.disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.selected-dates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.selected-date-tag {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    background: var(--primary-gradient);
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
}

.selected-date-tag button {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 0;
    display: flex;
}

/* RWD 響應式 */
@media (max-width: 768px) {
    .history-modal {
        width: 95%;
        max-height: 90vh;
    }
    
    .history-filters {
        flex-direction: column;
    }
    
    .history-item {
        flex-wrap: wrap;
    }
    
    .history-reason {
        max-width: none;
        width: 100%;
        margin-top: 0.5rem;
    }
}
'''
    
    with open('styles.css', 'a', encoding='utf-8') as f:
        f.write(css_additions)
    
    print("CSS 更新完成！")

def update_js():
    """更新 app.js - 新增歷史記錄與批次預約 JavaScript 邏輯"""
    js_additions = '''

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
'''
    
    with open('app.js', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 在初始化區塊前新增函數
    if 'initHistoryEventListeners' not in content:
        # 在 DOMContentLoaded 的 initEventListeners() 後新增
        old_init = 'initEventListeners();'
        new_init = '''initEventListeners();
    initSearchEventListeners();
    initHistoryEventListeners();
    initBatchBooking();'''
        
        if old_init in content and 'initHistoryEventListeners' not in content:
            # 先新增函數定義
            content = content.replace('// ===== 初始化 =====', js_additions + '\n\n// ===== 初始化 =====')
            # 再更新 DOMContentLoaded
            content = content.replace(old_init, new_init)
            print("✓ 已新增 JavaScript 函數")
        else:
            print("✗ JavaScript 函數已存在或找不到位置")
        
        with open('app.js', 'w', encoding='utf-8') as f:
            f.write(content)
    else:
        print("JavaScript 已包含歷史記錄函數")
    
    print("JavaScript 更新完成！")

if __name__ == '__main__':
    print("="*50)
    print("新增歷史記錄與批次預約功能")
    print("="*50)
    update_html()
    update_css()
    update_js()
    print("="*50)
    print("全部完成！")
