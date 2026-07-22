/**
 * 成就徽章演算法測試 (P1-7 computeAchievements)
 * 重點: 各門檻的臨界值 + 連續週 streak 演算法 (最容易寫錯的部分)
 */
import { describe, it, expect } from 'vitest';
import { loadApp } from './app-loader.mjs';

const { computeAchievements } = loadApp();

const mk = (date, room = '禮堂', periods = ['period1']) => ({ date, room, periods });
const get = (list, name) => list.find(a => a.name === name);

describe('累積筆數門檻', () => {
    it('0 筆 → 全部未解鎖', () => {
        const a = computeAchievements([]);
        expect(a.every(x => !x.unlocked)).toBe(true);
    });

    it('剛好 1 筆 → 只解鎖初次預約', () => {
        const a = computeAchievements([mk('2026/03/02')]);
        expect(get(a, '初次預約').unlocked).toBe(true);
        expect(get(a, '熟門熟路').unlocked).toBe(false);
    });

    it('9 筆 → 熟門熟路未達 (9/10); 10 筆 → 達成', () => {
        const nine = Array.from({ length: 9 }, (_, i) => mk(`2026/03/${String(i + 1).padStart(2, '0')}`));
        expect(get(computeAchievements(nine), '熟門熟路').unlocked).toBe(false);
        expect(get(computeAchievements(nine), '熟門熟路').progress).toBe('9/10');
        const ten = [...nine, mk('2026/03/10')];
        expect(get(computeAchievements(ten), '熟門熟路').unlocked).toBe(true);
    });
});

describe('場地種類門檻', () => {
    it('3 種場地 → 探索者解鎖, 全場制霸 3/6', () => {
        const a = computeAchievements([
            mk('2026/03/02', '禮堂'), mk('2026/03/03', '校史室'), mk('2026/03/04', '森林小屋'),
        ]);
        expect(get(a, '探索者').unlocked).toBe(true);
        expect(get(a, '全場制霸').unlocked).toBe(false);
        expect(get(a, '全場制霸').progress).toBe('3/6');
    });

    it('同場地重複預約只算 1 種', () => {
        const a = computeAchievements([
            mk('2026/03/02', '禮堂'), mk('2026/03/03', '禮堂'), mk('2026/03/04', '禮堂'),
        ]);
        expect(get(a, '探索者').unlocked).toBe(false);
    });
});

describe('連續週 streak 演算法', () => {
    it('連續 4 週 (每週一筆) → 週週報到解鎖', () => {
        const a = computeAchievements([
            mk('2026/03/02'), mk('2026/03/09'), mk('2026/03/16'), mk('2026/03/23'),
        ]);
        expect(get(a, '週週報到').unlocked).toBe(true);
    });

    it('中間斷一週 → 不解鎖 (3+1 非連續)', () => {
        const a = computeAchievements([
            mk('2026/03/02'), mk('2026/03/09'), mk('2026/03/16'),
            /* 3/23 那週缺席 */ mk('2026/03/30'),
        ]);
        expect(get(a, '週週報到').unlocked).toBe(false);
    });

    it('同一週多筆只算 1 週', () => {
        const a = computeAchievements([
            mk('2026/03/02'), mk('2026/03/03'), mk('2026/03/04'), mk('2026/03/05'),
        ]);
        expect(get(a, '週週報到').unlocked).toBe(false); // 4 筆但只有 1 週
        expect(get(a, '週週報到').progress).toBe('1/4 週');
    });

    it('跨週日/週一邊界: 週日與次日週一屬不同週', () => {
        // 2026/03/08 是週日 (屬 3/02 那週), 2026/03/09 是週一 (新週)
        const a = computeAchievements([mk('2026/03/08'), mk('2026/03/09')]);
        expect(get(a, '週週報到').progress).toBe('2/4 週');
    });
});

describe('晨型老師', () => {
    it('morning 節次 5 次 → 解鎖; 其他節次不計', () => {
        const four = Array.from({ length: 4 }, (_, i) => mk(`2026/03/0${i + 2}`, '禮堂', ['morning']));
        const withNoise = [...four, mk('2026/03/06', '禮堂', ['period1'])];
        expect(get(computeAchievements(withNoise), '晨型老師').unlocked).toBe(false);
        const five = [...four, mk('2026/03/06', '禮堂', ['morning', 'period1'])];
        expect(get(computeAchievements(five), '晨型老師').unlocked).toBe(true);
    });
});
