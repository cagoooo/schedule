/**
 * Cloud Functions for 禮堂&專科教室預約系統
 * Phase 1 (v2.44.0): LINE 綁定基礎建設
 * Phase 2 (v2.45.0): 預約事件推播 (建立/取消/強刪)
 * Phase 3 (v2.46.0): 排程提醒 + 管理員告警 (取代 Sentry)
 *
 * 安全提醒:
 * - LINE Channel Secret / Access Token 透過 Firebase Functions Secrets 注入
 * - 永遠不在此檔案 hardcode 任何 secrets
 * - 設定方式:
 *     firebase functions:secrets:set LINE_CHANNEL_SECRET
 *     firebase functions:secrets:set LINE_ACCESS_TOKEN
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const line = require('@line/bot-sdk');
const crypto = require('crypto');

// 初始化 Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// 全域設定 — 部署到 asia-east1 (台灣最近)
setGlobalOptions({
    region: 'asia-east1',
    maxInstances: 10,
    timeoutSeconds: 30,
});

// LINE Secrets (在 Firebase Functions Secrets 中設定, 不寫入程式碼)
const LINE_CHANNEL_SECRET = defineSecret('LINE_CHANNEL_SECRET');
const LINE_ACCESS_TOKEN = defineSecret('LINE_ACCESS_TOKEN');

// ===== 工具函式 =====

/**
 * 產生 6 位數字英文混合綁定碼
 */
function generateBindingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字元
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/**
 * 取得 LINE Bot client (lazy init, 確保 secrets 已注入)
 */
function getLineClient(accessToken) {
    return new line.messagingApi.MessagingApiClient({
        channelAccessToken: accessToken,
    });
}

// ==========================================================================
// API #1: createBindingCode
// 由前端呼叫,為當前 deviceId 產生綁定碼,存入 Firestore (5 分鐘有效)
// ==========================================================================

exports.createBindingCode = onRequest({ cors: true }, async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { deviceId, displayName } = req.body || {};
        if (!deviceId || typeof deviceId !== 'string') {
            res.status(400).json({ error: 'deviceId required' });
            return;
        }

        // 清掉同 deviceId 的舊綁定碼
        const existing = await db.collection('lineBindingCodes')
            .where('deviceId', '==', deviceId)
            .get();
        const batch = db.batch();
        existing.forEach(doc => batch.delete(doc.ref));
        await batch.commit();

        // 產生新綁定碼 (含碰撞重試)
        let code, retries = 0;
        while (retries < 5) {
            code = generateBindingCode();
            const dup = await db.collection('lineBindingCodes').doc(code).get();
            if (!dup.exists) break;
            retries += 1;
        }
        if (retries >= 5) throw new Error('Failed to generate unique code');

        // 寫入 Firestore (5 分鐘 TTL)
        const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000);
        await db.collection('lineBindingCodes').doc(code).set({
            code,
            deviceId,
            displayName: displayName || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt,
            status: 'pending',
        });

        logger.info(`[Binding] Created code ${code} for device ${deviceId}`);
        res.status(200).json({
            code,
            expiresInSeconds: 300,
            instructions: '請在 5 分鐘內加 LINE Bot 為好友後,傳送這組綁定碼給 Bot。',
        });
    } catch (err) {
        logger.error('[createBindingCode]', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================================
// API #2: lineWebhook
// LINE Bot 訊息接收端點 — 驗證簽章 + 處理綁定 + 回覆
// ==========================================================================

exports.lineWebhook = onRequest(
    {
        secrets: [LINE_CHANNEL_SECRET, LINE_ACCESS_TOKEN],
        cors: false,  // LINE webhook 不需 CORS
    },
    async (req, res) => {
        const signature = req.headers['x-line-signature'];
        const channelSecret = LINE_CHANNEL_SECRET.value();
        const accessToken = LINE_ACCESS_TOKEN.value();

        // 1. 驗證 LINE 簽章
        if (!signature) {
            logger.warn('[Webhook] Missing X-Line-Signature header');
            res.status(401).send('Missing signature');
            return;
        }

        // 取得原始 body (Firebase Functions v2 提供 req.rawBody Buffer)
        let rawBodyBuffer;
        if (req.rawBody && Buffer.isBuffer(req.rawBody)) {
            rawBodyBuffer = req.rawBody;
        } else if (typeof req.body === 'string') {
            rawBodyBuffer = Buffer.from(req.body, 'utf8');
        } else {
            rawBodyBuffer = Buffer.from(JSON.stringify(req.body), 'utf8');
        }

        // 計算 HMAC-SHA256 並比對 (用 crypto 直接算,避免任何 SDK 編碼問題)
        // ⚠ 重點: secret 必須是純 32-char hex,任何 \n / 空白都會讓簽章對不上
        const expectedSig = crypto.createHmac('sha256', channelSecret)
            .update(rawBodyBuffer)
            .digest('base64');

        if (expectedSig !== signature) {
            logger.warn('[Webhook] Signature mismatch', {
                bodyLen: rawBodyBuffer.length,
                secretLen: channelSecret.length,
                receivedPrefix: signature.substring(0, 8),
                expectedPrefix: expectedSig.substring(0, 8),
            });
            res.status(401).send('Unauthorized');
            return;
        }

        const events = req.body.events || [];
        const client = getLineClient(accessToken);

        // 並行處理所有 events
        const results = await Promise.allSettled(
            events.map(event => handleLineEvent(event, client))
        );

        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                logger.error(`[Webhook] Event ${i} failed`, r.reason);
            }
        });

        res.status(200).send('OK');
    }
);

