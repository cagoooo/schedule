import { defineConfig } from '@playwright/test';

/**
 * E2E 煙霧測試設定 (P1-4)
 *
 * 注意:
 * - 需要本機 config.js (Firebase 設定, 不在 git) → E2E 定位為「本機執行」,
 *   CI 只跑 vitest 單元測試
 * - 測試唯讀操作真實 Firestore (開 modal / 看畫面), 絕不建立/刪除預約
 */
export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:8799',
        headless: true,
    },
    webServer: {
        command: 'python -m http.server 8799',
        url: 'http://localhost:8799/index.html',
        reuseExistingServer: true,
        timeout: 15_000,
    },
});
