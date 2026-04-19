/**
 * Cloud Functions for 禮堂&專科教室預約系統
 * Phase 1 (v2.44.0): LINE 綁定基礎建設
 *
 * 安全提醒:
 * - LINE Channel Secret / Access Token 透過 Firebase Functions Secrets 注入
 * - 永遠不在此檔案 hardcode 任何 secrets
 * - 設定方式:
 *     firebase functions:secrets:set LINE_CHANNEL_SECRET
 *     firebase functions:secrets:set LINE_ACCESS_TOKEN
 */

const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const line = require('@line/bot-sdk');

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

        // 1. 驗證 LINE 簽章 (確保訊息真的來自 LINE)
        const body = JSON.stringify(req.body);
        if (!line.validateSignature(body, channelSecret, signature)) {
            logger.warn('[Webhook] Invalid signature');
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