/**
 * 處理單一 LINE event (follow / message / unfollow)
 */
async function handleLineEvent(event, client) {
    const userId = event.source?.userId;
    if (!userId) return;

    // === 加好友事件 ===
    if (event.type === 'follow') {
        logger.info(`[Webhook] New follower: ${userId}`);
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: '👋 歡迎使用「禮堂&專科教室預約系統」LINE 通知!\n\n' +
                      '請至預約系統點選「🔗 綁定 LINE」取得 6 位綁定碼,\n' +
                      '再回到這裡傳給我即可完成綁定。\n\n' +
                      '綁定後您將收到:\n' +
                      '✅ 預約確認通知\n' +
                      '⏰ 使用前 30 分鐘提醒\n' +
                      '❌ 取消/異動通知',
            }],
        });
        return;
    }

    // === 取消追蹤事件 ===
    if (event.type === 'unfollow') {
        logger.info(`[Webhook] Unfollow: ${userId}`);
        // 自動解除綁定
        const bindings = await db.collection('lineBindings')
            .where('lineUserId', '==', userId)
            .get();
        const batch = db.batch();
        bindings.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        return;
    }

    // === 訊息事件 ===
    if (event.type === 'message' && event.message?.type === 'text') {
        const text = event.message.text.trim().toUpperCase();

        // 嘗試匹配綁定碼 (6 碼英數)
        if (/^[A-Z0-9]{6}$/.test(text)) {
            await handleBindingCode(event, client, text, userId);
            return;
        }

        // 簡易指令:幫助 / 我的預約 (Phase 4 才實作完整查詢)
        if (text === '幫助' || text.toLowerCase() === 'help') {
            await client.replyMessage({
                replyToken: event.replyToken,
                messages: [{
                    type: 'text',
                    text: '📖 可用指令:\n\n' +
                          '✉ 傳送 6 位綁定碼 → 完成綁定\n' +
                          '✉ 傳送「我的預約」→ 查看您的預約 (Phase 4 開放)\n' +
                          '✉ 傳送「幫助」→ 查看說明',
                }],
            });
            return;
        }

        // 預設回覆
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: '🤔 不太明白您的訊息。\n\n' +
                      '若要綁定,請至預約系統取得 6 位綁定碼,並完整輸入 (大寫英數混合)。\n' +
                      '或傳「幫助」查看可用指令。',
            }],
        });
    }
}

/**
 * 處理綁定碼訊息
 */
