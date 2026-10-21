import { defineConfig } from 'vitest/config';

// Firestore 安全規則測試：需要 Firestore 模擬器，請用 `npm run test:rules` 執行
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/rules/**/*.test.mjs'],
        testTimeout: 20000,
        fileParallelism: false,
    },
});
