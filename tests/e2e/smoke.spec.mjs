/**
 * E2E 煙霧測試 (P1-4) — 真瀏覽器驗證關鍵使用者流程
 * 全部唯讀: 只開畫面/彈窗, 絕不建立或刪除預約
 */
import { test, expect } from '@playwright/test';

// 擋掉 Service Worker 註冊:
// 首次安裝時 SW activate 的 clients.claim() 會觸發 controllerchange → 頁面自動 reload,
// 把測試開到一半的彈窗洗掉 (production 首訪的一次性行為)。
// SW 更新流程另有專屬驗證 (v2.52.0 已完整測過), 煙霧測試專注 app 流程。
test.beforeEach(async ({ context }) => {
    await context.route('**/sw.js*', route => route.abort());
});

test.describe('頁面載入', () => {
    test('首頁載入、標題與版本膠囊正確', async ({ page }) => {
        await page.goto('/index.html');
        await expect(page).toHaveTitle(/預約系統 v2\.\d+\.\d+/);
        await expect(page.locator('#designStamp')).toContainText(/v2\.\d+\.\d+/);
    });

    test('週檢視日曆渲染 (含預約按鈕)', async ({ page }) => {
        await page.goto('/index.html');
        // 等 Firestore 資料回來、骨架屏消失
        await expect(page.locator('.calendar-container, #calendarGrid, .week-grid').first())
            .toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: '預約' }).first())
            .toBeVisible({ timeout: 15_000 });
    });
});

test.describe('切換場地自動帶到日曆', () => {
    const calendarTopGap = (page) => page.evaluate(() => {
        const header = document.querySelector('.header').getBoundingClientRect();
        const calendar = document.querySelector('.calendar-container').getBoundingClientRect();
        return { gap: calendar.top - header.bottom, scrollY: window.scrollY };
    });

    test('手機版親手切換場地: 日曆頂端落在黏性頁首正下方', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/index.html');
        await expect(page.getByRole('button', { name: '預約' }).first())
            .toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

        // 鍵盤操作才是瀏覽器原生 change (isTrusted=true), selectOption 是程式觸發
        await page.locator('#roomSelect').focus();
        await page.keyboard.press('ArrowDown');

        await expect.poll(async () => (await calendarTopGap(page)).gap, { timeout: 5_000 })
            .toBeGreaterThanOrEqual(8);
        await expect.poll(async () => (await calendarTopGap(page)).gap, { timeout: 5_000 })
            .toBeLessThanOrEqual(16);
    });

    test('程式連動切換場地不捲動 (複製預約時背景同步)', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/index.html');
        await expect(page.getByRole('button', { name: '預約' }).first())
            .toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(500);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

        await page.locator('#roomSelect').selectOption({ index: 1 });
        await page.waitForTimeout(800);

        expect((await calendarTopGap(page)).scrollY).toBe(0);
    });
});

test.describe('手機版搜尋列 RWD', () => {
    test('節次選單高度 44px 且文字有足夠空間', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto('/index.html');

        const box = await page.locator('#searchPeriodFilter').evaluate((el) => {
            const style = getComputedStyle(el);
            return {
                height: el.getBoundingClientRect().height,
                contentHeight: el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
                fontSize: parseFloat(style.fontSize),
            };
        });

        expect(box.height).toBe(44);
        expect(box.contentHeight).toBeGreaterThanOrEqual(box.fontSize * 1.5);
    });
});

test.describe('手機版日期區塊 RWD', () => {
    for (const width of [375, 320]) {
        test(`${width}px: 日期欄位不超出外框內距且解除最小寬度`, async ({ page }) => {
            await page.setViewportSize({ width, height: 812 });
            await page.goto('/index.html');

            const result = await page.evaluate(() => {
                const group = document.querySelector('#startDate').closest('.control-group');
                const style = getComputedStyle(group);
                const innerRight = group.getBoundingClientRect().right
                    - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
                const inputs = ['#startDate', '#endDate'].map(id => document.querySelector(id));
                return {
                    innerRight,
                    rights: inputs.map(el => el.getBoundingClientRect().right),
                    heights: inputs.map(el => el.getBoundingClientRect().height),
                    minWidths: inputs.map(el => getComputedStyle(el).minWidth),
                    maxWidths: inputs.map(el => getComputedStyle(el).maxWidth),
                };
            });

            result.rights.forEach(right => expect(right).toBeLessThanOrEqual(result.innerRight + 0.5));
            result.heights.forEach(height => expect(height).toBeGreaterThanOrEqual(44));
            expect(result.minWidths).toEqual(['0px', '0px']);
            expect(result.maxWidths).toEqual(['100%', '100%']);
        });
    }
});

