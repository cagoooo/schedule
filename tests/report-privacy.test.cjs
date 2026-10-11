const test = require('node:test');
const assert = require('node:assert/strict');
const { anonymousReportStats, isReportAdmin, escapeReportText } = require('../functions/report-privacy');

test('AI 白名單排除姓名、自由文字、裝置與不明場地名称', () => {
    const input = {
        totalBookings: 6, totalActive: 5, totalCancelled: 1, cancellationRate: 16.7,
        classroomRanking: [{ name: '禮堂', count: 3 }, { name: '虛構測試姓名', count: 2 }],
        topUsersList: [{ name: '虛構測試姓名', count: 5 }], reason: '測試用途秘密', deviceId: 'private-device',
        byPeriod: { period1: 2 }, byWeekday: { 1: 2 }, ipadByGrade: {}, leadTimeDistribution: {},
    };
    const result = anonymousReportStats(input);
    assert.equal(result.totalBookings, 6);
    assert.ok(!JSON.stringify(result).includes('虛構測試姓名'));
    assert.ok(!JSON.stringify(result).includes('private-device'));
    assert.equal(result.classroomRanking[1].name, '其他場地');
    assert.deepEqual(anonymousReportStats(result), result);
});
test('報告權限拒絕訪客、匿名、非學校帳號', () => {
    assert.equal(isReportAdmin(null), false);
    assert.equal(isReportAdmin({ email: 'other@example.test' }), false);
    assert.equal(isReportAdmin({ email: 'ipad@mail2.smes.tyc.edu.tw', firebase: { sign_in_provider: 'anonymous' } }), false);
    assert.equal(isReportAdmin({ email: 'ipad@mail2.smes.tyc.edu.tw', firebase: { sign_in_provider: 'password' } }), true);
});
test('AI 文案以文字呈現、不執行 HTML', () => {
    assert.equal(escapeReportText('<script>"&</script>'), '&lt;script&gt;&quot;&amp;&lt;/script&gt;');
});
test('報告路由均先驗證，既有公开下載與姓名排行不再輸出', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(require('node:path').join(__dirname, '../functions/index.js'), 'utf8');
    assert.ok(!src.includes('makePublic()'));
    assert.ok(src.includes('await file.makePrivate()'));
    assert.ok(!src.includes('老師排行Top10:'));
    assert.ok(!src.includes('${u.name}'));
    for (const name of ['generateSemesterReport', 'getSemesterReport', 'listSemesterReports']) {
        const part = src.slice(src.indexOf('exports.' + name), src.indexOf('exports.' + name) + 1000);
        assert.ok(part.includes('requireReportAdmin(req, res)'), name);
    }
});