async function handleBindingCode(event, client, code, lineUserId) {
    const codeDoc = await db.collection('lineBindingCodes').doc(code).get();

    if (!codeDoc.exists) {
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: '❌ 綁定碼不存在或已過期。\n\n請至預約系統重新產生綁定碼。',
            }],
        });
        return;
    }

    const data = codeDoc.data();
    const now = Date.now();
    const expiresAt = data.expiresAt?.toMillis?.() || 0;

    if (expiresAt < now) {
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: '⏰ 此綁定碼已過期 (5 分鐘有效)。\n\n請至預約系統重新產生。',
            }],
        });
        // 清掉過期的
        await codeDoc.ref.delete();
        return;
    }

    if (data.status === 'used') {
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: '⚠ 此綁定碼已被使用過。\n\n請至預約系統重新產生新碼。',
            }],
        });
        return;
    }

    // 取得 LINE 使用者 profile (顯示名稱)
    let displayName = '未知';
    try {
        const profile = await client.getProfile(lineUserId);
        displayName = profile.displayName || displayName;
    } catch (e) {
        logger.warn(`[Bind] Failed to get profile for ${lineUserId}`, e.message);
    }

    // 寫入綁定關係
    await db.collection('lineBindings').doc(data.deviceId).set({
        deviceId: data.deviceId,
        lineUserId,
        lineDisplayName: displayName,
        bookerName: data.displayName || null,
        boundAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 標記綁定碼已使用
    await codeDoc.ref.update({
        status: 'used',
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
        usedByLineUserId: lineUserId,
    });

    // 回覆成功訊息
    await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
            type: 'text',
            text: `✅ 綁定成功!\n\n` +
                  `LINE: ${displayName}\n` +
                  `裝置已關聯至預約系統。\n\n` +
                  `往後您預約時將自動收到 LINE 通知 🎉\n\n` +
                  `如要解除綁定,請封鎖本帳號即可自動解除。`,
        }],
    });

    // 寫入稽核日誌
    await db.collection('audit_logs').add({
        action: 'LINE_BIND',
        targetId: data.deviceId,
        details: {
            deviceId: data.deviceId,
            lineUserId,
            lineDisplayName: displayName,
        },
        performedBy: 'lineWebhook',
        userEmail: null,
        deviceId: data.deviceId,
        ip: 'LINE-Webhook',
        userAgent: 'LINE Bot',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`[Bind] ✅ ${data.deviceId} ↔ ${lineUserId} (${displayName})`);
}

// ==========================================================================
// API #3: checkBindingStatus
// 前端輪詢:綁定碼是否已被使用 (改善 UX, 自動偵測綁定完成)
// ==========================================================================

