/**
 * 台灣學制學期換算測試 (L.3 getSemesterRange / getSchoolYearRange)
 * 這是全系統日期敏感度最高的邏輯 — 8/1 與 2/1 兩個學期邊界錯了,
 * 匯出、統計、歷史查詢的預設區間會全部跟著錯。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadApp } from './app-loader.mjs';

const { getSemesterRange, getSchoolYearRange } = loadApp();

function setToday(iso) {
    vi.setSystemTime(new Date(iso + 'T10:00:00+08:00'));
}

describe('getSemesterRange — 本學期判定', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('7/22 (暑假前, 下學期尾) → 114學年下學期', () => {
        setToday('2026-07-22');
        expect(getSemesterRange(0)).toEqual({
            label: '114學年下學期', start: '2026/02/01', end: '2026/07/31',
        });
    });

    it('7/31 (下學期最後一天) → 仍是下學期', () => {
        setToday('2026-07-31');
        expect(getSemesterRange(0).label).toBe('114學年下學期');
    });

    it('8/1 (新學年第一天) 🔴 邊界 → 115學年上學期', () => {
        setToday('2026-08-01');
        expect(getSemesterRange(0)).toEqual({
            label: '115學年上學期', start: '2026/08/01', end: '2027/01/31',
        });
    });

    it('1/31 (上學期最後一天) → 仍是上學期', () => {
        setToday('2027-01-31');
        expect(getSemesterRange(0)).toEqual({
            label: '115學年上學期', start: '2026/08/01', end: '2027/01/31',
        });
    });

    it('2/1 🔴 邊界 → 下學期', () => {
        setToday('2027-02-01');
        expect(getSemesterRange(0)).toEqual({
            label: '115學年下學期', start: '2027/02/01', end: '2027/07/31',
        });
    });
});

describe('getSemesterRange — offset 回推', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('開學日 offset -1 → 上一個學期 (114下)', () => {
        setToday('2026-08-01');
        expect(getSemesterRange(-1)).toEqual({
            label: '114學年下學期', start: '2026/02/01', end: '2026/07/31',
        });
    });

    it('offset -2 → 跨回上學年的上學期', () => {
        setToday('2026-08-01');
        expect(getSemesterRange(-2).label).toBe('114學年上學期');
        expect(getSemesterRange(-2).start).toBe('2025/08/01');
    });

    it('offset +1 → 下一個學期', () => {
        setToday('2026-07-22');
        expect(getSemesterRange(1)).toEqual({
            label: '115學年上學期', start: '2026/08/01', end: '2027/01/31',
        });
    });
});

describe('getSchoolYearRange — 全學年區間', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('7/22 → 114學年 (2025/08/01~2026/07/31)', () => {
        setToday('2026-07-22');
        expect(getSchoolYearRange()).toEqual({
            label: '114學年(全學年)', start: '2025/08/01', end: '2026/07/31',
        });
    });

    it('8/1 🔴 邊界 → 換到 115學年', () => {
        setToday('2026-08-01');
        expect(getSchoolYearRange()).toEqual({
            label: '115學年(全學年)', start: '2026/08/01', end: '2027/07/31',
        });
    });
});
