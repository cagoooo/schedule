import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });

test('進階分析初始化跨年學期日期，保留自訂區間並產生查詢', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-01-15T12:00:00+08:00'));
    await page.goto('/index.html');
    await page.evaluate(async () => {
        window.analyticsQueries = [];
        const query = {
            where(field, op, value) { window.analyticsQueries.push([field, op, value]); return this; },
            async get() { return { forEach() {} }; }
        };
        bookingsCollection.where = (...args) => query.where(...args);
        document.getElementById('analyticsStart').value = '';
        document.getElementById('analyticsEnd').value = '';
        await loadAdvancedAnalytics();
    });
    await expect(page.locator('#analyticsStart')).toHaveValue('2026-08-01');
    await expect(page.locator('#analyticsEnd')).toHaveValue('2027-01-31');
    expect(await page.evaluate(() => window.analyticsQueries)).toEqual([
        ['date', '>=', '2026/08/01'], ['date', '<=', '2027/01/31']
    ]);
    await expect(page.locator('#kpiTotalBookings')).toHaveText('0');
    await page.evaluate(async () => {
        document.getElementById('analyticsStart').value = '2027-01-05';
        document.getElementById('analyticsEnd').value = '2027-01-10';
        await loadAdvancedAnalytics();
    });
    await expect(page.locator('#analyticsStart')).toHaveValue('2027-01-05');
    await expect(page.locator('#analyticsEnd')).toHaveValue('2027-01-10');
});
