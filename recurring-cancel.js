/* 管理員跨週取消：預覽固定快照，交易時重新核對，僅移除選定節次。 */
function planRecurringCancellation(bookings, filter) {
    return bookings.filter(b => b.room === filter.room && b.booker === filter.booker &&
        b.date >= filter.start && b.date <= filter.end &&
        filter.weekdays.includes(new Date(b.date.replaceAll('/', '-') + 'T12:00:00').getDay()))
        .map(b => ({ ...b, cancelPeriods: (b.periods || []).filter(p => filter.periods.includes(p)) }))
        .filter(b => b.cancelPeriods.length)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function remainingRecurringPeriods(live, preview) {
    if (!live || live.room !== preview.room || live.booker !== preview.booker || live.date !== preview.date ||
        live.deviceId !== preview.deviceId || live.reason !== preview.reason ||
        JSON.stringify([...(live.periods || [])].sort()) !== JSON.stringify([...preview.periods].sort())) {
        return null;
    }
    return live.periods.filter(p => !preview.cancelPeriods.includes(p));
}

let recurringPreview = [];
let recurringBusy = false;
let recurringGeneration = 0;
const recurringEl = id => document.getElementById(id);

function invalidateRecurringPreview() {
    recurringGeneration++;
    recurringPreview = [];
    recurringEl('rcResults').replaceChildren();
    recurringEl('rcStatus').textContent = '設定條件後，按「預覽符合的預約」。';
    recurringEl('rcExecute').disabled = true;
}

function openRecurringCancel(booking, period) {
    if (!requireAdmin('批次取消預約') || recurringBusy) return;
    const dialog = recurringEl('recurringCancelDialog');
    recurringEl('rcRoom').value = booking?.room || getSelectedRoom();
    recurringEl('rcBooker').value = booking?.booker || '';
    recurringEl('rcStart').value = booking?.date.replaceAll('/', '-') || recurringEl('startDate').value;
    recurringEl('rcEnd').value = recurringEl('endDate').value;
    if (recurringEl('rcEnd').value < recurringEl('rcStart').value) recurringEl('rcEnd').value = recurringEl('rcStart').value;
    const weekday = booking ? new Date(booking.date.replaceAll('/', '-') + 'T12:00:00').getDay() : 1;
    dialog.querySelectorAll('[name="rcWeekday"]').forEach(el => el.checked = Number(el.value) === weekday);
    dialog.querySelectorAll('[name="rcPeriod"]').forEach(el => el.checked = period ? el.value === period.id : (booking?.periods || []).includes(el.value));
    invalidateRecurringPreview();
    closeDeleteModal();
    dialog.showModal();
    recurringEl('rcBooker').focus();
}

async function previewRecurringCancellation() {
    if (!requireAdmin('批次取消預約') || recurringBusy) return;
    const form = recurringEl('rcForm');
    if (!form.reportValidity()) return;
    const filter = {
        room: recurringEl('rcRoom').value, booker: recurringEl('rcBooker').value.trim(),
        start: recurringEl('rcStart').value.replaceAll('-', '/'), end: recurringEl('rcEnd').value.replaceAll('-', '/'),
        weekdays: [...form.querySelectorAll('[name="rcWeekday"]:checked')].map(el => Number(el.value)),
        periods: [...form.querySelectorAll('[name="rcPeriod"]:checked')].map(el => el.value)
    };
    invalidateRecurringPreview();
    if (!filter.booker || filter.start > filter.end || !filter.weekdays.length || !filter.periods.length) {
        recurringEl('rcStatus').textContent = '請填寫老師完整姓名、有效日期範圍，並至少選一個星期與節次。';
        return;
    }
    const generation = recurringGeneration;
    recurringEl('rcStatus').textContent = '正在查詢跨週預約…';
    try {
        // 單欄位日期索引即可；不受目前日曆已載入週次限制。
        const snapshot = await bookingsCollection.where('date', '>=', filter.start).where('date', '<=', filter.end).get({ source: 'server' });
        if (generation !== recurringGeneration || !auth.currentUser) return;
        recurringPreview = planRecurringCancellation(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })), filter);
        const fragment = document.createDocumentFragment();
        recurringPreview.forEach((booking, index) => {
            const row = document.createElement('label');
            row.className = 'rc-result';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = String(index);
            checkbox.addEventListener('change', updateRecurringCount);
            const text = document.createElement('span');
            const names = ids => ids.map(id => PERIODS.find(p => p.id === id)?.name || id).join('、');
            const kept = booking.periods.filter(p => !booking.cancelPeriods.includes(p));
            text.textContent = `${booking.date}（${WEEKDAYS[new Date(booking.date.replaceAll('/', '-') + 'T12:00:00').getDay()]}） ${booking.booker}｜取消：${names(booking.cancelPeriods)}${kept.length ? `｜保留：${names(kept)}` : '｜整筆取消'}${booking.reason ? `｜${booking.reason}` : ''}`;
            row.append(checkbox, text); fragment.append(row);
        });
        recurringEl('rcResults').replaceChildren(fragment);
        updateRecurringCount();
    } catch (error) {
        if (generation === recurringGeneration) recurringEl('rcStatus').textContent = '查詢失敗，請確認網路後重試。';
        console.error('[Recurring cancel preview]', error);
    }
}

function selectedRecurringBookings() {
    return [...recurringEl('rcResults').querySelectorAll('input:checked')].map(el => recurringPreview[Number(el.value)]);
}

