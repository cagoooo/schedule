import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

test('管理員跨週預覽與部分節次取消（資料存取全數替身）', async ({ page }) => {
    await page.route('**/sw.js*', route => route.abort());
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof openRecurringCancel === 'function' && document.getElementById('recurringCancelDialog'));
    await expect(page.locator('#btnRecurringCancel')).toBeVisible();
    await page.evaluate(() => {
        currentUser = { email: 'test@example.invalid' };
        Object.defineProperty(firebase.auth(), 'currentUser', { configurable: true, get: () => currentUser });
        updateAuthUI();
        window.testWrites = [];
        const rows = [
            { id: 'a', booker: '測試老師', room: '五年級IPAD車(28台)', date: '2026/09/14', periods: ['period1', 'period5'] },
            { id: 'b', booker: '測試老師', room: '五年級IPAD車(28台)', date: '2026/09/21', periods: ['period5'] }
        ];
        const query = { where() { return this; }, async get() { return { docs: rows.map(row => ({ id: row.id, data: () => row })) }; } };
        bookingsCollection.where = () => query;
        db.runTransaction = async callback => callback({
            get: async ref => ({ exists: true, data: () => rows.find(row => row.id === ref.id) }),
            update: (ref, value) => window.testWrites.push({ id: ref.id, value }),
            delete: ref => window.testWrites.push({ id: ref.id, deleted: true })
        });
        logSystemAction = () => {};
        loadBookingsFromFirebase = async () => {};
        openRecurringCancel(rows[0], { id: 'period5' });
    });
    await page.locator('#rcEnd').fill('2026-10-01');
    await page.getByRole('button', { name: '預覽符合的預約' }).click();
    await expect(page.locator('#rcStatus')).toContainText('已選 2 筆／2 節');
    await expect(page.locator('#rcResults')).toContainText('保留：第一節');
    await page.locator('#rcResults input').nth(1).uncheck();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#rcExecute').click();
    await expect(page.locator('#rcStatus')).toContainText('取消 1 筆');
    expect(await page.evaluate(() => window.testWrites)).toEqual([{ id: 'a', value: { periods: ['period1'] } }]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.locator('#recurringCancelDialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('老師只取消原設備預約，整筆清空而非刪除，交易再驗歸屬', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => document.getElementById('recurringCancelDialog'));
    await page.evaluate(() => {
        currentUser = null;
        Object.defineProperty(firebase.auth(), 'currentUser', { configurable: true, get: () => currentUser });
        const deviceId = getDeviceId();
        window.testWrites = [];
        const base = { booker: '測試老師', room: '五年級IPAD車(28台)', date: '2026/09/14', deviceId };
        const rows = [
            { ...base, id: 'partial', periods: ['period1', 'period5'] },
            { ...base, id: 'whole', date: '2026/09/21', periods: ['period5'] },
            { ...base, id: 'changed', date: '2026/09/28', periods: ['period5'] },
            { ...base, id: 'other-device', deviceId: 'another-browser', periods: ['period5'] },
            { ...base, id: 'no-device', deviceId: null, periods: ['period5'] }
        ];
        const query = { where() { return this; }, async get() { return { docs: rows.map(row => ({ id: row.id, data: () => row })) }; } };
        bookingsCollection.where = () => query;
        db.runTransaction = async callback => callback({
            get: async ref => ({ exists: true, data: () => {
                const row = rows.find(row => row.id === ref.id);
                return ref.id === 'changed' ? { ...row, deviceId: 'another-browser' } : row;
            } }),
            update: (ref, value) => window.testWrites.push({ id: ref.id, value }),
            delete: () => { throw new Error('老師不可刪除文件'); }
        });
        logSystemAction = () => {};
        loadBookingsFromFirebase = async () => {};
        openRecurringCancel(rows[0], { id: 'period5' });
    });
    await expect(page.locator('#rcTitle')).toHaveText('本機預約批次取消');
    await page.locator('#rcEnd').fill('2026-10-01');
    await page.getByRole('button', { name: '預覽符合的預約' }).click();
    await expect(page.locator('#rcStatus')).toContainText('已選 3 筆／3 節');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#rcExecute').click();
    await expect(page.locator('#rcStatus')).toContainText('取消 2 筆；1 筆資料或權限已異動而略過');
    const writes = await page.evaluate(() => window.testWrites);
    expect(writes.map(row => [row.id, row.value.periods])).toEqual([['partial', ['period1']], ['whole', []]]);
    expect(writes.every(row => !!row.value.deviceId)).toBe(true);
});