exports.checkBindingStatus = onRequest({ cors: true }, async (req, res) => {
    try {
        const code = req.query.code || (req.body && req.body.code);
        if (!code) {
            res.status(400).json({ error: 'code required' });
            return;
        }

        const doc = await db.collection('lineBindingCodes').doc(code).get();
        if (!doc.exists) {
            res.status(404).json({ status: 'not_found' });
            return;
        }

        const data = doc.data();
        if (data.status === 'used') {
            res.status(200).json({
                status: 'bound',
                lineUserId: data.usedByLineUserId,
            });
        } else {
            res.status(200).json({
                status: 'pending',
                expiresAt: data.expiresAt?.toMillis?.() || 0,
            });
        }
    } catch (err) {
        logger.error('[checkBindingStatus]', err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================================================
// Phase 2 (v2.45.0): 預約事件推播
// ==========================================================================

// 節次 ID → 中文名稱對應 (與前端 PERIODS 同步)
const PERIOD_NAMES = {
    morning: '晨間/早會',
    period1: '第一節', period2: '第二節', period3: '第三節', period4: '第四節',
    lunch: '午餐/午休',
    period5: '第五節', period6: '第六節', period7: '第七節', period8: '第八節',
};

const APP_URL = 'https://cagoooo.github.io/schedule/';

/**
 * 將 period IDs 陣列轉成中文逗號字串
 */
function formatPeriods(periodIds) {
    if (!Array.isArray(periodIds) || periodIds.length === 0) return '無';
    return periodIds.map(id => PERIOD_NAMES[id] || id).join('、');
}

/**
 * 取得綁定的 LINE userId,沒綁定回 null
 */
async function getBoundLineUserId(deviceId) {
    if (!deviceId) return null;
    try {
        const doc = await db.collection('lineBindings').doc(deviceId).get();
        if (!doc.exists) return null;
        return doc.data().lineUserId;
    } catch (err) {
        logger.warn('[Push] 查綁定失敗', err);
        return null;
    }
}

/**
 * 建立預約相關 Flex Message
 * @param {Object} booking - 預約資料
 * @param {'created'|'cancelled'|'force_deleted'} eventType
 */
function createBookingFlexMessage(booking, eventType) {
    const config = {
        created: {
            title: '✅ 預約成功確認',
            color: '#06c755',
            hint: '感謝您的預約!',
        },
        cancelled: {
            title: '❌ 預約已取消',
            color: '#ef4444',
            hint: '此預約已成功取消。',
        },
        force_deleted: {
            title: '⚠ 預約已被管理員取消',
            color: '#f59e0b',
            hint: '管理員已強制取消此預約,請洽詢確認原因。',
        },
    }[eventType] || { title: '📌 預約異動通知', color: '#6366f1', hint: '' };

    const periodsStr = formatPeriods(booking.periods);
    const altText = `${config.title}: ${booking.room || '禮堂'} ${booking.date}`;

    return {
        type: 'flex',
        altText,
        contents: {
            type: 'bubble',
            size: 'mega',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: config.color,
                paddingAll: '15px',
                contents: [{
                    type: 'text',
                    text: config.title,
                    color: '#FFFFFF',
                    weight: 'bold',
                    size: 'lg',
                    align: 'center',
                }],
            },
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                paddingAll: '15px',
                contents: [
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '📅', size: 'sm', flex: 0 },
                            { type: 'text', text: '日期', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: booking.date || '-', size: 'sm', flex: 5, weight: 'bold' },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '📍', size: 'sm', flex: 0 },
                            { type: 'text', text: '場地', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: booking.room || '禮堂', size: 'sm', flex: 5, weight: 'bold', wrap: true },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '⏰', size: 'sm', flex: 0 },
                            { type: 'text', text: '節次', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: periodsStr, size: 'sm', flex: 5, weight: 'bold', wrap: true },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '👤', size: 'sm', flex: 0 },
                            { type: 'text', text: '預約者', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: booking.booker || '-', size: 'sm', flex: 5, weight: 'bold' },
                        ],
                    },
                    { type: 'separator', margin: 'md' },
                    {
                        type: 'box',
                        layout: 'vertical',
                        margin: 'md',
                        contents: [
                            { type: 'text', text: '📝 預約理由', size: 'xs', color: '#888888' },
                            { type: 'text', text: booking.reason || '無', size: 'sm', wrap: true, margin: 'xs' },
                        ],
                    },
                    {
                        type: 'text',
                        text: config.hint || '​',
                        size: 'xs',
                        color: '#888888',
                        margin: 'md',
                        wrap: true,
                    },
                ],
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                paddingAll: '10px',
                contents: [{
                    type: 'button',
                    style: 'primary',
                    color: config.color,
                    height: 'sm',
                    action: {
                        type: 'uri',
                        label: '🔗 開啟預約系統',
                        uri: APP_URL,
                    },
                }],
            },
        },
    };
}

/**
 * 推播 Flex Message 到指定 LINE userId (含完整錯誤處理)
 */
async function pushFlexToUser(lineUserId, flexMessage, accessToken, contextLog) {
    try {
        const client = new line.messagingApi.MessagingApiClient({
            channelAccessToken: accessToken,
        });
        await client.pushMessage({
            to: lineUserId,
            messages: [flexMessage],
        });
        logger.info(`[Push] ✅ ${contextLog} → ${lineUserId.substring(0, 8)}...`);
    } catch (err) {
        logger.error(`[Push] ❌ ${contextLog}: status=${err.statusCode || '?'}, msg=${err.message}`);
        // 不 throw - 推播失敗不應阻擋主流程
    }
}

// ==========================================================================
// Function #4: notifyOnBookingCreate
// 監聽 bookings collection onCreate → 推「✅ 預約成功」
// ==========================================================================

