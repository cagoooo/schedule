# 開發參考資源彙整（DEV REFERENCES）

**配套文件**：[FUTURE_PROPOSAL.md](./FUTURE_PROPOSAL.md) │ [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md) │ [PROGRESS.md](./PROGRESS.md)  
**基準版本**：v2.40.0 │ **最後更新**：2026-04-19

> 本文件為各項提案提供**精選的官方文件、教學、開源工具與中文資源連結**，依施工順序與分類整理。建議在動工前先快速瀏覽 1~2 篇官方 Quickstart，再進入 Cookbook 或範例專案研究細節。

---

## 📑 目錄

1. [✅ 已完成功能延伸閱讀](#-已完成功能延伸閱讀)
2. [🚧 即將開發 v2.41~v2.43](#-即將開發-v241v243)
3. [🌟 第一階段提案 (1.1~1.8)](#-第一階段提案-1118)
4. [🚀 第二階段提案 (2.x)](#-第二階段提案-2x)
5. [🔮 第三階段願景 (3.x)](#-第三階段願景-3x)
6. [🛠 開發品質 F.x 系列](#-開發品質-fx-系列)
7. [🆕 v2.39+ 新增提案 (V/M/C/U/A/X/K/G)](#-v239-新增提案-vmcuaxkg)
8. [🇹🇼 中文社群與學習資源](#-中文社群與學習資源)
9. [🧰 通用工具速查表](#-通用工具速查表)

---

## ✅ 已完成功能延伸閱讀

### v2.40.0 V/C 系列 — 你已經在用的技術
| 主題 | 推薦資源 |
| :--- | :--- |
| **Service Worker (Stale-While-Revalidate)** | [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) ｜ [web.dev: Caching strategies](https://web.dev/articles/offline-cookbook) ｜ [Workbox 官方](https://developer.chrome.com/docs/workbox) |
| **PWA 安裝體驗** | [web.dev PWA 學習路徑](https://web.dev/learn/pwa) ｜ [MDN PWA Guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps) |
| **localStorage 最佳實踐** | [MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API) ｜ [web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web) |
| **鍵盤事件與 a11y** | [MDN KeyboardEvent](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent) ｜ [WAI-ARIA Authoring Practices: Keyboard Interactions](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) |
| **Web Font 優化** | [web.dev: Optimize WebFont loading](https://web.dev/articles/optimize-webfont-loading) ｜ [Google Fonts 最佳實踐](https://web.dev/articles/font-best-practices) |

### v2.39.0 一鍵重複預約
| 主題 | 推薦資源 |
| :--- | :--- |
| **Date 處理（推薦轉用函式庫）** | [date-fns](https://date-fns.org/) ｜ [day.js](https://day.js.org/) ｜ [MDN Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat) |
| **HTML data-* 與 dataset** | [MDN HTMLElement.dataset](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset) |
| **事件委派 (Event Delegation)** | [JavaScript.info: Event delegation](https://javascript.info/event-delegation) |

---

## 🚧 即將開發 v2.41~v2.43

### v2.41.0 — M.1 場地公告 + M.2 批次取消

#### M.1 場地維護公告系統
- **Firestore Schema 設計**: [Firestore Data Modeling Guide](https://firebase.google.com/docs/firestore/data-model) ｜ [Best practices](https://firebase.google.com/docs/firestore/best-practices)
- **Markdown 渲染**（公告若支援格式）: [marked.js](https://github.com/markedjs/marked) ｜ [DOMPurify (XSS 防護必備)](https://github.com/cure53/DOMPurify)
- **Toast/Banner 設計參考**: [Material Design - Snackbars](https://m3.material.io/components/snackbar/overview) ｜ [Tailwind UI Notifications 範例](https://tailwindui.com/components/application-ui/overlays/notifications)
- **日期區間選擇器（無依賴）**: [HTML `<input type="date">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/date) ｜ [flatpickr (進階)](https://flatpickr.js.org/)

#### M.2 批次取消功能
- **Firestore 批次寫入**: [Batched Writes 官方文件](https://firebase.google.com/docs/firestore/manage-data/transactions#batched-writes)（已用於 submitBooking）
- **危險操作的二次確認 UX**: [GitHub: 危險動作確認對話框模式](https://primer.style/components/dialog) ｜ [NN/g: Avoid Destructive Actions](https://www.nngroup.com/articles/destructive-actions/)
- **Checkbox 全選/部分選取邏輯**: [MDN: indeterminate 狀態](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#indeterminate_state)

---

### v2.42.0 — C.1 IndexedDB 本地快取

| 資源 | 說明 |
| :--- | :--- |
| [MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) | 官方 API 完整參考 |
| [idb (Jake Archibald)](https://github.com/jakearchibald/idb) | **強烈推薦**的輕量 Promise wrapper（GitHub 6K star） |
| [Dexie.js](https://dexie.org/) | 進階 ORM 風格，支援版本遷移、查詢語法 |
| [web.dev: IndexedDB best practices](https://web.dev/articles/indexeddb-best-practices) | 含效能、容量、清理策略 |
| [Firebase + IndexedDB 離線範例](https://firebase.google.com/docs/firestore/manage-data/enable-offline) | Firebase 自帶離線快取（可能已能省掉自製） |
| [Stale-While-Revalidate Pattern (RFC 5861)](https://datatracker.ietf.org/doc/html/rfc5861) | 與 SW 策略相同的概念，可套用於資料層 |

> 💡 **省工小撇步**：Firebase Firestore 內建 `enablePersistence()` 已能將資料存入 IndexedDB 並支援離線。先試試[官方持久化選項](https://firebase.google.com/docs/firestore/manage-data/enable-offline)，若仍不夠快再考慮自製。

---

### v2.43.0 — M.3 個人化儀表板

| 資源 | 說明 |
| :--- | :--- |
| [Chart.js 官方](https://www.chartjs.org/docs/latest/) | 最易上手的圖表庫，含 doughnut/line/bar |
| [ApexCharts](https://apexcharts.com/) | 互動式圖表，動畫漂亮 |
| [Chart.js: Animations Guide](https://www.chartjs.org/docs/latest/configuration/animations.html) | 入場動畫設定 |
| [CSS Bento Grid Layout 範例](https://css-tricks.com/getting-started-css-grid/) | 已用於管理員儀表板，可重用 |
| [Firestore Aggregation Queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries) | `count()`、`sum()`、`avg()` 進階查詢 |
| [web.dev: Skeleton Screen patterns](https://web.dev/patterns/web-vitals-patterns/loading/) | 載入動畫模式 |

---

## 🌟 第一階段提案 (1.1~1.8)

### 1.1 LINE Bot 預約通知

| 資源 | 用途 |
| :--- | :--- |
| [LINE Developers 官方](https://developers.line.biz/en/) | 註冊 Provider + Channel 起點 |
| [Messaging API 文件](https://developers.line.biz/en/docs/messaging-api/) | 完整 API 參考 |
| [Messaging API SDK for Node.js](https://github.com/line/line-bot-sdk-nodejs) | 官方 SDK |
| [LINE Notify 終止公告](https://notify-bot.line.me/closing-announce) | 為什麼必須改用 Messaging API |
| [LINE Flex Message Simulator](https://developers.line.biz/flex-simulator/) | 設計通知卡片 UI |
| [Webhook 設定教學](https://developers.line.biz/en/docs/messaging-api/building-bot/) | 接收使用者回覆 |
| [鐵人賽: LINE Bot + Firebase](https://ithelp.ithome.com.tw/users/20107906/ironman/2735) | 中文實作參考 |

### 1.2 多角色權限分層 (Custom Claims)

| 資源 | 用途 |
| :--- | :--- |
| [Custom Claims 官方文件](https://firebase.google.com/docs/auth/admin/custom-claims) | 設定角色 metadata |
| [Firestore Security Rules + Claims](https://firebase.google.com/docs/firestore/security/rules-conditions#access_user_information) | Rules 內讀 Claims |
| [Rules Playground](https://firebase.google.com/docs/rules/simulator) | 線上測試 Rules |
| [完整範例: Role-Based Access Control](https://firebase.google.com/docs/firestore/solutions/role-based-access) | RBAC 設計範本 |

### 1.3 深色模式 (Dark Mode)

| 資源 | 用途 |
| :--- | :--- |
| [MDN: prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) | 跟隨系統偏好 |
| [web.dev: Dark mode color palette](https://web.dev/articles/prefers-color-scheme) | 色彩設計原則 |
| [Material You Color System](https://m3.material.io/styles/color/system/overview) | 深淺主題色彩生成 |
| [Tailwind Dark Mode Guide](https://tailwindcss.com/docs/dark-mode) | CSS 變數覆蓋技巧 |
| [Adobe Color Wheel](https://color.adobe.com/) | 配色工具 |

### 1.4 預約範本 (Quick Templates)

| 資源 | 用途 |
| :--- | :--- |
| [Firestore Subcollections](https://firebase.google.com/docs/firestore/data-model#subcollections) | `users/{uid}/templates` 結構 |
| [Notion API templates 設計參考](https://developers.notion.com/docs/working-with-databases) | 資料模型靈感 |

### 1.5 智慧速率限流 v2 (信用積分制)

| 資源 | 用途 |
| :--- | :--- |
| [Token Bucket Algorithm 介紹](https://en.wikipedia.org/wiki/Token_bucket) | 經典速率控制演算法 |
| [Cloudflare: Rate Limiting Strategies](https://blog.cloudflare.com/counting-things-a-lot-of-different-things/) | 工業級實作思路 |
| [Firebase Functions onCall 限流](https://firebase.google.com/docs/functions/callable-reference#error_handling) | 後端強制執行 |
| [Stripe API: Rate Limits 設計](https://stripe.com/docs/rate-limits) | 信譽分層概念 |

### 1.6 Web Push 瀏覽器通知 (FCM)

| 資源 | 用途 |
| :--- | :--- |
| [FCM Web 官方文件](https://firebase.google.com/docs/cloud-messaging/js/client) | **必讀** Quickstart |
| [VAPID 金鑰設定](https://firebase.google.com/docs/cloud-messaging/js/client#configure_web_credentials_with_fcm) | 加密金鑰生成 |
| [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) | 標準規範參考 |
| [MDN Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API) | 顯示通知 |
| [iOS 16.4 Web Push 支援](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) | iOS 限制與要求 |
| [web.dev: Push Notifications best practices](https://web.dev/articles/push-notifications-overview) | UX/權限請求時機 |
| [Firebase Functions + FCM 範例](https://firebase.google.com/docs/cloud-messaging/send-message) | 後端推播實作 |

### 1.7 ✅ 一鍵重複預約 (已於 v2.39.0 完成)

略過。實作筆記見 [OPTIMIZATION_PLAYBOOK.md](./OPTIMIZATION_PLAYBOOK.md#1-7-一鍵重複預約-quick-re-book-已於-v239-0-完成)

### 1.8 完整稽核日誌 (Audit Log)

| 資源 | 用途 |
| :--- | :--- |
| [GCP Cloud Audit Logs 設計](https://cloud.google.com/logging/docs/audit) | 業界標準欄位定義 |
| [Firestore Triggers 監聽 onWrite](https://firebase.google.com/docs/functions/firestore-events) | 自動寫 audit |
| [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | 安全紀錄哪些欄位 |
| [GDPR 第 30 條 Records of Processing](https://gdpr-info.eu/art-30-gdpr/) | 法規要求參考 |

---

## 🚀 第二階段提案 (2.x)

### 2.1 Google Calendar 雙向同步

| 資源 | 用途 |
| :--- | :--- |
| [Calendar API v3 官方](https://developers.google.com/calendar/api/v3/reference) | API 完整參考 |
| [Calendar API Quickstart (Node.js)](https://developers.google.com/calendar/api/quickstart/nodejs) | 入門範例 |
| [Service Account 設定](https://cloud.google.com/iam/docs/service-account-overview) | 後端授權方式 |
| [.ics 格式規範 (RFC 5545)](https://datatracker.ietf.org/doc/html/rfc5545) | 訂閱檔規範 |
| [ical-generator (npm)](https://github.com/sebbo2002/ical-generator) | Node.js 產生 .ics 套件 |
| [add-to-calendar-button](https://github.com/add2cal/add-to-calendar-button) | 一鍵加入按鈕（前端） |

### 2.2 進階分析儀表板 v3

| 資源 | 用途 |
| :--- | :--- |
| [D3.js 官方](https://d3js.org/) | 高度自訂視覺化 |
| [ApexCharts](https://apexcharts.com/) | 互動式儀表板 |
| [Observable Plot](https://observablehq.com/plot/) | D3 進化版，語法直觀 |
| [Tremor (React UI Library)](https://tremor.so/) | 儀表板 UI 元件參考 |
| [jsPDF + html2canvas](https://github.com/parallax/jsPDF) | PDF 匯出 |
| [Statistical anomaly detection (Z-score)](https://en.wikipedia.org/wiki/Standard_score) | 異常偵測理論 |

### 2.3 Email 通知（Firebase Trigger Email）

| 資源 | 用途 |
| :--- | :--- |
| [Firebase Trigger Email Extension](https://extensions.dev/extensions/firebase/firestore-send-email) | 一鍵安裝 |
| [SendGrid (進階方案)](https://sendgrid.com/) | 正式環境 SMTP 推薦 |
| [MJML](https://mjml.io/) | 響應式 HTML Email 框架 |
| [Litmus Email Client Tester](https://litmus.com/) | 測試各家收信端兼容性 |

### 2.4 預約轉讓功能
- [Firestore Transactions](https://firebase.google.com/docs/firestore/manage-data/transactions) — 確保原子性

### 2.5 全文搜尋最佳化

| 資源 | 用途 |
| :--- | :--- |
| [Firestore 複合索引](https://firebase.google.com/docs/firestore/query-data/indexing) | 已有，可深入優化 |
| [Algolia + Firebase 整合](https://firebase.google.com/docs/firestore/solutions/search) | 官方推薦搜尋方案 |
| [Typesense (open source)](https://typesense.org/) | 自架 Algolia 替代品 |
| [MeiliSearch](https://www.meilisearch.com/) | 另一個免費替代方案 |

### 2.6 預約候補機制 (Waitlist)
- [Firebase Functions 排程觸發](https://firebase.google.com/docs/functions/schedule-functions)
- [GitHub Issue: Waitlist UX patterns](https://www.nngroup.com/articles/waitlist-ux/)

### 2.7 AI 自然語言預約助手 (Gemini)

| 資源 | 用途 |
| :--- | :--- |
| [Gemini API 官方](https://ai.google.dev/gemini-api/docs) | **必讀** 入門 |
| [Google AI Studio (Playground)](https://aistudio.google.com) | 在瀏覽器測試 prompt |
| [Gemini API 定價](https://ai.google.dev/pricing) | 免費額度查詢 |
| [Function Calling (結構化輸出)](https://ai.google.dev/gemini-api/docs/function-calling) | 解析意圖→JSON |
| [@google/generative-ai (npm)](https://github.com/google/generative-ai-js) | Node.js SDK |
| [Anthropic Claude API](https://docs.claude.com/) | 替代方案，1M context 適合大量文件分析 |
| [Prompt Engineering Guide](https://www.promptingguide.ai/) | Prompt 設計技巧 |

### 2.8 多語言 i18n

| 資源 | 用途 |
| :--- | :--- |
| [i18next 官方](https://www.i18next.com/) | 主流方案 |
| [FormatJS / Intl 系列](https://formatjs.io/) | 標準 Intl API 增強 |
| [MDN: Intl 物件](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl) | 數字、日期、複數變化 |
| [BCP 47 語言代碼](https://www.rfc-editor.org/info/bcp47) | zh-TW vs zh-Hant |

---

## 🔮 第三階段願景 (3.x)

### 3.1 PWA 強化 vs 原生 App

| 資源 | 用途 |
| :--- | :--- |
| [Capacitor 官方](https://capacitorjs.com/) | Web → Native 包裝 |
| [Tauri](https://tauri.app/) | Rust + WebView，App 體積小 |
| [PWA Builder (Microsoft)](https://www.pwabuilder.com/) | 一鍵打包到 App Store |
| [Background Sync API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API) | 離線送出佇列 |

### 3.2 QR Code 簽到 + IoT

| 資源 | 用途 |
| :--- | :--- |
| [qrcode (npm)](https://github.com/soldair/node-qrcode) | 後端產生 QR |
| [qrcode.js (前端)](https://github.com/davidshimjs/qrcodejs) | 前端產生 QR |
| [html5-qrcode](https://github.com/mebjas/html5-qrcode) | 前端掃 QR (Camera API) |
| [Tuya Cloud API](https://developer.tuya.com/en/docs/cloud) | 智慧插座控制 |
| [SwitchBot API](https://github.com/OpenWonderLabs/SwitchBotAPI) | 開放 API 較友善 |
| [Home Assistant 開源](https://www.home-assistant.io/) | 校用 IoT 整合中樞 |
| [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) | 直接控藍牙裝置 |

### 3.3 AI 智慧學期白皮書

| 資源 | 用途 |
| :--- | :--- |
| [PDFKit](https://pdfkit.org/) | Node.js 產生 PDF |
| [中文字型嵌入指南](https://github.com/foliojs/pdfkit/blob/master/docs/text.md#fonts) | 解決 PDFKit 中文亂碼 |
| [Noto Sans CJK 下載](https://fonts.google.com/noto/specimen/Noto+Sans+TC) | 開源中文字型 |
| [Cloud Scheduler 設定 cron](https://firebase.google.com/docs/functions/schedule-functions) | 學期末觸發 |
| [Firebase Storage 上傳](https://firebase.google.com/docs/storage) | 儲存 PDF |
| [chartjs-node-canvas](https://github.com/SeanSobey/ChartjsNodeCanvas) | Node.js 端產生圖表 |

### 3.4 排課系統整合
- [iCal 訂閱模式](https://en.wikipedia.org/wiki/ICalendar)
- [LDAP / SAML 整合](https://auth0.com/docs/authenticate/protocols/saml) (校務系統常用)

### 3.5 多校 SaaS 化

| 資源 | 用途 |
| :--- | :--- |
| [Firestore Multi-tenant 設計](https://firebase.google.com/docs/firestore/solutions/best-practices) | 路徑前綴策略 |
| [Cloud Run + Custom Domains](https://cloud.google.com/run/docs/mapping-custom-domains) | 子網域對應 tenant |
| [Stripe Connect](https://stripe.com/connect) | 多租戶收費基礎建設 |

### 3.6 AR 場地預覽

| 資源 | 用途 |
| :--- | :--- |
| [WebXR Device API](https://immersiveweb.dev/) | 標準入口 |
| [A-Frame](https://aframe.io/) | 宣告式 VR/AR 框架 |
| [model-viewer (Google)](https://modelviewer.dev/) | 3D 模型嵌入網頁 |

### 3.7 Apple / Google Wallet

| 資源 | 用途 |
| :--- | :--- |
| [Apple Wallet PassKit](https://developer.apple.com/documentation/walletpasses) | .pkpass 規範 |
| [Google Wallet API](https://developers.google.com/wallet) | 通用票卡 |
| [passkit-generator (npm)](https://github.com/alexandercerutti/passkit-generator) | 後端產生 .pkpass |

---

## 🛠 開發品質 F.x 系列

### F.1 Vitest + Playwright 測試

#### Vitest（單元測試）
| 資源 | 用途 |
| :--- | :--- |
| [Vitest 官方](https://vitest.dev/) | 主站，比 Jest 快、零設定 |
| [Vitest Guide](https://vitest.dev/guide/) | 入門 + 設定 |
| [Vitest UI](https://vitest.dev/guide/ui.html) | 視覺化測試介面 |
| [happy-dom (DOM 模擬)](https://github.com/capricorn86/happy-dom) | 比 jsdom 快 5x |
| [Testing Library: 查詢哲學](https://testing-library.com/docs/queries/about) | 寫好測試的核心觀念 |

#### Playwright（E2E）
| 資源 | 用途 |
| :--- | :--- |
| [Playwright 官方](https://playwright.dev/) | 跨瀏覽器自動化 |
| [Codegen (錄製測試)](https://playwright.dev/docs/codegen) | 邊操作邊產生測試碼 |
| [Trace Viewer](https://playwright.dev/docs/trace-viewer) | 失敗時回放，神器 |
| [GitHub Actions 整合](https://playwright.dev/docs/ci-intro#github-actions) | CI 範本 |
| [Visual Comparisons](https://playwright.dev/docs/test-snapshots) | 視覺迴歸測試 |

#### Firebase Emulator（測試環境）
- [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite) — Firestore + Auth + Functions 全模擬

### F.2 漸進式 TypeScript 遷移

| 資源 | 用途 |
| :--- | :--- |
| [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) | 官方手冊 |
| [TypeScript Deep Dive (中譯)](https://basarat.gitbook.io/typescript/) | 進階主題 |
| [JSDoc 型別標註](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html) | 不改副檔名也能型別檢查 |
| [Total TypeScript 學習路徑](https://www.totaltypescript.com/) | 高品質付費課（Matt Pocock） |
| [type-fest](https://github.com/sindresorhus/type-fest) | 常用型別工具集 |
| [Zod (執行時型別驗證)](https://zod.dev/) | Firestore 回傳資料校驗 |

### F.3 Sentry RUM 錯誤監控

| 資源 | 用途 |
| :--- | :--- |
| [Sentry JavaScript Docs](https://docs.sentry.io/platforms/javascript/) | 主入口 |
| [Browser Quick Start](https://docs.sentry.io/platforms/javascript/install/loader/) | CDN 安裝最快 |
| [Performance Monitoring](https://docs.sentry.io/product/performance/) | LCP/CLS 等 Core Web Vitals |
| [Sentry Pricing](https://sentry.io/pricing/) | 免費 5K events/月 |
| [Source Map 上傳](https://docs.sentry.io/platforms/javascript/sourcemaps/) | 看正確 stack trace |
| [LogRocket (替代方案)](https://logrocket.com/) | 錄製使用者操作回放 |

### F.4 Lighthouse CI

| 資源 | 用途 |
| :--- | :--- |
| [Lighthouse 官方](https://developer.chrome.com/docs/lighthouse/overview) | 工具總覽 |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci) | 自動化 CI 整合 |
| [Lighthouse CI GitHub Action](https://github.com/treosh/lighthouse-ci-action) | 一鍵設定 |
| [PageSpeed Insights](https://pagespeed.web.dev/) | 線上單次測試 |
| [web.dev: Core Web Vitals](https://web.dev/articles/vitals) | 三大指標解說 |

---

## 🆕 v2.39+ 新增提案 (V/M/C/U/A/X/K/G)

### 🚄 V 系列 (預約效率)
> V.1~V.5 已全數於 v2.40.0 完成 ✅

### 🎛 M 系列 (管理員實戰)

| 提案 | 推薦資源 |
| :--- | :--- |
| **M.1 場地公告** | [Firestore subcollection 設計](https://firebase.google.com/docs/firestore/data-model) ｜ [Banner UX patterns](https://www.nngroup.com/articles/announcement-bars/) |
| **M.2 批次取消** | [Confirmation dialogs 最佳實踐](https://www.nngroup.com/articles/confirmation-dialog/) ｜ [Firestore 大量寫入 (batchedWrites limit 500)](https://firebase.google.com/docs/firestore/manage-data/transactions#batched-writes) |
| **M.3 個人儀表板** | [Chart.js Personal Dashboard 範例](https://github.com/chartjs/Chart.js/tree/master/docs) ｜ [Apple Screen Time 設計參考](https://www.apple.com/family-sharing/) |
| **M.4 異常使用者** | [Trust & Safety patterns](https://www.tandsa.org/) ｜ [Spam detection 簡介](https://research.google/pubs/) |
| **M.5 異動通知** | （依賴 1.6 Web Push 與 1.1 LINE Bot） |

### 💰 C 系列 (成本與效能)

| 提案 | 推薦資源 |
| :--- | :--- |
| **C.1 IndexedDB** | （見 v2.42 章節） |
| **C.2 Code Splitting** | [Dynamic import (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import) ｜ [esbuild splitting](https://esbuild.github.io/api/#splitting) ｜ [Vite Code Splitting](https://vitejs.dev/guide/build.html#chunking-strategy) |
| **C.3 字型** ✅ | (已於 v2.40.0 完成) |
| **C.4 SW 策略** ✅ | (已於 v2.40.0 完成) |

### 🎨 U 系列 (視覺與互動)

| 提案 | 推薦資源 |
| :--- | :--- |
| **U.1 個人主題色** | [CSS 變數覆蓋技巧](https://web.dev/articles/building/a-theme-switch-component) ｜ [Open Props (色彩變數庫)](https://open-props.style/) |
| **U.2 拖放預約** | [HTML5 Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) ｜ [SortableJS](https://github.com/SortableJS/Sortable) ｜ [DnD Kit (進階)](https://dndkit.com/) |
| **U.3 微動畫** | [Lottie Player (web)](https://github.com/LottieFiles/lottie-player) ｜ [LottieFiles 免費動畫](https://lottiefiles.com/) |
| **U.4 場地配置圖** | [SVG.js](https://svgjs.dev/) ｜ [Excalidraw 線上畫圖](https://excalidraw.com/) ｜ [draw.io](https://app.diagrams.net/) |

### 🤖 A 系列 (AI 擴展)

| 提案 | 推薦資源 |
| :--- | :--- |
| **A.1 自然語言搜尋** | [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling) |
| **A.2 合理性檢查** | [Gemini Safety Settings](https://ai.google.dev/gemini-api/docs/safety-settings) |
| **A.3 AI 排課助手** | [Constraint Satisfaction (Wikipedia)](https://en.wikipedia.org/wiki/Constraint_satisfaction_problem) ｜ [OR-Tools (Google)](https://developers.google.com/optimization/scheduling) |
| **A.4 預測模型** | [TensorFlow.js](https://www.tensorflow.org/js) ｜ [Prophet (Meta 時序預測)](https://facebook.github.io/prophet/) |

### ♿ X 系列 (無障礙)

| 提案 | 推薦資源 |
| :--- | :--- |
| **X.1 WCAG 2.1 AA** | [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/) ｜ [WAVE 線上檢測](https://wave.webaim.org/) ｜ [axe DevTools (Chrome)](https://www.deque.com/axe/devtools/) |
| **X.2 字體調整** | [CSS rem unit + 使用者設定](https://web.dev/articles/font-size) |
| **X.3 多語言** | （見 2.8 i18n） |

### 🎪 K 系列 (創意)

| 提案 | 推薦資源 |
| :--- | :--- |
| **K.1 成就徽章** | [GitHub Achievements 設計參考](https://github.blog/news-insights/achievement-badges/) ｜ [Octicons (icon set)](https://primer.style/octicons/) |
| **K.2 互動地圖** | [Leaflet (免費地圖)](https://leafletjs.com/) ｜ [SVG Pan Zoom](https://github.com/ariutta/svg-pan-zoom) |
| **K.3 年度回顧** | [Spotify Wrapped 設計分析](https://www.fastcompany.com/section/co-design) ｜ [Lottie 動畫導入](https://lottiefiles.com/) |

### 🛡 G 系列 (治理與合規)

| 提案 | 推薦資源 |
| :--- | :--- |
| **G.1 個資聲明** | [國發會個資法導引](https://www.ndc.gov.tw/Content_List.aspx?n=72131D6F2CE3D2F7) ｜ [GDPR Cookie Consent 範例](https://www.cookiebot.com/) |
| **G.2 資料保留** | [Firestore TTL Policies](https://firebase.google.com/docs/firestore/ttl) ｜ [Cloud Storage Lifecycle Rules](https://cloud.google.com/storage/docs/lifecycle) |

---

## 🇹🇼 中文社群與學習資源

### 中文部落格與教學
- [iThome 鐵人賽](https://ithelp.ithome.com.tw/) — Firebase / Vue / 前端主題眾多
- [Huli's blog](https://blog.huli.tw/) — 前端深度文章
- [PJCHENder 小書](https://pjchender.dev/) — JS / TypeScript 中文筆記
- [TechBridge 技術共筆](https://blog.techbridge.cc/) — Lidemy 出品
- [Will 保哥的技術交流中心](https://blog.miniasp.com/) — 進階前端 + Azure
- [Kuro's blog](https://kuro.tw/) — React + 工程實踐

### YouTube 頻道（中英文）
- [Fireship](https://www.youtube.com/@Fireship) — 100 秒看新技術
- [Web Dev Simplified](https://www.youtube.com/@WebDevSimplified) — 概念清晰
- [六角學院](https://www.youtube.com/@hexschool) — 中文前端 / 切版
- [彭彭的課程](https://www.youtube.com/@cwpeng-course) — 中文程式入門
- [Theo - t3.gg](https://www.youtube.com/@t3dotgg) — Web 趨勢評論

### 中文社群
- [F2E 前端社群 (Slack)](https://www.facebook.com/groups/f2e.tw)
- [Taiwan Firebase 社群 (Facebook)](https://www.facebook.com/groups/firebase.tw)
- [JCConf Taiwan](https://jcconf.tw/) — 年會
- [WebConf Taiwan](https://webconf.tw/) — 年會
- [MOPCON](https://mopcon.org/) — 行動開發年會

### 中文書（推薦）
- 《**現代 JavaScript 高級講座**》(博碩) — 黃任鋒
- 《**TypeScript 從零開始**》(碁峯) — 王元賢
- 《**深入 React.js + Redux**》(碁峯) — Cathy
- 《**Firebase 7 件事**》(電子書) — Will 保哥

---

## 🧰 通用工具速查表

### 開發工具
- [VS Code](https://code.visualstudio.com/) + 推薦插件:
  - ESLint、Prettier、GitLens、Error Lens、Tailwind CSS IntelliSense
  - Firebase Explorer、Firestore Rules
  - Live Server、REST Client

### 線上工具
- [CodeSandbox](https://codesandbox.io/) — 線上開發沙盒
- [Stackblitz](https://stackblitz.com/) — 同上，Web 容器
- [JSON Editor Online](https://jsoneditoronline.org/) — JSON 視覺編輯
- [regex101](https://regex101.com/) — 正規表達式測試
- [transform.tools](https://transform.tools/) — JSON↔TS 等格式互轉
- [Can I use](https://caniuse.com/) — 瀏覽器相容性查詢
- [Bundlephobia](https://bundlephobia.com/) — npm 套件大小查詢

### 設計資源
- [Figma](https://www.figma.com/) — 設計協作（免費）
- [Heroicons](https://heroicons.com/) — Tailwind 系列免費圖示
- [Lucide](https://lucide.dev/) — Feather Icons 進化版
- [Coolors](https://coolors.co/) — 配色靈感
- [Unsplash](https://unsplash.com/) — 免費高品質圖
- [Iconify](https://icon-sets.iconify.design/) — 200K+ 圖示總集

### 性能與監控
- [Sentry](https://sentry.io/) — 錯誤監控（推薦 F.3）
- [LogRocket](https://logrocket.com/) — Session 回放
- [PageSpeed Insights](https://pagespeed.web.dev/) — 效能評分
- [WebPageTest](https://www.webpagetest.org/) — 進階效能分析
- [GTmetrix](https://gtmetrix.com/) — 效能與優化建議

### Firebase / GCP 工具
- [Firebase CLI](https://firebase.google.com/docs/cli) — 部署與管理
- [Firebase Emulator UI](http://localhost:4000) — 本地測試
- [Firestore Visualizer (Cookbook)](https://github.com/firebase/quickstart-js) — 資料瀏覽
- [GCP Cost Calculator](https://cloud.google.com/products/calculator)

### 版本控制 / CI
- [GitHub CLI (gh)](https://cli.github.com/) — 終端機操作 GitHub
- [act (本地跑 GitHub Actions)](https://github.com/nektos/act)
- [pre-commit](https://pre-commit.com/) — Git hooks 框架

---

## 🎓 學習路徑建議

### 🥇 想優先強化「前端品質」（適合 v2.40 後階段）
1. 讀 [JavaScript.info](https://javascript.info/) Chapter 1-5（鞏固 ES2020+ 基礎）
2. 跟著 [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) 完成練習
3. 看 [Total TypeScript 免費 Beginners 教學](https://www.totaltypescript.com/tutorials)
4. 動手做：把 `app.js` 一個函式寫成 TS 並補單元測試

### 🥈 想優先強化「Firebase 後端」
1. 完成 [Firebase Web 入門 codelab](https://firebase.google.com/codelabs/firebase-web)
2. 讀 [Firestore Data Modeling](https://firebase.google.com/docs/firestore/data-model)
3. 跟著 [Cloud Functions 教學](https://firebase.google.com/docs/functions/get-started) 部署第一個函式
4. 嘗試實作 1.8 Audit Log

### 🥉 想優先強化「AI 整合」
1. 在 [Google AI Studio](https://aistudio.google.com) 玩 5 個 prompt
2. 讀 [Function Calling 教學](https://ai.google.dev/gemini-api/docs/function-calling)
3. 用 Node.js 寫一個小 demo: 「自然語言 → Firestore Query」
4. 進階可參考 [LangChain.js](https://js.langchain.com/) 做更複雜的 chain

### 🛠 想優先強化「自動化測試」
1. 跟著 [Vitest Quickstart](https://vitest.dev/guide/) 寫 5 個簡單測試
2. 看 Kent C. Dodds 的 [Testing JavaScript 系列文章](https://kentcdodds.com/blog?q=testing)
3. 用 [Playwright Codegen](https://playwright.dev/docs/codegen) 錄一個預約流程
4. 在 GitHub Actions 加入 CI

---

> [!TIP]
> **每週 30 分鐘的學習計畫建議**：選一個感興趣主題的官方文件 Quickstart，動手完成 → 寫成你自己版本的 README → 整合進專案。**做中學遠勝過只看影片**。

> [!IMPORTANT]
> **連結維護**：本文件的連結會隨時間失效，建議每季度（搭配 [PROGRESS.md](./PROGRESS.md) 例行檢查）抽 10 分鐘檢驗連結存活，更新失效資源。

> [!NOTE]
> **對 LLM 友善的 URL**：本文件刻意選擇穩定的官方文件 root 與 GitHub repo，未來與 AI 助理協作時，這些 URL 大多能被準確抓取與引用。避免引用單篇 Medium 文章（容易付費牆 / 失效）。

---

*文件版本 v1.0 │ 最後更新：2026-04-19 │ 配套 FUTURE_PROPOSAL v2.39.0+ │ 收錄 200+ 連結*
