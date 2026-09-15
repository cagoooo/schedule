/**
 * 管理員教室 LINE 通知設定回歸測試
 *
 * roomWatchers 由前端提供可訂閱的場地清單，Cloud Function 對建立、
 * 整筆取消與管理員強制刪除共用同一個觀察者推播入口。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const functionsSource = readFileSync(path.resolve(__dirname, '../../functions/index.js'), 'utf8');

const COMPUTER_ROOMS = [
    '電腦教室(一)C212',
    '電腦教室(二)C213',
];

describe('管理員教室 LINE 通知設定', () => {
    it.each(COMPUTER_ROOMS)('%s 有建立與取消訂閱控制', (room) => {
        expect(html).toContain(`class="room-watch-row" data-room="${room}"`);
        expect(html).toContain(`data-action="subscribe" data-room="${room}"`);
        expect(html).toContain(`data-action="unsubscribe" data-room="${room}"`);
    });

    it('預約建立、一般取消與管理員強制取消都會通知 room watcher', () => {
        expect(functionsSource.match(/await notifyRoomWatchers\(/g)).toHaveLength(3);
        expect(functionsSource).toContain("'created'");
        expect(functionsSource).toContain("'cancelled'");
        expect(functionsSource).toContain("'force_deleted'");
    });
});
