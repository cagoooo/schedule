import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(readFileSync('recurring-cancel.js', 'utf8'), context);
const plan = context.planRecurringCancellation;
const remaining = context.remainingRecurringPeriods;
const booking = { id: 'a', room: '五年級IPAD車(28台)', booker: '老師甲', date: '2026/09/14', periods: ['period1', 'period5'], deviceId: 'device-a', reason: '教學' };
const filter = { room: booking.room, booker: booking.booker, start: '2026/09/14', end: '2026/10/12', weekdays: [1], periods: ['period5'] };
describe('跨週指定節次取消', () => {
    it('跨週比對完整姓名、場地、星期、日期邊界與節次', () => {
        const rows = [booking, { ...booking, id: 'b', date: '2026/10/12' },
            { ...booking, id: 'other-name', booker: '老師甲乙' },
            { ...booking, id: 'other-room', room: '禮堂' },
            { ...booking, id: 'tuesday', date: '2026/09/15' },
            { ...booking, id: 'late', date: '2026/10/19' },
            { ...booking, id: 'early', date: '2026/09/07' },
            { ...booking, id: 'cancelled', periods: [] }];
        expect(Array.from(plan(rows, filter), b => b.id)).toEqual(['a', 'b']);
    });
    it('僅取消第五節，保留第一節', () => {
        const preview = plan([booking], filter)[0];
        expect(Array.from(remaining(booking, preview))).toEqual(['period1']);
        expect(booking.periods).toEqual(['period1', 'period5']);
    });
    it('全部選中回傳空陣列，讓交易刪除整筆', () => {
        const preview = plan([booking], { ...filter, periods: booking.periods })[0];
        expect(Array.from(remaining(booking, preview))).toEqual([]);
    });
    it.each([
        null, { ...booking, booker: '其他老師' }, { ...booking, room: '禮堂' },
        { ...booking, date: '2026/09/21' }, { ...booking, periods: ['period5'] },
        { ...booking, reason: '已修改' }, { ...booking, deviceId: 'other' }
    ])('略過預覽後被修改或刪除的預約 %j', live => {
        expect(remaining(live, plan([booking], filter)[0])).toBeNull();
    });
});
