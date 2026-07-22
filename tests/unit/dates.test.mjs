/**
 * 日期工具測試 (formatDate / parseDate / getMonday)
 * 全系統的日期字串比較都建立在 'YYYY/MM/DD' 格式上, 格式錯 = 查詢區間全錯
 */
import { describe, it, expect } from 'vitest';
import { loadApp } from './app-loader.mjs';

const { formatDate, parseDate, getMonday } = loadApp();

describe('formatDate', () => {
    it('補零: 個位數月/日 → 兩位數', () => {
        expect(formatDate(new Date(2026, 7, 1))).toBe('2026/08/01');
        expect(formatDate(new Date(2026, 0, 5))).toBe('2026/01/05');
    });

    it('自訂分隔符', () => {
        expect(formatDate(new Date(2026, 7, 1), '-')).toBe('2026-08-01');
    });
});

describe('parseDate', () => {
    it('YYYY/MM/DD 與 formatDate 互為反函式', () => {
        const d = parseDate('2026/08/01');
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(7);
        expect(d.getDate()).toBe(1);
        expect(formatDate(d)).toBe('2026/08/01');
    });

    it('用本地時區建構 (無 UTC 位移一天問題)', () => {
        // 若誤用 new Date('2026-08-01') 在 UTC+8 會得到 8/1 08:00, 但某些時區會變 7/31
        const d = parseDate('2026/08/01');
        expect(d.getHours()).toBe(0);
    });
});

describe('getMonday', () => {
    it('週三 → 同週週一', () => {
        expect(formatDate(getMonday(new Date(2026, 6, 22)))).toBe('2026/07/20'); // 7/22 週三
    });

    it('週一 → 自己', () => {
        expect(formatDate(getMonday(new Date(2026, 6, 20)))).toBe('2026/07/20');
    });

    it('🔴 週日 → 「前面的」週一 (day===0 特殊處理)', () => {
        expect(formatDate(getMonday(new Date(2026, 6, 26)))).toBe('2026/07/20'); // 7/26 週日屬 7/20 那週
    });

    it('時間歸零 (00:00), 供日期比較', () => {
        const m = getMonday(new Date(2026, 6, 22, 15, 30));
        expect(m.getHours()).toBe(0);
        expect(m.getMinutes()).toBe(0);
    });
});
