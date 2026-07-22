/**
 * Web Push VAPID 解碼 (P1-1) + 異動履歷值格式化 (P1-3) 測試
 */
import { describe, it, expect } from 'vitest';
import { loadApp } from './app-loader.mjs';

const { urlBase64ToUint8Array, formatTrailValue } = loadApp();

// 與 app.js 內嵌的 WEB_PUSH_PUBLIC_KEY 相同 (VAPID 公鑰本來就是公開的)
const VAPID_PUBLIC = 'BKj5fZ1qLjaZ7bu9u9F9ywyrqAGXHuwApi_rxEXcJfXIckUCB8rJXoHPMFzSk0_OptvBNO1SSut2C3u9sD7McUg';

describe('urlBase64ToUint8Array (VAPID 公鑰解碼)', () => {
    it('正式公鑰 → 65 bytes、首位元組 0x04 (未壓縮 EC 點)', () => {
        const arr = urlBase64ToUint8Array(VAPID_PUBLIC);
        expect(arr.length).toBe(65);
        expect(arr[0]).toBe(4);
    });

    it('base64url 特殊字元 (-/_) 正確轉換', () => {
        // 'A-_A' base64url → 'A+/A' base64 → bytes [3, 239, 192]
        const arr = urlBase64ToUint8Array('A-_A');
        expect(Array.from(arr)).toEqual([3, 239, 192]);
    });

    it('自動補 padding (長度非 4 倍數)', () => {
        // 'QUJD' 是 'ABC'; 去掉 padding 情境: 'QQ' → 'A' (1 byte, 0x41)
        const arr = urlBase64ToUint8Array('QQ');
        expect(Array.from(arr)).toEqual([0x41]);
    });
});

describe('formatTrailValue (異動履歷欄位值顯示)', () => {
    it('periods 陣列 → 節次中文名稱', () => {
        const out = formatTrailValue('periods', ['period1', 'period2']);
        expect(out).toContain('第一節');
        expect(out).toContain('第二節');
    });

    it('periods 空陣列 → 「全部取消」', () => {
        expect(formatTrailValue('periods', [])).toBe('（全部取消）');
    });

    it('null / undefined / 空字串 → 「空」佔位', () => {
        expect(formatTrailValue('reason', null)).toBe('（空）');
        expect(formatTrailValue('reason', undefined)).toBe('（空）');
        expect(formatTrailValue('reason', '')).toBe('（空）');
    });

    it('一般字串原樣輸出', () => {
        expect(formatTrailValue('room', '禮堂')).toBe('禮堂');
    });
});
