import os

app_js_path = r"h:\schedule\app.js"

try:
    with open(app_js_path, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Insert HTML generation
    target_html_insert = "dayEl.appendChild(bookingsEl);"
    new_html_code = """dayEl.appendChild(bookingsEl);

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
        dayEl.appendChild(footerEl);"""
    
    if target_html_insert in content and "btn-book-mobile" not in content:
        content = content.replace(target_html_insert, new_html_code)
        print("Inserted HTML generation code")
    else:
        print("HTML generation code already exists or target not found")

    # 2. Insert Event Listener
    # We look for the closing of the previous forEach loop
    target_event_insert = """    document.querySelectorAll('.btn-book').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openBookingModal(btn.dataset.date);
        });
    });"""
    
    new_event_code = """    document.querySelectorAll('.btn-book').forEach(btn => {
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
    });"""

    if target_event_insert in content and "btn-book-mobile" in new_event_code:
        # Check if we already inserted event listener (simple check)
        if "document.querySelectorAll('.btn-book-mobile')" not in content:
            content = content.replace(target_event_insert, new_event_code)
            print("Inserted event listener code")
        else:
             print("Event listener code likely already exists")
    else:
        print("Target for event listener not found")

    with open(app_js_path, "w", encoding="utf-8") as f:
        f.write(content)
    print("Successfully updated app.js")

except Exception as e:
    print(f"Error updating app.js: {e}")
