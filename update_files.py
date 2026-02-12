import os

# Update app.js
app_js_path = r"h:\schedule\app.js"
try:
    with open(app_js_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    old_switch_view = """function switchView(mode) {
    viewMode = mode;

    // 更新按鈕狀態
    document.getElementById('btnViewWeek').classList.toggle('active', mode === 'week');
    document.getElementById('btnViewMonth').classList.toggle('active', mode === 'month');

    // 顯示/隱藏對應視圖
    document.getElementById('calendarGrid').style.display = mode === 'week' ? 'grid' : 'none';
    document.getElementById('monthCalendar').style.display = mode === 'month' ? 'block' : 'none';

    if (mode === 'week') {
        loadBookingsFromFirebase();
    } else {
        loadMonthBookings();
    }
}"""

    new_switch_view = """function switchView(mode) {
    viewMode = mode;

    // 更新按鈕狀態
    document.getElementById('btnViewWeek').classList.toggle('active', mode === 'week');
    document.getElementById('btnViewMonth').classList.toggle('active', mode === 'month');

    // 使用 class 控制顯示/隱藏（避免 CSS !important 覆蓋問題）
    const calendarGrid = document.getElementById('calendarGrid');
    const monthCalendar = document.getElementById('monthCalendar');
    
    if (mode === 'week') {
        calendarGrid.classList.remove('hidden');
        monthCalendar.classList.add('hidden');
        loadBookingsFromFirebase();
    } else {
        calendarGrid.classList.add('hidden');
        monthCalendar.classList.remove('hidden');
        loadMonthBookings();
    }

    // 自動滾動到日曆區域（改善手機端 UX）
    const calendarContainer = document.querySelector('.calendar-container');
    if (calendarContainer) {
        setTimeout(() => {
            calendarContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}"""

    if old_switch_view in content:
        new_content = content.replace(old_switch_view, new_switch_view)
        with open(app_js_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully updated app.js")
    else:
        print("Could not find target string in app.js")

except Exception as e:
    print(f"Error updating app.js: {e}")

# Update index.html
index_html_path = r"h:\schedule\index.html"
try:
    with open(index_html_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    old_html = 'class="month-calendar" id="monthCalendar" style="display: none;"'
    new_html = 'class="month-calendar hidden" id="monthCalendar"'
    
    if old_html in content:
        new_content = content.replace(old_html, new_html)
        with open(index_html_path, "w", encoding="utf-8") as f:
            f.write(new_content)
        print("Successfully updated index.html")
    else:
        print("Could not find target string in index.html")

except Exception as e:
    print(f"Error updating index.html: {e}")