exports.notifyOnBookingCreate = onDocumentCreated(
    {
        document: 'bookings/{bookingId}',
        secrets: [LINE_ACCESS_TOKEN],
        region: 'asia-east1',
    },
    async (event) => {
        const booking = event.data?.data();
        if (!booking) return;

        const bookingId = event.params.bookingId;
        const lineUserId = await getBoundLineUserId(booking.deviceId);
        if (!lineUserId) {
            logger.info(`[notifyOnBookingCreate] 預約 ${bookingId} 未綁定 LINE,跳過`);
            return;
        }

        const flex = createBookingFlexMessage({ ...booking, id: bookingId }, 'created');
        await pushFlexToUser(
            lineUserId,
            flex,
            LINE_ACCESS_TOKEN.value(),
            `預約建立 ${booking.room} ${booking.date}`
        );
    }
);

// ==========================================================================
// Function #5: notifyOnBookingUpdate
// 監聽 bookings onUpdate → 若 periods 從非空變空 (= 取消) → 推「❌ 預約已取消」
// ==========================================================================

exports.notifyOnBookingUpdate = onDocumentUpdated(
    {
        document: 'bookings/{bookingId}',
        secrets: [LINE_ACCESS_TOKEN],
        region: 'asia-east1',
    },
    async (event) => {
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!before || !after) return;

        const wasActive = before.periods && before.periods.length > 0;
        const isCancelled = !after.periods || after.periods.length === 0;

        if (!wasActive || !isCancelled) return; // 不是「從有效變取消」,跳過

        const bookingId = event.params.bookingId;
        const lineUserId = await getBoundLineUserId(before.deviceId || after.deviceId);
        if (!lineUserId) {
            logger.info(`[notifyOnBookingUpdate] ${bookingId} 取消但未綁定`);
            return;
        }

        const flex = createBookingFlexMessage({ ...before, id: bookingId }, 'cancelled');
        await pushFlexToUser(
            lineUserId,
            flex,
            LINE_ACCESS_TOKEN.value(),
            `預約取消 ${before.room} ${before.date}`
        );
    }
);

// ==========================================================================
// Function #6: notifyOnBookingDelete
// 監聽 bookings onDelete → 推「⚠ 預約已被管理員取消」
// (使用者自取消通常用 update periods=[],會走 #5;只有強刪才走這個)
// ==========================================================================

exports.notifyOnBookingDelete = onDocumentDeleted(
    {
        document: 'bookings/{bookingId}',
        secrets: [LINE_ACCESS_TOKEN],
        region: 'asia-east1',
    },
    async (event) => {
        const booking = event.data?.data();
        if (!booking) return;

        // 若刪除前已經沒 periods (= 已取消過),避免重複推
        if (!booking.periods || booking.periods.length === 0) return;

        const bookingId = event.params.bookingId;
        const lineUserId = await getBoundLineUserId(booking.deviceId);
        if (!lineUserId) {
            logger.info(`[notifyOnBookingDelete] ${bookingId} 強刪但未綁定`);
            return;
        }

        const flex = createBookingFlexMessage({ ...booking, id: bookingId }, 'force_deleted');
        await pushFlexToUser(
            lineUserId,
            flex,
            LINE_ACCESS_TOKEN.value(),
            `預約強刪 ${booking.room} ${booking.date}`
        );
    }
);

// ==========================================================================
// Phase 3 (v2.46.0): 排程提醒 + 管理員告警
// ==========================================================================

// 節次開始時間 (24h 制) — 30 分鐘前提醒會用到
const PERIOD_START_TIMES = {
    morning: '07:50',
    period1: '08:40',
    period2: '09:30',
    period3: '10:30',
    period4: '11:20',
    lunch: '12:00',
    period5: '13:00',
    period6: '13:50',
    period7: '14:40',
    period8: '15:30',
};

/**
 * 將 'YYYY/MM/DD' + 'HH:MM' 轉成 Date 物件 (台灣時間)
 */
