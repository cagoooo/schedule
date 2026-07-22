/**
 * app.js 測試沙箱載入器 (v2.55.x / P1-4)
 *
 * app.js 是無模組系統的全域 script (直接 <script src> 載入),
 * 這裡把它的原始碼塞進 new Function 沙箱, 注入最小 firebase/db mock,
 * 再把「純邏輯函式」撈出來給單元測試用。
 *
 * 注意: 只測不碰 Firestore/DOM 狀態的純函式;
 *       需要真實 DB 的行為由 Playwright E2E 負責。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');

// 萬用 chainable stub: 任何屬性存取回傳自身、可呼叫
// then/catch/finally 吃掉 callback 但「永不執行」— app.js 頂層的
// db.enablePersistence().then().catch() 之類鏈式呼叫不會炸、也不會真的跑非同步路徑
function makeStub() {
    const fn = function () { return proxy; };
    const swallow = function (_cb) { return proxy; };
    const proxy = new Proxy(fn, {
        get(_t, prop) {
            if (prop === 'then' || prop === 'catch' || prop === 'finally') return swallow;
            if (prop === Symbol.toPrimitive) return () => '';
            return proxy;
        },
        apply() { return proxy; },
    });
    return proxy;
}

// 想撈出來測的函式清單 (typeof 防呆: app.js 重構移除某函式時, 測試會明確 undefined 而非炸裂)
const EXPORT_NAMES = [
    'getSemesterRange', 'getSchoolYearRange',
    'computeAchievements',
    'urlBase64ToUint8Array', 'webPushSupported',
    'formatDate', 'parseDate', 'getMonday',
    'formatTrailValue',
    'getDeviceId',
];

let cached = null;

export function loadApp() {
    if (cached) return cached;

    const returnObj = EXPORT_NAMES
        .map(n => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`)
        .join(',\n');

    // app.js 自己宣告 const db/auth (來自 firebase.firestore()/auth()),
    // 沙箱只注入 firebase 與 firebaseConfig (正式環境由 config.js 提供)
    const factory = new Function(
        'firebase', 'firebaseConfig', 'Sentry',
        `${appSource}\n;return {\n${returnObj}\n};`
    );
    cached = factory(makeStub(), {}, undefined);
    return cached;
}
