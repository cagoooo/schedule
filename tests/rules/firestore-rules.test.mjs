// v2.59.5: Firestore 安全規則測試（管理員白名單＋老師免登入預約／原裝置取消）
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

const ADMIN = { email: 'ipad@mail2.smes.tyc.edu.tw', firebase: { sign_in_provider: 'password' } };
const STRANGER = { email: 'someone@example.com', firebase: { sign_in_provider: 'password' } };
const ANON = { firebase: { sign_in_provider: 'anonymous' } };

let env;

const booking = (extra = {}) => ({
    booker: '王老師', date: '2026/10/22', periods: ['period1', 'period2'],
    reason: '資訊課', room: '電腦教室(一)C212', deviceId: 'device-a', ...extra,
});

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'demo-schedule',
        firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
        await setDoc(doc(ctx.firestore(), 'bookings/b1'), booking());
    });
});

const db = who => who ? env.authenticatedContext(who.email || 'anon-uid', who).firestore() : env.unauthenticatedContext().firestore();

describe('預約 bookings', () => {
    it('老師免登入可新增預約', async () => {
        await assertSucceeds(setDoc(doc(db(), 'bookings/new1'), { ...booking({ deviceId: 'device-z' }), createdAt: serverTimestamp() }));
    });
    it('任何人都可讀取預約', async () => {
        await assertSucceeds(getDoc(doc(db(), 'bookings/b1')));
    });
    it('原裝置可取消單一節次或全部節次', async () => {
        await assertSucceeds(updateDoc(doc(db(), 'bookings/b1'), { periods: ['period2'], deviceId: 'device-a' }));
        await assertSucceeds(updateDoc(doc(db(), 'bookings/b1'), { periods: [], deviceId: 'device-a' }));
    });
    it('免登入不能改人名、場地，也不能加節次或換 deviceId', async () => {
        await assertFails(updateDoc(doc(db(), 'bookings/b1'), { booker: '冒名', deviceId: 'device-a' }));
        await assertFails(updateDoc(doc(db(), 'bookings/b1'), { room: '禮堂' }));
        await assertFails(updateDoc(doc(db(), 'bookings/b1'), { periods: ['period1', 'period2', 'period3'] }));
        await assertFails(updateDoc(doc(db(), 'bookings/b1'), { periods: ['period5'] }));
        await assertFails(updateDoc(doc(db(), 'bookings/b1'), { periods: [], deviceId: 'device-b' }));
    });
    it('免登入不能刪除預約', async () => {
        await assertFails(deleteDoc(doc(db(), 'bookings/b1')));
    });
    it('自建的一般帳號不能改刪他人預約', async () => {
        await assertFails(updateDoc(doc(db(STRANGER), 'bookings/b1'), { booker: '亂改' }));
        await assertFails(deleteDoc(doc(db(STRANGER), 'bookings/b1')));
        await assertFails(deleteDoc(doc(db(ANON), 'bookings/b1')));
    });
    it('冒用管理員 Email 但匿名登入也不行', async () => {
        await assertFails(deleteDoc(doc(db({ email: ADMIN.email, firebase: { sign_in_provider: 'anonymous' } }), 'bookings/b1')));
    });
    it('管理員可修改與刪除', async () => {
        await assertSucceeds(updateDoc(doc(db(ADMIN), 'bookings/b1'), { periods: ['period1'], reason: '改事由' }));
        await assertSucceeds(deleteDoc(doc(db(ADMIN), 'bookings/b1')));
    });
});

describe('其他管理員專用集合', () => {
    it('一般帳號不能改場地設定、讀稽核日誌', async () => {
        await assertFails(setDoc(doc(db(STRANGER), 'roomSettings/禮堂'), { unavailableSlots: [] }));
        await assertFails(getDoc(doc(db(STRANGER), 'audit_logs/x')));
        await assertFails(getDoc(doc(db(STRANGER), 'feedbacks/x')));
        await assertFails(getDoc(doc(db(STRANGER), 'editTrail/x')));
        await assertFails(deleteDoc(doc(db(STRANGER), 'roomAnnouncements/x')));
    });
    it('管理員可改場地設定、讀稽核日誌', async () => {
        await assertSucceeds(setDoc(doc(db(ADMIN), 'roomSettings/禮堂'), { unavailableSlots: [] }));
        await assertSucceeds(getDoc(doc(db(ADMIN), 'audit_logs/x')));
        await assertSucceeds(getDoc(doc(db(ADMIN), 'feedbacks/x')));
    });
    it('任何人仍可寫入稽核日誌（記錄自刪等操作）', async () => {
        await assertSucceeds(setDoc(doc(db(), 'audit_logs/y'), { action: 'DELETE_BOOKING' }));
    });
});
