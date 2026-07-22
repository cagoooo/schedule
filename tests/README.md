# 自動化測試 (P1-4 / F.1)

> v2.55.x 建立。防止 v2.41.x「一天 9 個 hotfix」的回歸災難重演。

## 指令

```bash
npm test          # 單元測試 (vitest, ~1 秒)
npm run test:watch  # 開發時監看模式
npm run test:e2e  # E2E 煙霧測試 (playwright, 需本機 config.js, ~25 秒)
```

## 架構

| 層級 | 工具 | 範圍 | 執行環境 |
|:---|:---|:---|:---|
| 單元 | Vitest + jsdom | app.js 純邏輯函式 | 本機 + **CI（每次 push 自動跑）** |
| E2E | Playwright (chromium) | 真瀏覽器關鍵流程 | 僅本機（需 config.js，不在 repo） |

## 單元測試怎麼載入 app.js？

app.js 是無模組系統的全域 script。[unit/app-loader.mjs](unit/app-loader.mjs) 把原始碼塞進
`new Function` 沙箱、注入 chainable 的 firebase mock，再撈出純函式。
**新增可測函式時**：把函式名加進 `EXPORT_NAMES` 清單即可。

## 測試涵蓋

- `semester.test.mjs` — 台灣學制學期換算（**8/1、2/1 邊界**、offset 回推、全學年）
- `achievements.test.mjs` — 成就徽章門檻臨界值 + 連續週 streak 演算法
- `dates.test.mjs` — formatDate/parseDate/getMonday（含週日歸屬、補零）
- `webpush-edittrail.test.mjs` — VAPID base64url 解碼、異動履歷值格式化
- `e2e/smoke.spec.mjs` — 頁面載入、我的預約/匯出/統計/歷史彈窗全流程（**唯讀**，不寫 production 資料）

## 已知事項

- E2E 開頭擋掉 `sw.js` 註冊：SW 首次安裝的 `clients.claim()` 會觸發一次性 reload，
  會打斷測試中的彈窗（production 首訪也有此一次性行為，屬既有設計）。
- E2E 讀取真實 Firestore（唯讀）；不做建立/刪除預約的測試，避免污染正式資料。
- functions/ 的 Cloud Functions 尚無單元測試（未來可用 firebase-functions-test 補）。
