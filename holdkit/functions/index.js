// Firebase 版的 retrace：不用登入。要 App Check 權杖（標頭 X-Firebase-AppCheck）；處理本身在 handler.js。
// 限流：每個網路來源每天 IP_LIMIT 次（台北時間零點重算，見 retrace-auth.js），記在 Firestore quota；超過回 429 { error: 'quota' }
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { createHandler } = require('./handler');
const auth = require('./retrace-auth');

admin.initializeApp();

const ORIGINS = ['https://climb-io.github.io', 'https://climbio.app', 'https://climbio.web.app', 'https://climbio-dev.web.app', 'https://climbio-eric.web.app', 'https://climbio.firebaseapp.com', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const PREVIEW = /^https:\/\/climbio--[a-z0-9-]+\.web\.app$/;   // Hosting 預覽網址（測試用）
const db = () => getFirestore('climbio');

exports.retrace = onRequest({ region: 'asia-east1', invoker: 'public', memory: '4GiB', cpu: 8, timeoutSeconds: 300, concurrency: 1, maxInstances: 2 }, createHandler({
  verify: async (req) => {
    await admin.appCheck().verifyToken(req.get('x-firebase-appcheck') || '');
    return auth.idOf(req);
  },
  takeQuota: (id) => auth.takeQuota(db(), id),
  allowOrigin: (origin) => ORIGINS.includes(origin) || PREVIEW.test(origin),
}));
