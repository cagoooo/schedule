'use strict';

// 僅允許彙總數據進入生成式 AI；不傳送姓名、原因、裝置 ID 或逐筆紀錄。
function anonymousReportStats(stats) {
    const counts = (input, keys) => Object.fromEntries(keys.map(key => [key, Number(input?.[key] || 0)]));
    const rooms = new Set(['禮堂', '電腦教室(一)C212', '電腦教室(二)C213', '五年級IPAD車(28台)', '智慧教室C304', '森林小屋', '三年級IPAD車(28台)', '四年級IPAD車(28台)', '六年級IPAD車(29台)', '校史室']);
    const totals = {};
    for (const row of stats.classroomRanking || []) {
        const name = rooms.has(row.name) ? row.name : '其他場地';
        totals[name] = (totals[name] || 0) + Number(row.count || 0);
    }
    return {
        totalBookings: stats.totalBookings,
        totalActive: stats.totalActive,
        totalCancelled: stats.totalCancelled,
        cancellationRate: stats.cancellationRate,
        classroomRanking: Object.entries(totals).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
        byPeriod: counts(stats.byPeriod, ['morning', 'period1', 'period2', 'period3', 'period4', 'lunch', 'period5', 'period6', 'period7', 'period8']),
        byWeekday: counts(stats.byWeekday, ['0', '1', '2', '3', '4', '5', '6']),
        ipadByGrade: counts(stats.ipadByGrade, ['三年級', '四年級', '五年級', '六年級']),
        leadTimeDistribution: counts(stats.leadTimeDistribution, ['當天', '1-3 天', '4-7 天', '8-30 天', '> 30 天']),
    };
}

function isReportAdmin(claims) {
    return claims?.email === 'ipad@mail2.smes.tyc.edu.tw'
        && claims?.firebase?.sign_in_provider !== 'anonymous';
}

function escapeReportText(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
}

module.exports = { anonymousReportStats, isReportAdmin, escapeReportText };
