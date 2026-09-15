/**
 * LINE 綁定碼預填 UX 回歸測試
 *
 * QR 內容必須是 LINE 官方 oaMessage 連結，否則掃描後只會加好友，
 * 還是會把老師送回手動複製綁定碼的舊流程。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApp } from './app-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const { buildLinePrefillUrl, buildLineQrUrl } = loadApp();

describe('LINE 綁定碼自動帶入', () => {
    it('建立官方 oaMessage 預填連結', () => {
        expect(buildLinePrefillUrl('BKTML3')).toBe(
            'https://line.me/R/oaMessage/%40450qmudw/?BKTML3'
        );
    });

    it('綁定碼會去空白並統一大寫', () => {
        expect(buildLinePrefillUrl(' bktml3 ')).toBe(
            'https://line.me/R/oaMessage/%40450qmudw/?BKTML3'
        );
    });

    it('QR 內容是完整的預填連結', () => {
        const qrUrl = new URL(buildLineQrUrl('BKTML3'));
        expect(qrUrl.origin + qrUrl.pathname).toBe(
            'https://api.qrserver.com/v1/create-qr-code/'
        );
        expect(qrUrl.searchParams.get('data')).toBe(buildLinePrefillUrl('BKTML3'));
    });

    it('介面包含動態 QR 與手機預填按鈕', () => {
        expect(html).toContain('id=\"lineBindQrImg\"');
        expect(html).toContain('id=\"btnLineBindPrefill\"');
        expect(html).toContain('id=\"lineBindPrefillHint\"');
        expect(html).toContain('LINE oaMessage');
    });
});
