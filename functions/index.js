/**
 * Cloud Functions for 禮堂&專科教室預約系統
 * Phase 1 (v2.44.0): LINE 綁定基礎建設
 * Phase 2 (v2.45.0): 預約事件推播 (建立/取消/強刪)
 * Phase 3 (v2.46.0): 排程提醒 + 管理員告警 (取代 Sentry)
 * v2.48.0: AI 學期白皮書 (Gemini + HTML 報告 + Storage)
 *
 * 安全提醒:
 * - LINE Channel Secret / Access Token / GEMINI_API_KEY 透過 Firebase Functions Secrets 注入
 * - 永遠不在此檔案 hardcode 任何 secrets
 * - 設定方式 (用 printf 不加換行):
 *     printf "..." | firebase functions:secrets:set LINE_CHANNEL_SECRET --data-file -
 *     printf "..." | firebase functions:secrets:set LINE_ACCESS_TOKEN --data-file -
 *     printf "..." | firebase functions:secrets:set GEMINI_API_KEY --data-file -
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
// v2.48.0: 顯式指定 storageBucket (新版 Firebase 預設 bucket 為 .firebasestorage.app)
admin.initializeApp({
    storageBucket: 'schedule-10ed3.firebasestorage.app',
});
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
// v2.48.0: Gemini API Key (用於 AI 學期白皮書文案撰寫)
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

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

// ==========================================================================
// Function #11: submitFeedback
// 老師意見回饋 → 寫入 Firestore + 推送 LINE 給訂閱告警的管理員
// ==========================================================================

const FEEDBACK_TYPE_META = {
    bug:         { label: '🐛 錯誤回報', color: '#dc2626' },
    suggestion:  { label: '💡 功能建議', color: '#06c755' },
    question:    { label: '❓ 使用問題', color: '#3b82f6' },
    other:       { label: '📝 其他',     color: '#6b7280' },
};

/**
 * 建立意見回饋的 Flex Message (送給管理員)
 */
function createFeedbackFlexMessage(feedback) {
    const meta = FEEDBACK_TYPE_META[feedback.type] || FEEDBACK_TYPE_META.other;
    const tw = new Date(Date.now() + 8 * 3600 * 1000);
    const timeStr = `${tw.getUTCFullYear()}/${String(tw.getUTCMonth() + 1).padStart(2, '0')}/${String(tw.getUTCDate()).padStart(2, '0')} ${String(tw.getUTCHours()).padStart(2, '0')}:${String(tw.getUTCMinutes()).padStart(2, '0')}`;

    return {
        type: 'flex',
        altText: `📮 新意見回饋 [${meta.label}] from ${feedback.name || '匿名'}`,
        contents: {
            type: 'bubble',
            size: 'mega',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: meta.color,
                paddingAll: '15px',
                contents: [{
                    type: 'text',
                    text: '📮 新意見回饋',
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
                            { type: 'text', text: '類型', size: 'xs', color: '#888888', flex: 2 },
                            { type: 'text', text: meta.label, size: 'sm', flex: 5, weight: 'bold' },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '姓名', size: 'xs', color: '#888888', flex: 2 },
                            { type: 'text', text: feedback.name || '匿名老師', size: 'sm', flex: 5, weight: 'bold' },
                        ],
                    },
                    {
                        type: 'box',
                        layout: 'baseline',
                        contents: [
                            { type: 'text', text: '時間', size: 'xs', color: '#888888', flex: 2 },
                            { type: 'text', text: timeStr, size: 'sm', flex: 5 },
                        ],
                    },
                    { type: 'separator', margin: 'md' },
                    {
                        type: 'box',
                        layout: 'vertical',
                        margin: 'md',
                        contents: [
                            { type: 'text', text: '📝 內容', size: 'xs', color: '#888888' },
                            {
                                type: 'text',
                                text: feedback.message || '(無內容)',
                                size: 'sm',
                                wrap: true,
                                margin: 'sm',
                                color: '#1f2937',
                            },
                        ],
                    },
                    {
                        type: 'text',
                        text: `📱 來源: ${(feedback.deviceId || 'unknown').substring(0, 16)}...`,
                        size: 'xs',
                        color: '#94a3b8',
                        margin: 'md',
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
                    color: meta.color,
                    height: 'sm',
                    action: {
                        type: 'uri',
                        label: '🔗 開啟系統',
                        uri: APP_URL,
                    },
                }],
            },
        },
    };
}

