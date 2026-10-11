'use strict';
// 預設僅盤點。明確 --apply 才撤除 reports/ 物件公開 ACL 與下載 token；不刪除報告。
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const bucket = 'schedule-10ed3.firebasestorage.app';
const apply = process.argv.includes('--apply');
const account = process.argv.find(arg => arg.startsWith('--account='))?.slice(10) || 'ipad@mail2.smes.tyc.edu.tw';
if (!['ipad@mail2.smes.tyc.edu.tw', 'cagooo@gmail.com'].includes(account)) throw new Error('未核可的操作帳號');
const token = execSync('gcloud auth print-access-token --account=' + account + ' --project=schedule-10ed3', { encoding: 'utf8', timeout: 20000 }).trim();
async function api(path, options = {}) {
    const res = await fetch('https://storage.googleapis.com/storage/v1/b/' + bucket + path, {
        ...options, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('Storage API ' + res.status + ': ' + path);
    return res.status === 204 ? null : res.json();
}
(async () => {
    const iam = await api('/iam');
    if ((iam.bindings || []).some(b => b.members?.some(m => ['allUsers', 'allAuthenticatedUsers'].includes(m)) && /viewer|objectUser|admin|legacyBucketReader/i.test(b.role))) {
        throw new Error('Bucket 存在整桶公開權限，需要另行檢查，不能只撤除物件 ACL。');
    }
    const objects = [];
    let page = '';
    do {
        const batch = await api('/o?prefix=reports%2F&projection=full' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
        objects.push(...(batch.items || []));
        page = batch.nextPageToken || '';
    } while (page);
    const evidenceDir = require('node:path').join(__dirname, '../private-report-audit');
    fs.mkdirSync(evidenceDir, { recursive: true });
    const manifest = { at: new Date().toISOString(), apply, bucket, objects };
    fs.writeFileSync(require('node:path').join(evidenceDir, Date.now() + '-before.json'), JSON.stringify(manifest, null, 2));
    console.log('盤點 reports/ 物件：' + objects.length + '；' + (apply ? '執行撤除公開權限' : '尚未修改'));
    console.log('含公開 ACL：' + objects.filter(o => o.acl?.some(a => ['allUsers', 'allAuthenticatedUsers'].includes(a.entity))).length
        + '；含下載 token：' + objects.filter(o => o.metadata?.firebaseStorageDownloadTokens).length);
    if (!apply) return;
    let verified = 0;
    for (const obj of objects) {
        const path = '/o/' + encodeURIComponent(obj.name);
        for (const entry of obj.acl || []) {
            if (['allUsers', 'allAuthenticatedUsers'].includes(entry.entity)) await api(path + '/acl/' + entry.entity, { method: 'DELETE' });
        }
        const current = await api(path);
        await api(path + '?ifMetagenerationMatch=' + current.metageneration, {
            method: 'PATCH', body: JSON.stringify({ cacheControl: 'private, no-store, max-age=0', metadata: { firebaseStorageDownloadTokens: null } }),
        });
        const latest = await api(path + '?projection=full');
        if ((latest.acl || []).some(a => ['allUsers', 'allAuthenticatedUsers'].includes(a.entity)) || latest.metadata?.firebaseStorageDownloadTokens) throw new Error('撤權驗證未通過');
        const external = await fetch('https://storage.googleapis.com/' + bucket + '/' + obj.name.split('/').map(encodeURIComponent).join('/'), { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (![401, 403, 404].includes(external.status)) throw new Error('未登入仍可取得報告：HTTP ' + external.status);
        verified++;
    }
    console.log('已撤權並驗證未登入不可存取：' + verified + '；原始報告未刪除。');
})().catch(err => { console.error(err.message); process.exitCode = 1; });
