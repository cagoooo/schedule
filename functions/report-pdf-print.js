'use strict';

// 只替已通過管理員認證的 HTML 加入列印工具，不建立公開下載網址。
function withPdfPrintTools(html) {
    if (html.includes('id="report-pdf-tools"')) return html;
    const tools = `<aside id="report-pdf-tools" class="no-print" aria-label="報告匯出">
        <button type="button" onclick="window.print()">列印／儲存為 PDF</button>
        <p>請在列印視窗選擇「另存為 PDF」。圖表載入完成後再儲存；下載檔請妥善保管。</p>
    </aside>`;
    const styles = `<style id="report-pdf-style">
        #report-pdf-tools { max-width:960px; margin:16px auto 0; padding:12px 24px; font:14px/1.6 sans-serif; }
        #report-pdf-tools button { background:#6d28d9; color:white; border:0; border-radius:8px; padding:12px 18px; font:inherit; font-weight:700; cursor:pointer; }
        #report-pdf-tools p { margin-top:8px; color:#475569; }
        @media print {
            @page { size:A4; margin:14mm 12mm 16mm; }
            html, body { margin:0 !important; padding:0 !important; background:white !important; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
            .no-print { display:none !important; }
            .container { width:100%; max-width:100%; margin:0; padding:0; }
            .cover { padding:18px; break-inside:avoid; }
            .cover h1 { font-size:24pt; }
            .section { padding:16px; box-shadow:none; page-break-inside:auto; break-inside:auto; }
            h1, h2, h3 { break-after:avoid; }
            .chart-grid { grid-template-columns:minmax(0,1fr); gap:12px; }
            .chart-container { height:280px; max-width:100%; break-inside:avoid; }
            .stat-card, tr { break-inside:avoid; }
            thead { display:table-header-group; }
            p, li { orphans:3; widows:3; }
        }
    </style>`;
    return html.replace('</head>', `${styles}</head>`).replace(/<body\b[^>]*>/i, match => `${match}${tools}`);
}

module.exports = { withPdfPrintTools };