exports.submitFeedback = onRequest(
    {
        cors: true,
        secrets: [LINE_ACCESS_TOKEN],
        region: 'asia-east1',
    },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        try {
            const { type, name, message, deviceId } = req.body || {};

            // 驗證輸入
            if (!message || typeof message !== 'string' || message.trim().length === 0) {
                res.status(400).json({ error: '請填寫回饋內容' });
                return;
            }
            if (message.length > 1000) {
                res.status(400).json({ error: '回饋內容過長 (上限 1000 字)' });
                return;
            }
            if (!deviceId || typeof deviceId !== 'string') {
                res.status(400).json({ error: 'deviceId required' });
                return;
            }
            const validType = ['bug', 'suggestion', 'question', 'other'].includes(type) ? type : 'other';

            // 防灌水: 同 deviceId 1 分鐘內最多 1 筆
            // 用 try/catch 包覆,即使索引在建置中或 query 出錯也不阻擋回饋送出
            try {
                const oneMinAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 1000);
                const recent = await db.collection('feedbacks')
                    .where('deviceId', '==', deviceId)
                    .where('createdAt', '>=', oneMinAgo)
                    .limit(1)
                    .get();

                if (!recent.empty) {
                    res.status(429).json({
                        error: '請等 1 分鐘後再送出下一則回饋 (避免重複)',
                    });
                    return;
                }
            } catch (queryErr) {
                // 通常是索引還在建置 (FAILED_PRECONDITION),不影響核心功能
                logger.warn('[submitFeedback] 防灌水 query 失敗 (可能索引建置中),跳過檢查', queryErr.code);
            }

            // 建立 feedback 紀錄
            const feedback = {
                type: validType,
                name: (name || '').toString().trim().substring(0, 50) || null,
                message: message.trim(),
                deviceId,
                userAgent: (req.headers['user-agent'] || '').substring(0, 200),
                status: 'new', // new / read / resolved
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            const docRef = await db.collection('feedbacks').add(feedback);

            // 推給管理員
            const flex = createFeedbackFlexMessage({ ...feedback, id: docRef.id });
            const adminIds = await getAdminLineUserIds();

            if (adminIds.length === 0) {
                logger.warn('[submitFeedback] 已收到回饋但無註冊管理員,只存 Firestore');
            } else {
                const client = new line.messagingApi.MessagingApiClient({
                    channelAccessToken: LINE_ACCESS_TOKEN.value(),
                });
                await Promise.allSettled(
                    adminIds.map(uid =>
                        client.pushMessage({ to: uid, messages: [flex] })
                    )
                );
                logger.info(`[submitFeedback] ✅ 已推給 ${adminIds.length} 位管理員`);
            }

            res.status(200).json({
                status: 'ok',
                feedbackId: docRef.id,
                pushedToAdmins: adminIds.length,
            });
        } catch (err) {
            logger.error('[submitFeedback]', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// ==========================================================================
// v2.48.0: AI 學期白皮書 (Gemini + HTML 報告)
// ==========================================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * 自動偵測學期區間
 * 春季學期: 2/1 ~ 6/30
 * 秋季學期: 8/1 ~ 1/31 (跨年)
 * @returns { name, startDate, endDate } (YYYY/MM/DD 格式)
 */
function detectSemester(refDate) {
    const d = refDate || new Date();
    const tw = new Date(d.getTime() + 8 * 3600 * 1000);
    const year = tw.getUTCFullYear();
    const month = tw.getUTCMonth() + 1;

    if (month >= 2 && month <= 7) {
        // 春季學期
        return {
            name: `${year} 春季學期`,
            startDate: `${year}/02/01`,
            endDate: `${year}/06/30`,
        };
    }
    // 秋季學期 (8月~隔年1月)
    if (month >= 8) {
        return {
            name: `${year} 秋季學期`,
            startDate: `${year}/08/01`,
            endDate: `${year + 1}/01/31`,
        };
    }
    // 1 月 = 上一年的秋季學期
    return {
        name: `${year - 1} 秋季學期`,
        startDate: `${year - 1}/08/01`,
        endDate: `${year}/01/31`,
    };
}

/**
 * 聚合該學期的所有預約統計
 */
async function aggregateSemesterStats(startDate, endDate) {
    const snap = await db.collection('bookings')
        .where('date', '>=', startDate)
        .where('date', '<=', endDate)
        .get();

    const stats = {
        totalBookings: 0,
        totalActive: 0,
        totalCancelled: 0,
        byClassroom: {},
        byPeriod: {},
        byWeekday: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        topUsers: {},
        ipadByGrade: { '三年級': 0, '四年級': 0, '五年級': 0, '六年級': 0 },
        leadTimeDistribution: { '當天': 0, '1-3 天': 0, '4-7 天': 0, '8-30 天': 0, '> 30 天': 0 },
    };

    snap.forEach(doc => {
        const b = doc.data();
        const isActive = b.periods && b.periods.length > 0;
        stats.totalBookings += 1;
        if (isActive) stats.totalActive += 1;
        else stats.totalCancelled += 1;

        if (!isActive) return; // 取消的預約不算入熱度統計

        // 場地統計
        const room = b.room || '禮堂';
        stats.byClassroom[room] = (stats.byClassroom[room] || 0) + 1;

        // 節次統計
        b.periods.forEach(p => {
            stats.byPeriod[p] = (stats.byPeriod[p] || 0) + 1;
        });

        // 週幾統計 (date 是 YYYY/MM/DD)
        const dateParts = b.date.split('/');
        if (dateParts.length === 3) {
            const dateObj = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
            stats.byWeekday[dateObj.getDay()] += 1;

            // 提前天數
            if (b.createdAt) {
                const createdMs = b.createdAt.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt).getTime();
                const targetMs = dateObj.getTime();
                const diffDays = Math.floor((targetMs - createdMs) / (86400 * 1000));
                if (diffDays === 0) stats.leadTimeDistribution['當天'] += 1;
                else if (diffDays <= 3) stats.leadTimeDistribution['1-3 天'] += 1;
                else if (diffDays <= 7) stats.leadTimeDistribution['4-7 天'] += 1;
                else if (diffDays <= 30) stats.leadTimeDistribution['8-30 天'] += 1;
                else stats.leadTimeDistribution['> 30 天'] += 1;
            }
        }

        // Top users
        const booker = b.booker || '未知';
        stats.topUsers[booker] = (stats.topUsers[booker] || 0) + 1;

        // IPAD 各年級借用
        ['三年級', '四年級', '五年級', '六年級'].forEach(grade => {
            if (room.includes(grade)) {
                stats.ipadByGrade[grade] += 1;
            }
        });
    });

    // 計算取消率
    stats.cancellationRate = stats.totalBookings > 0
        ? (stats.totalCancelled / stats.totalBookings * 100).toFixed(1)
        : 0;

    // Top 10 老師
    stats.topUsersList = Object.entries(stats.topUsers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count }));

    // 場地排行
    stats.classroomRanking = Object.entries(stats.byClassroom)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

    return stats;
}