function updateRecurringCount() {
    const selected = selectedRecurringBookings();
    recurringEl('rcStatus').textContent = recurringPreview.length ? `找到 ${recurringPreview.length} 筆，已選 ${selected.length} 筆／${selected.reduce((n, b) => n + b.cancelPeriods.length, 0)} 節。可取消勾選不需處理的日期。` : '沒有符合條件的預約，請調整姓名、日期、星期或節次。';
    recurringEl('rcExecute').disabled = !selected.length;
}

async function executeRecurringCancellation() {
    if (!requireAdmin('批次取消預約') || recurringBusy) return;
    const selected = selectedRecurringBookings();
    if (!selected.length) return;
    const count = selected.reduce((n, b) => n + b.cancelPeriods.length, 0);
    if (!confirm(`確定取消「${selected[0].booker}」在「${selected[0].room}」勾選的 ${selected.length} 筆／${count} 節預約？\n其他節次會保留。取消後無法直接復原。`)) return;
    recurringBusy = true;
    recurringEl('rcControls').disabled = true;
    recurringEl('rcExecute').disabled = true;
    recurringEl('rcClose').disabled = true;
    recurringEl('rcResults').querySelectorAll('input').forEach(el => el.disabled = true);
    let success = 0, skipped = 0, failed = 0;
    const completed = [];
    try {
        for (const preview of selected) {
            recurringEl('rcStatus').textContent = `處理中 ${success + skipped + failed + 1} / ${selected.length}…`;
            try {
                if (!auth.currentUser) throw new Error('管理員已登出');
                const changed = await db.runTransaction(async transaction => {
                    const ref = bookingsCollection.doc(preview.id);
                    const snapshot = await transaction.get(ref);
                    const remaining = remainingRecurringPeriods(snapshot.exists ? snapshot.data() : null, preview);
                    if (remaining === null) return false;
                    if (remaining.length) transaction.update(ref, { periods: remaining });
                    else transaction.delete(ref);
                    return true;
                });
                if (changed) { success++; completed.push({ id: preview.id, periods: preview.cancelPeriods }); }
                else skipped++;
            } catch (error) { failed++; console.error('[Recurring cancel]', preview.id, error); }
        }
        bookingsCache = {}; monthBookingsCache = {};
        logSystemAction('BATCH_CANCEL_BOOKINGS', { attemptedCount: selected.length, successCount: success, filteredOut: skipped, failedCount: failed, executedBy: 'admin', cancelledPeriods: completed }, completed.map(b => b.id).join(','));
        invalidateRecurringPreview();
        recurringEl('rcStatus').textContent = `完成：取消 ${success} 筆；${skipped} 筆資料已異動而略過；${failed} 筆失敗。${skipped || failed ? '請重新預覽後再處理剩餘項目。' : ''}`;
        try { await loadBookingsFromFirebase(true); } catch (error) { showToast('取消已處理，日曆更新失敗，請重新查詢。', 'warning'); }
    } finally {
        recurringBusy = false;
        recurringEl('rcControls').disabled = false;
        recurringEl('rcClose').disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const button = document.createElement('button');
    button.id = 'btnRecurringCancel'; button.className = 'btn-history'; button.textContent = '批次取消';
    button.hidden = !currentUser; button.addEventListener('click', () => openRecurringCancel());
    recurringEl('btnHistory').after(button);
    const dialog = document.createElement('dialog');
    dialog.id = 'recurringCancelDialog'; dialog.className = 'rc-dialog';
    dialog.setAttribute('aria-labelledby', 'rcTitle');
    dialog.innerHTML = `<h2 id="rcTitle">管理員批次取消預約</h2>
        <p>跨週找出同一老師的固定節次，預覽後一次取消。請設定要處理的起訖日期。</p>
        <form id="rcForm"><fieldset id="rcControls"><div class="rc-fields">
        <label>場地<select id="rcRoom" required></select></label>
        <label>老師完整姓名<input id="rcBooker" required maxlength="50" placeholder="請輸入完整姓名（完全符合）"></label>
        <label>開始日期<input type="date" id="rcStart" required></label>
        <label>結束日期<input type="date" id="rcEnd" required></label></div>
        <fieldset><legend>星期（可複選）</legend><div class="rc-options" id="rcWeekdays"></div></fieldset>
        <fieldset><legend>只取消這些節次（可複選）</legend><div class="rc-options" id="rcPeriods"></div></fieldset>
        <button class="btn-history" type="submit">預覽符合的預約</button></fieldset></form>
        <p id="rcStatus" role="status" aria-live="polite"></p><div id="rcResults" class="rc-results"></div>
        <div class="rc-actions"><button id="rcClose" class="btn-delete-cancel">關閉</button><button id="rcExecute" class="btn-delete-confirm" disabled>取消勾選的節次</button></div>`;
    document.body.append(dialog);
    ROOMS.forEach(room => recurringEl('rcRoom').add(new Option(room, room)));
    const options = (target, name, values) => values.forEach(([value, label]) => {
        const el = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.name = name; input.value = value;
        el.append(input, document.createTextNode(label)); recurringEl(target).append(el);
    });
    options('rcWeekdays', 'rcWeekday', [1, 2, 3, 4, 5, 6, 0].map(day => [day, `週${WEEKDAYS[day]}`]));
    options('rcPeriods', 'rcPeriod', PERIODS.map(p => [p.id, p.name]));
    recurringEl('rcForm').addEventListener('input', invalidateRecurringPreview);
    recurringEl('rcForm').addEventListener('submit', event => { event.preventDefault(); previewRecurringCancellation(); });
    recurringEl('rcClose').addEventListener('click', () => { recurringGeneration++; dialog.close(); });
    dialog.addEventListener('cancel', event => { if (recurringBusy) event.preventDefault(); else recurringGeneration++; });
    recurringEl('rcExecute').addEventListener('click', executeRecurringCancellation);
});
