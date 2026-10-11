const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPdfPrintTools } = require('../functions/report-pdf-print');

test('新舊報告均加入原生 PDF 儲存工具，不改動原內容', () => {
    const original = '<html><head><title>學期報告</title></head><body class="report"><canvas></canvas><p>匿名摘要</p></body></html>';
    const result = withPdfPrintTools(original);
    assert.match(result, /onclick="window\.print\(\)"/);
    assert.match(result, /另存為 PDF/);
    assert.match(result, /<body class="report"><aside/);
    assert.match(result, /<canvas><\/canvas><p>匿名摘要<\/p>/);
    assert.match(result, /@page \{ size:A4/);
    assert.match(result, /\.no-print \{ display:none !important/);
    assert.match(result, /page-break-inside:auto/);
});

test('重複處理不新增多組工具', () => {
    const first = withPdfPrintTools('<html><head></head><body></body></html>');
    assert.equal(withPdfPrintTools(first), first);
});

test('匯出仍走既有管理員認證，沒有公開 endpoint 或新增依賴', () => {
    const source = fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8');
    const handler = source.slice(source.indexOf('exports.getSemesterReport ='), source.indexOf('exports.listSemesterReports ='));
    assert.ok(handler.indexOf('requireReportAdmin(req, res)') < handler.indexOf('withPdfPrintTools(content'));
    assert.ok(handler.indexOf('requireReportAdmin(req, res)') >= 0);
    assert.doesNotMatch(handler, /makePublic|signedUrl|downloadToken/i);
});