function parsePeriodDateTime(dateStr, periodId) {
    const time = PERIOD_START_TIMES[periodId];
    if (!time || !dateStr) return null;
    // 'YYYY/MM/DD' → 'YYYY-MM-DDTHH:MM:00+08:00' (台灣時區)
    const isoDate = dateStr.replace(/\//g, '-');
    return new Date(`${isoDate}T${time}:00+08:00`);
}

/**
 * 取得所有已註冊接收告警的管理員 LINE userIds
 */
async function getAdminLineUserIds() {
    const snap = await db.collection('adminLineRecipients').get();
    return snap.docs.map(d => d.data().lineUserId).filter(Boolean);
}

/**
 * 推訊息給所有管理員 (用於系統告警)
 */
async function pushToAdmins(text, accessToken) {
    const adminIds = await getAdminLineUserIds();
    if (adminIds.length === 0) {
        logger.warn('[pushToAdmins] 無註冊管理員可推播', { text: text.substring(0, 50) });
        return;
    }
    const client = new line.messagingApi.MessagingApiClient({
        channelAccessToken: accessToken,
    });
    const results = await Promise.allSettled(
        adminIds.map(uid =>
            client.pushMessage({
                to: uid,
                messages: [{ type: 'text', text }],
            })
        )
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    logger.info(`[pushToAdmins] ✅ ${succeeded}/${adminIds.length} 推播成功`);
}

/**
 * 建立提醒用 Flex Message (黃色,30 分鐘前提醒)
 */
function createReminderFlexMessage(booking) {
    const periodsStr = formatPeriods(booking.periods);
    const startTime = PERIOD_START_TIMES[booking.periods[0]] || '?';
    return {
        type: 'flex',
        altText: `⏰ 30 分鐘後使用提醒: ${booking.room} ${booking.date}`,
        contents: {
            type: 'bubble',
            size: 'mega',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#f59e0b',
                paddingAll: '15px',
                contents: [{
                    type: 'text',
                    text: '⏰ 30 分鐘後使用提醒',
                    color: '#FFFFFF',
                    weight: 'bold',
                    size: 'lg',
                    align: 'center',
                }],
            },
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                paddingAll: '15px',
                contents: [
                    {
                        type: 'text',
                        text: `您 ${startTime} 起的預約即將開始,請準時前往。`,
                        size: 'sm',
                        color: '#92400e',
                        wrap: true,
                        weight: 'bold',
                    },
                    { type: 'separator', margin: 'md' },
                    {
                        type: 'box',
                        layout: 'baseline',
                        margin: 'md',
                        contents: [
                            { type: 'text', text: '📅', size: 'sm', flex: 0 },
                            { type: 'text', text: '日期', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: booking.date || '-', size: 'sm', flex: 5, weight: 'bold' },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '📍', size: 'sm', flex: 0 },
                            { type: 'text', text: '場地', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: booking.room || '禮堂', size: 'sm', flex: 5, weight: 'bold', wrap: true },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '⏰', size: 'sm', flex: 0 },
                            { type: 'text', text: '節次', size: 'sm', color: '#888888', flex: 2, margin: 'sm' },
                            { type: 'text', text: periodsStr, size: 'sm', flex: 5, weight: 'bold', wrap: true },
                        ],
                    },
                ],
            },
        },
    };
}

// ==========================================================================
// Function #7: scheduledReminder
// 每 5 分鐘掃一次,推送 30 分鐘後即將開始的預約
// 使用 sentReminders 去重避免重複推送
// ==========================================================================