/**
 * 用 Gemini API 撰寫 4 段繁中分析文案
 */
async function narrateStatsWithGemini(stats, semesterName, apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
        },
    });

    const prompt = `你是一位資深教育行政專家,根據以下「${semesterName}」學校場地預約系統統計資料,撰寫 4 段繁體中文分析報告。

統計資料 (JSON):
${JSON.stringify({
        總預約: stats.totalBookings,
        有效預約: stats.totalActive,
        取消預約: stats.totalCancelled,
        取消率: stats.cancellationRate + '%',
        場地排行: stats.classroomRanking,
        節次熱度: stats.byPeriod,
        週幾分布: stats.byWeekday,
        老師排行Top10: stats.topUsersList,
        IPAD各年級: stats.ipadByGrade,
        提前天數分布: stats.leadTimeDistribution,
    }, null, 2)}

請以 JSON 格式回傳:
{
  "summary": "整體摘要,150 字內,點出本學期最重要的 3 個發現",
  "hotspots": "場地使用熱點分析,150 字內,提到使用率最高與最低的場地及推測原因",
  "anomalies": "異常與取消模式分析,150 字內,點出取消率高的場地或時段並推測原因",
  "suggestions": "下學期改善建議,150 字內,提供 2-3 個具體可執行的建議"
}

語氣專業但親切,適合校長/主任閱讀。直接回傳 JSON,不要額外文字。`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return JSON.parse(text);
    } catch (err) {
        logger.error('[Gemini] 文案生成失敗', err);
        // Fallback 文案
        return {
            summary: `本學期共有 ${stats.totalBookings} 筆預約紀錄,有效 ${stats.totalActive} 筆,取消率 ${stats.cancellationRate}%。`,
            hotspots: stats.classroomRanking.length > 0
                ? `最熱門場地為「${stats.classroomRanking[0].name}」共 ${stats.classroomRanking[0].count} 次預約。`
                : '本學期無有效預約資料。',
            anomalies: stats.cancellationRate > 20
                ? `取消率達 ${stats.cancellationRate}% 偏高,建議檢視可能原因。`
                : '取消率在合理範圍內。',
            suggestions: '建議持續監測使用情況,並於下學期初檢討場地配置。',
        };
    }
}

