/**
 * Cloud Functions for 禮堂&專科教室預約系統
 * Phase 1 (v2.44.0): LINE 綁定基礎建設
 * Phase 2 (v2.45.0): 預約事件推播 (建立/取消/強刪)
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