exports.scheduledReminder = onSchedule(
    {
        schedule: 'every 5 minutes',
        timeZone: 'Asia/Taipei',
        secrets: [LINE_ACCESS_TOKEN],
        region: 'asia-east1',
    },
    async (event) => {
        const now = new Date();
        const targetMin = 30; // 30 分鐘後的預約

        // 抓今天 + 明天的預約 (跨午夜情境)
        const tw = new Date(now.getTime() + 8 * 3600 * 1000);
        const todayStr = `${tw.getUTCFullYear()}/${String(tw.getUTCMonth() + 1).padStart(2, '0')}/${String(tw.getUTCDate()).padStart(2, '0')}`;
        const tomorrow = new Date(tw.getTime() + 86400 * 1000);
        const tomorrowStr = `${tomorrow.getUTCFullYear()}/${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}/${String(tomorrow.getUTCDate()).padStart(2, '0')}`;

        const snapshot = await db.collection('bookings')
            .where('date', 'in', [todayStr, tomorrowStr])
            .get();

        let scanned = 0, sent = 0, skipped = 0;
        for (const doc of snapshot.docs) {
            const booking = doc.data();
            if (!booking.periods || booking.periods.length === 0) continue; // 已取消
            scanned += 1;

            // 取最早的節次當提醒時間
            const earliestPeriod = booking.periods[0];
            const periodStart = parsePeriodDateTime(booking.date, earliestPeriod);
            if (!periodStart) continue;

            const minsUntil = (periodStart.getTime() - now.getTime()) / 60000;

            // 在 27~33 分鐘窗口內 (避免精準度問題,涵蓋 5 分鐘 cron 變動)
            if (minsUntil < 27 || minsUntil > 33) continue;

            const reminderKey = `${doc.id}_30min`;
            const sentDoc = await db.collection('sentReminders').doc(reminderKey).get();
            if (sentDoc.exists) {
                skipped += 1;
                continue;
            }

            const lineUserId = await getBoundLineUserId(booking.deviceId);
            if (!lineUserId) continue;

            const flex = createReminderFlexMessage(booking);
            await pushFlexToUser(
                lineUserId,
                flex,
                LINE_ACCESS_TOKEN.value(),
                `30 分鐘提醒 ${booking.room} ${booking.date}`
            );

            // 記錄已推
            await db.collection('sentReminders').doc(reminderKey).set({
                bookingId: doc.id,
                type: '30min',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 86400 * 1000),
            });
            sent += 1;
        }

        logger.info(`[scheduledReminder] scanned=${scanned} sent=${sent} skipped=${skipped}`);
    }
);

// ==========================================================================
// Function #8: anomalyDetection
// 每 30 分鐘檢查異常活動,推告警給管理員
// ==========================================================================

exports.anomalyDetection = onSchedule(
    {
        schedule: 'every 30 minutes',
        timeZone: 'Asia/Taipei',
        secrets: [LINE_ACCESS_TOKEN],
        region: 'asia-east1',
    },
    async (event) => {
        const oneHourAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 3600 * 1000);

        // 檢查 #1: 過去 1 小時內 BATCH_CANCEL_BOOKINGS 次數
        try {
            const recentBatch = await db.collection('audit_logs')
                .where('action', '==', 'BATCH_CANCEL_BOOKINGS')
                .where('timestamp', '>=', oneHourAgo)
                .get();

            const batchCount = recentBatch.size;
            if (batchCount >= 10) {
                // 異常多 (1 小時內 ≥ 10 次批次取消)
                let totalAffected = 0;
                recentBatch.forEach(d => {
                    totalAffected += d.data().details?.successCount || 0;
                });
                await pushToAdmins(
                    `🚨 異常偵測 — 批次取消量\n\n` +
                    `過去 1 小時: ${batchCount} 次\n` +
                    `影響預約: ${totalAffected} 筆\n\n` +
                    `請檢查是否為惡意操作或正常清理。`,
                    LINE_ACCESS_TOKEN.value()
                );
            }
        } catch (e) {
            logger.error('[anomalyDetection] batch check failed', e);
        }

        // 檢查 #2: 過去 1 小時內 FORCE_DELETE_BOOKING 次數
        try {
            const recentForce = await db.collection('audit_logs')
                .where('action', '==', 'FORCE_DELETE_BOOKING')
                .where('timestamp', '>=', oneHourAgo)
                .get();

            if (recentForce.size >= 20) {
                await pushToAdmins(
                    `🚨 異常偵測 — 強制刪除量\n\n` +
                    `過去 1 小時: ${recentForce.size} 次強刪\n\n` +
                    `通常正常情況不會這麼多,請查 audit log。`,
                    LINE_ACCESS_TOKEN.value()
                );
            }
        } catch (e) {
            logger.error('[anomalyDetection] force_delete check failed', e);
        }

        // 檢查 #3: 過去 1 小時內 CREATE_BOOKING 量 (可能 Bot 攻擊)
        try {
            const recentCreate = await db.collection('audit_logs')
                .where('action', '==', 'CREATE_BOOKING')
                .where('timestamp', '>=', oneHourAgo)
                .get();

            // 校用日尖峰時間 (週一~五 7:00~16:00) 才合理會有大量預約
            const tw = new Date(Date.now() + 8 * 3600 * 1000);
            const hour = tw.getUTCHours();
            const day = tw.getUTCDay();
            const isOffPeak = day === 0 || day === 6 || hour < 7 || hour > 16;

            if (isOffPeak && recentCreate.size >= 30) {
                await pushToAdmins(
                    `🚨 異常偵測 — 非尖峰建立量\n\n` +
                    `過去 1 小時: ${recentCreate.size} 筆預約\n` +
                    `當前時間: ${tw.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}\n\n` +
                    `(非校時間段不應有此量,可能是 Bot)`,
                    LINE_ACCESS_TOKEN.value()
                );
            }
        } catch (e) {
            logger.error('[anomalyDetection] create check failed', e);
        }

        logger.info(`[anomalyDetection] ✅ checked at ${new Date().toISOString()}`);
    }
);