/**
 * 渲染 HTML 報告
 */
function renderReportHTML(stats, narrative, semesterName, generatedAt) {
    const periodNames = {
        morning: '晨間/早會',
        period1: '第一節', period2: '第二節', period3: '第三節', period4: '第四節',
        lunch: '午餐/午休',
        period5: '第五節', period6: '第六節', period7: '第七節', period8: '第八節',
    };
    const weekdayNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

    const periodLabels = Object.keys(stats.byPeriod).map(p => periodNames[p] || p);
    const periodValues = Object.values(stats.byPeriod);

    const weekdayLabels = weekdayNames;
    const weekdayValues = [0, 1, 2, 3, 4, 5, 6].map(d => stats.byWeekday[d] || 0);

    const classroomLabels = stats.classroomRanking.map(r => r.name);
    const classroomValues = stats.classroomRanking.map(r => r.count);

    const ipadLabels = Object.keys(stats.ipadByGrade);
    const ipadValues = Object.values(stats.ipadByGrade);

    const leadLabels = Object.keys(stats.leadTimeDistribution);
    const leadValues = Object.values(stats.leadTimeDistribution);

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${semesterName} 場地預約使用報告</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Noto Sans TC', -apple-system, sans-serif;
        background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
        color: #1f2937;
        line-height: 1.7;
        min-height: 100vh;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; }
    .cover {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white; border-radius: 20px; padding: 3rem 2rem;
        text-align: center; margin-bottom: 2rem;
        box-shadow: 0 10px 40px rgba(102, 126, 234, 0.3);
    }
    .cover h1 { font-size: 2.5rem; font-weight: 900; margin-bottom: 0.5rem; }
    .cover .subtitle { font-size: 1.1rem; opacity: 0.95; margin-bottom: 1.5rem; }
    .cover .meta { font-size: 0.9rem; opacity: 0.85; }
    .ai-badge {
        display: inline-block; background: rgba(255,255,255,0.2);
        padding: 0.4rem 1rem; border-radius: 999px; margin-top: 1rem;
        font-weight: 600; font-size: 0.85rem;
    }

    .section {
        background: white; border-radius: 16px; padding: 2rem;
        margin-bottom: 1.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05);
    }
    .section h2 {
        color: #4c1d95; font-size: 1.5rem; margin-bottom: 1rem;
        padding-bottom: 0.75rem; border-bottom: 3px solid #ede9fe;
        display: flex; align-items: center; gap: 0.5rem;
    }
    .section .narrative {
        background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
        padding: 1rem 1.25rem; border-left: 4px solid #f59e0b;
        border-radius: 8px; margin-bottom: 1.5rem; color: #78350f;
        font-size: 0.95rem;
    }
    .ai-narration-label {
        display: inline-block; background: rgba(245, 158, 11, 0.2);
        padding: 2px 10px; border-radius: 999px; font-size: 0.75rem;
        font-weight: 700; color: #92400e; margin-bottom: 0.5rem;
    }

    .stats-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem; margin-bottom: 1.5rem;
    }
    .stat-card {
        background: linear-gradient(135deg, #ede9fe 0%, #fce7f3 100%);
        padding: 1.25rem; border-radius: 12px; text-align: center;
    }
    .stat-card .num {
        font-size: 2.2rem; font-weight: 900; color: #6d28d9;
        font-family: 'Noto Sans TC', sans-serif;
    }
    .stat-card .label { color: #6b7280; font-size: 0.85rem; margin-top: 0.25rem; }

    .chart-container {
        position: relative; height: 320px; margin-top: 1rem;
        background: white; padding: 1rem; border-radius: 8px;
    }
    .chart-grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
        gap: 1.5rem;
    }

    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th { text-align: left; padding: 0.75rem; background: #ede9fe; color: #4c1d95; font-size: 0.9rem; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #f3f4f6; font-size: 0.9rem; }
    tr:hover td { background: #fafafa; }
    .rank-badge {
        display: inline-block; min-width: 32px; height: 24px; line-height: 24px;
        background: #6d28d9; color: white; border-radius: 999px;
        text-align: center; font-weight: 700; font-size: 0.8rem;
    }
    .rank-badge.gold { background: #f59e0b; }
    .rank-badge.silver { background: #94a3b8; }
    .rank-badge.bronze { background: #b45309; }

    footer {
        text-align: center; color: #94a3b8; font-size: 0.85rem;
        padding: 2rem 0; border-top: 1px solid #e5e7eb; margin-top: 2rem;
    }
    @media print {
        body { background: white; }
        .section { box-shadow: none; border: 1px solid #e5e7eb; page-break-inside: avoid; }
        .cover { box-shadow: none; }
    }
    @media (max-width: 600px) {
        .container { padding: 1rem; }
        .cover h1 { font-size: 1.8rem; }
        .chart-container { height: 260px; }
    }
</style>
</head>
<body>
    <div class="container">
        <div class="cover">
            <h1>📊 ${semesterName}</h1>
            <div class="subtitle">場地預約使用報告</div>
            <div class="meta">${generatedAt}</div>
            <div class="ai-badge">🤖 由 Gemini AI 智慧分析撰寫</div>
        </div>

        <div class="section">
            <h2>📌 整體摘要</h2>
            <div class="narrative">
                <span class="ai-narration-label">🤖 AI 分析</span><br>
                ${narrative.summary}
            </div>
            <div class="stats-grid">
                <div class="stat-card"><div class="num">${stats.totalBookings}</div><div class="label">總預約筆數</div></div>
                <div class="stat-card"><div class="num">${stats.totalActive}</div><div class="label">有效預約</div></div>
                <div class="stat-card"><div class="num">${stats.totalCancelled}</div><div class="label">已取消</div></div>
                <div class="stat-card"><div class="num">${stats.cancellationRate}%</div><div class="label">取消率</div></div>
            </div>
        </div>

        <div class="section">
            <h2>🏆 場地使用排行</h2>
            <div class="narrative">
                <span class="ai-narration-label">🤖 AI 分析</span><br>
                ${narrative.hotspots}
            </div>
            <div class="chart-grid">
                <div>
                    <h3 style="font-size:1rem;margin-bottom:0.5rem;color:#6b7280;">場地預約量分布</h3>
                    <div class="chart-container"><canvas id="classroomChart"></canvas></div>
                </div>
                <div>
                    <h3 style="font-size:1rem;margin-bottom:0.5rem;color:#6b7280;">節次使用熱度</h3>
                    <div class="chart-container"><canvas id="periodChart"></canvas></div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>📅 時間分布分析</h2>
            <div class="chart-grid">
                <div>
                    <h3 style="font-size:1rem;margin-bottom:0.5rem;color:#6b7280;">週間預約分布</h3>
                    <div class="chart-container"><canvas id="weekdayChart"></canvas></div>
                </div>
                <div>
                    <h3 style="font-size:1rem;margin-bottom:0.5rem;color:#6b7280;">提前預約天數分布</h3>
                    <div class="chart-container"><canvas id="leadTimeChart"></canvas></div>
                </div>
            </div>
        </div>

        <div class="section">
            <h2>👥 老師預約 Top 10</h2>
            ${stats.topUsersList.length > 0 ? `
            <table>
                <thead><tr><th style="width:80px;">排名</th><th>姓名</th><th style="text-align:right;">預約次數</th></tr></thead>
                <tbody>
                    ${stats.topUsersList.map((u, i) => {
                        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
                        return `<tr><td><span class="rank-badge ${rankClass}">${i + 1}</span></td><td><strong>${u.name}</strong></td><td style="text-align:right;font-weight:700;color:#6d28d9;">${u.count}</td></tr>`;
                    }).join('')}
                </tbody>
            </table>` : '<p style="color:#94a3b8;">本學期尚無預約紀錄</p>'}
        </div>

        ${Object.values(stats.ipadByGrade).some(v => v > 0) ? `
        <div class="section">
            <h2>📱 IPAD 平板車各年級借用</h2>
            <div class="chart-container" style="max-width:500px;margin:0 auto;"><canvas id="ipadChart"></canvas></div>
        </div>` : ''}

        <div class="section">
            <h2>⚠ 異常與取消分析</h2>
            <div class="narrative">
                <span class="ai-narration-label">🤖 AI 分析</span><br>
                ${narrative.anomalies}
            </div>
        </div>

        <div class="section">
            <h2>💡 下學期改善建議</h2>
            <div class="narrative">
                <span class="ai-narration-label">🤖 AI 分析</span><br>
                ${narrative.suggestions}
            </div>
        </div>

        <footer>
            🏫 禮堂&專科教室&IPAD平板車預約系統 — AI 學期白皮書<br>
            生成時間: ${generatedAt} · 報告版本: v2.48.0
        </footer>
    </div>

<script>
const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { family: "'Noto Sans TC',sans-serif" }}}}
};
const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#06b6d4','#10b981','#f43f5e','#84cc16','#a78bfa','#fb7185'];

// 場地排行 (橫向長條)
new Chart(document.getElementById('classroomChart'), {
    type: 'bar',
    data: {
        labels: ${JSON.stringify(classroomLabels)},
        datasets: [{
            data: ${JSON.stringify(classroomValues)},
            backgroundColor: colors,
        }]
    },
    options: { ...chartOpts, indexAxis: 'y', plugins: { legend: { display: false }}}
});

// 節次熱度
new Chart(document.getElementById('periodChart'), {
    type: 'bar',
    data: {
        labels: ${JSON.stringify(periodLabels)},
        datasets: [{
            data: ${JSON.stringify(periodValues)},
            backgroundColor: '#8b5cf6',
            borderRadius: 8,
        }]
    },
    options: { ...chartOpts, plugins: { legend: { display: false }}}
});

// 週幾分布
new Chart(document.getElementById('weekdayChart'), {
    type: 'bar',
    data: {
        labels: ${JSON.stringify(weekdayLabels)},
        datasets: [{
            data: ${JSON.stringify(weekdayValues)},
            backgroundColor: ${JSON.stringify(weekdayValues.map((_, i) => i === 0 || i === 6 ? '#ef4444' : '#6366f1'))},
            borderRadius: 8,
        }]
    },
    options: { ...chartOpts, plugins: { legend: { display: false }}}
});

// 提前天數
new Chart(document.getElementById('leadTimeChart'), {
    type: 'doughnut',
    data: {
        labels: ${JSON.stringify(leadLabels)},
        datasets: [{ data: ${JSON.stringify(leadValues)}, backgroundColor: colors }]
    },
    options: chartOpts
});

${Object.values(stats.ipadByGrade).some(v => v > 0) ? `
// IPAD 各年級
new Chart(document.getElementById('ipadChart'), {
    type: 'doughnut',
    data: {
        labels: ${JSON.stringify(ipadLabels)},
        datasets: [{ data: ${JSON.stringify(ipadValues)}, backgroundColor: ['#6366f1','#8b5cf6','#ec4899','#f59e0b'] }]
    },
    options: chartOpts
});
` : ''}
</script>
</body>
</html>`;
}

// ==========================================================================
// Function #12: generateSemesterReport
// 產出 AI 學期白皮書,儲存到 Firebase Storage,推 LINE 給管理員
// ==========================================================================

exports.generateSemesterReport = onRequest(
    {
        cors: true,
        secrets: [LINE_ACCESS_TOKEN, GEMINI_API_KEY],
        region: 'asia-east1',
        timeoutSeconds: 300, // 5 分鐘 (Gemini call 可能慢)
        memory: '512MiB',
    },
    async (req, res) => {
        try {
            // 取得參數 (可指定學期,或自動偵測當前學期)
            const { startDate: customStart, endDate: customEnd } = req.body || {};
            let semesterName, startDate, endDate;
            if (customStart && customEnd) {
                semesterName = `自訂期間 (${customStart} ~ ${customEnd})`;
                startDate = customStart;
                endDate = customEnd;
            } else {
                const sem = detectSemester();
                semesterName = sem.name;
                startDate = sem.startDate;
                endDate = sem.endDate;
            }

            logger.info(`[Report] 開始產出 ${semesterName} (${startDate} ~ ${endDate})`);

            // 1. 聚合統計
            const stats = await aggregateSemesterStats(startDate, endDate);
            logger.info(`[Report] 統計完成: ${stats.totalBookings} 筆預約`);

            // 2. Gemini 撰寫文案
            let narrative;
            try {
                narrative = await narrateStatsWithGemini(stats, semesterName, GEMINI_API_KEY.value());
                logger.info('[Report] Gemini 文案生成成功');
            } catch (e) {
                logger.error('[Report] Gemini 失敗,使用預設文案', e);
                narrative = {
                    summary: `本學期共有 ${stats.totalBookings} 筆預約紀錄。`,
                    hotspots: '見下方圖表分析。',
                    anomalies: '取消率 ' + stats.cancellationRate + '%。',
                    suggestions: '請參考圖表自行判斷。',
                };
            }

            // 3. 渲染 HTML
            const tw = new Date(Date.now() + 8 * 3600 * 1000);
            const generatedAt = `${tw.getUTCFullYear()}/${String(tw.getUTCMonth() + 1).padStart(2, '0')}/${String(tw.getUTCDate()).padStart(2, '0')} ${String(tw.getUTCHours()).padStart(2, '0')}:${String(tw.getUTCMinutes()).padStart(2, '0')}`;
            const html = renderReportHTML(stats, narrative, semesterName, generatedAt);

            // 4. 上傳到 Firebase Storage (公開讀取)
            const fileName = `reports/${Date.now()}_${semesterName.replace(/\s+/g, '_')}.html`;
            const bucket = admin.storage().bucket();
            const file = bucket.file(fileName);
            await file.save(html, {
                metadata: {
                    contentType: 'text/html; charset=utf-8',
                    cacheControl: 'public, max-age=86400',
                },
            });
            await file.makePublic();
            // 注意：fileName 含中文字 (如「春季學期」) 必須 URL-encode 才能透過 https 存取
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName.split('/').map(encodeURIComponent).join('/')}`;

            // 5. 寫入 Firestore (報告紀錄)
            const reportDoc = await db.collection('semesterReports').add({
                semesterName,
                startDate,
                endDate,
                fileName,
                publicUrl,
                stats: {
                    totalBookings: stats.totalBookings,
                    totalActive: stats.totalActive,
                    cancellationRate: stats.cancellationRate,
                    topRoom: stats.classroomRanking[0]?.name || '無',
                    topUser: stats.topUsersList[0]?.name || '無',
                },
                generatedAt: admin.firestore.FieldValue.serverTimestamp(),
                generatedBy: req.body?.deviceId || 'system',
            });

            // 6. 推 LINE 給所有管理員
            const adminIds = await getAdminLineUserIds();
            if (adminIds.length > 0) {
                const client = new line.messagingApi.MessagingApiClient({
                    channelAccessToken: LINE_ACCESS_TOKEN.value(),
                });
                const flex = {
                    type: 'flex',
                    altText: `📄 ${semesterName} 學期報告已產出`,
                    contents: {
                        type: 'bubble',
                        size: 'mega',
                        header: {
                            type: 'box', layout: 'vertical',
                            backgroundColor: '#6d28d9', paddingAll: '15px',
                            contents: [{
                                type: 'text', text: '📊 AI 學期報告產出完成',
                                color: '#FFFFFF', weight: 'bold', size: 'lg', align: 'center',
                            }],
                        },
                        body: {
                            type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '15px',
                            contents: [
                                { type: 'text', text: semesterName, weight: 'bold', size: 'md', color: '#4c1d95' },
                                { type: 'separator', margin: 'md' },
                                { type: 'box', layout: 'baseline', margin: 'md', contents: [
                                    { type: 'text', text: '📅 期間', size: 'xs', color: '#888', flex: 2 },
                                    { type: 'text', text: `${startDate} ~ ${endDate}`, size: 'sm', flex: 5, weight: 'bold' },
                                ]},
                                { type: 'box', layout: 'baseline', contents: [
                                    { type: 'text', text: '📊 總筆數', size: 'xs', color: '#888', flex: 2 },
                                    { type: 'text', text: `${stats.totalBookings} 筆 (取消率 ${stats.cancellationRate}%)`, size: 'sm', flex: 5, weight: 'bold' },
                                ]},
                                { type: 'box', layout: 'baseline', contents: [
                                    { type: 'text', text: '🏆 熱門場地', size: 'xs', color: '#888', flex: 2 },
                                    { type: 'text', text: stats.classroomRanking[0]?.name || '-', size: 'sm', flex: 5, weight: 'bold', wrap: true },
                                ]},
                            ],
                        },
                        footer: {
                            type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '10px',
                            contents: [{
                                type: 'button', style: 'primary', color: '#6d28d9', height: 'sm',
                                action: { type: 'uri', label: '📄 查看完整報告', uri: publicUrl },
                            }],
                        },
                    },
                };
                await Promise.allSettled(
                    adminIds.map(uid => client.pushMessage({ to: uid, messages: [flex] }))
                );
                logger.info(`[Report] ✅ 已推送給 ${adminIds.length} 位管理員`);
            }

            res.status(200).json({
                status: 'ok',
                reportId: reportDoc.id,
                semesterName,
                publicUrl,
                stats: {
                    totalBookings: stats.totalBookings,
                    cancellationRate: stats.cancellationRate,
                },
            });
        } catch (err) {
            logger.error('[generateSemesterReport]', err);
            res.status(500).json({ error: err.message });
        }
    }
);

// ==========================================================================
// Function #13: listSemesterReports
// 取得歷史報告清單 (供前端顯示)
// ==========================================================================

exports.listSemesterReports = onRequest({ cors: true }, async (req, res) => {
    try {
        const snap = await db.collection('semesterReports')
            .orderBy('generatedAt', 'desc')
            .limit(20)
            .get();
        const reports = snap.docs.map(d => {
            const data = d.data();
            return {
                id: d.id,
                semesterName: data.semesterName,
                startDate: data.startDate,
                endDate: data.endDate,
                publicUrl: data.publicUrl,
                stats: data.stats,
                generatedAt: data.generatedAt?.toMillis?.() || 0,
            };
        });
        res.status(200).json({ reports });
    } catch (err) {
        logger.error('[listSemesterReports]', err);
        res.status(500).json({ error: err.message });
    }
});
