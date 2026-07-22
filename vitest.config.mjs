import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom', // app.js 需要 document / localStorage / atob
        include: ['tests/unit/**/*.test.mjs'],
        // E2E 由 Playwright 負責, 不在 vitest 範圍
    },
});