// ==========================================================================
// Function #9: subscribeAdminAlerts
// 管理員從前端註冊「我接收系統告警」(寫入 adminLineRecipients)
// 需要使用者已綁定 LINE
// ==========================================================================

exports.subscribeAdminAlerts = onRequest(
    {
        cors: true,
        secrets: [LINE_ACCESS_TOKEN],
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            const { deviceId, action } = req.body || {};
            if (!deviceId) {
                res.status(400).json({ error: 'deviceId required' });
                return;
            }

            // 從 lineBindings 找 lineUserId
            const bindingDoc = await db.collection('lineBindings').doc(deviceId).get();
            if (!bindingDoc.exists) {
                res.status(404).json({ error: '此裝置尚未綁定 LINE,請先完成綁定' });
                return;
            }
            const { lineUserId, lineDisplayName } = bindingDoc.data();

            if (action === 'unsubscribe') {
                await db.collection('adminLineRecipients').doc(lineUserId).delete();
                logger.info(`[adminAlerts] 取消訂閱: ${lineDisplayName}`);
                res.status(200).json({ status: 'unsubscribed' });
                return;
            }

            // 預設 = subscribe
            await db.collection('adminLineRecipients').doc(lineUserId).set({
                lineUserId,
                lineDisplayName: lineDisplayName || '未知',
                deviceId,
                subscribedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            // 推送確認訊息
            try {
                const client = new line.messagingApi.MessagingApiClient({
                    channelAccessToken: LINE_ACCESS_TOKEN.value(),
                });
                await client.pushMessage({
                    to: lineUserId,
                    messages: [{
                        type: 'text',
                        text: `✅ 已成功註冊接收系統告警!\n\n您將收到:\n` +
                              `• 系統錯誤即時告警\n` +
                              `• 異常活動偵測 (批次取消量暴增等)\n` +
                              `• 排程提醒執行報告 (有重要事件時)\n\n` +
                              `如要取消,可在系統內點「取消訂閱告警」。`,
                    }],
                });
            } catch (e) { /* silent */ }

            logger.info(`[adminAlerts] ✅ 訂閱: ${lineDisplayName}`);
            res.status(200).json({
                status: 'subscribed',
                lineDisplayName,
            });
        } catch (err) {
            logger.error('[subscribeAdminAlerts]', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// ==========================================================================
// Function #10: checkAdminAlertStatus
// 前端查詢當前裝置是否已訂閱告警
// ==========================================================================

exports.checkAdminAlertStatus = onRequest({ cors: true }, async (req, res) => {
    try {
        const deviceId = req.query.deviceId || (req.body && req.body.deviceId);
        if (!deviceId) {
            res.status(400).json({ error: 'deviceId required' });
            return;
        }

        const bindingDoc = await db.collection('lineBindings').doc(deviceId).get();
        if (!bindingDoc.exists) {
            res.status(200).json({ subscribed: false, bound: false });
            return;
        }

        const { lineUserId } = bindingDoc.data();
        const subDoc = await db.collection('adminLineRecipients').doc(lineUserId).get();
        res.status(200).json({
            subscribed: subDoc.exists,
            bound: true,
        });
    } catch (err) {
        logger.error('[checkAdminAlertStatus]', err);
        res.status(500).json({ error: err.message });
    }
});
