import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

test('管理員跨週預覽與部分節次取消（資料存取全數替身）', async ({ page }) => {
    await page.route('**/sw.js*', route => route.abort());
    await page.goto('/index.html');
    await page.waitForFunction(() => typeof openRecurringCancel === 'function' && document.getElementById('recurringCancelDialog'));
    await expect(page.locator('#btnRecurringCancel')).toBeHidden();
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