test.describe('LINE 綁定碼自動帶入', () => {
    test('綁定碼產生後，QR 與手機按鈕共用 LINE 預填連結', async ({ page }) => {
        await page.goto('/index.html');

        const result = await page.evaluate(() => {
            window.updateLineBindingUx(' bktml3 ');
            const qr = document.querySelector('#lineBindQrImg');
            const prefillLink = document.querySelector('#btnLineBindPrefill');
            return {
                href: prefillLink?.href,
                qrData: qr?.src ? new URL(qr.src).searchParams.get('data') : null,
                hint: document.querySelector('#lineBindPrefillHint')?.textContent,
            };
        });

        expect(result.href).toBe('https://line.me/R/oaMessage/%40450qmudw/?BKTML3');
        expect(result.qrData).toBe('https://line.me/R/oaMessage/%40450qmudw/?BKTML3');
        expect(result.hint).toContain('BKTML3');
    });
});

test.describe('我的預約 (M.3 + P1-1 + P1-5 + P1-7)', () => {
    test('開啟彈窗 → 通知開關/偏好列可見 → 關閉', async ({ page }) => {
        await page.goto('/index.html');
        await page.locator('#btnMyBookings').click();
        await expect(page.locator('#myBookingsModalOverlay')).toBeVisible();
        await expect(page.locator('#webPushRow')).toBeVisible();      // P1-1 通知開關
        await expect(page.locator('#notifPrefsRow')).toBeVisible();   // P1-5 偏好
        // 空裝置 → 空狀態或內容區出現 (資料載完)
        await expect(page.locator('#myBookingsContent'))
            .not.toContainText('loading', { timeout: 15_000 });
        await page.locator('#btnMyBookingsClose').click();
        await expect(page.locator('#myBookingsModalOverlay')).not.toBeVisible();
    });
});

test.describe('匯出區間選擇 (L.1/L.2)', () => {
    test('開啟彈窗 → 預設本學期 → 切換 chip 更新說明 → 關閉', async ({ page }) => {
        await page.goto('/index.html');
        await page.locator('#btnExport').click();
        await expect(page.locator('#exportModalOverlay')).toBeVisible();
        // 預設「本學期」active 且說明含學期字樣
        await expect(page.locator('#exportRangeChips .range-chip.active')).toHaveText('本學期');
        await expect(page.locator('#exportRangeDesc')).toContainText('學年');
        // 切「全部歷史」→ 出現警語
        await page.locator('#exportRangeChips .range-chip[data-range="all"]').click();
        await expect(page.locator('#exportRangeDesc')).toContainText('整個資料庫');
        // 切「自訂區間」→ 顯示日期輸入
        await page.locator('#exportRangeChips .range-chip[data-range="custom"]').click();
        await expect(page.locator('#exportCustomRange')).toBeVisible();
        await page.locator('#btnExportModalClose').click();
        await expect(page.locator('#exportModalOverlay')).not.toBeVisible();
    });
});

test.describe('統計 (L.3 學期感知)', () => {
    test('開啟統計 → 預設本學期 chip → 摘要載入', async ({ page }) => {
        await page.goto('/index.html');
        await page.locator('#btnStats').click();
        await expect(page.locator('#statsModalOverlay')).toBeVisible();
        await expect(page.locator('#statsRangeChips .range-chip.active')).toHaveText('本學期');
        // 等統計數字出現 (真實 Firestore 查詢)
        await expect(page.locator('#statsSummary')).toContainText(/\d/, { timeout: 15_000 });
        await page.locator('#btnStatsClose').click();
    });
});

test.describe('歷史查詢 (L.3 學期快速鍵)', () => {
    test('開啟歷史 → 學期 chips 存在 → 點本學期載入', async ({ page }) => {
        await page.goto('/index.html');
        await page.locator('#btnHistory').click();
        await expect(page.locator('#historyModalOverlay')).toBeVisible();
        await expect(page.locator('#historySemesterChips .range-chip')).toHaveCount(3);
        await page.locator('#historySemesterChips .range-chip[data-range="current"]').click();
        // 載入完成: 清單有項目或「沒有紀錄」提示
        await expect(page.locator('#historyList')).not.toBeEmpty({ timeout: 15_000 });
        await page.locator('#btnHistoryClose').click();
    });
});
