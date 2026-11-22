// 命令列（AI 代理）的發佈金鑰：跟 Studio 畫面同一種檔（studio/publisher-key.js），簽章格式見 functions/publisher-key.js。
// 金鑰檔 { kid, pub, priv }：預設 ~/.climbio/publisher-key.json（CLIMBIO_PUBLISHER_KEY_FILE 可改），不存在就產生；不進版控、要備份。
// 岩館換 AI 代理：把金鑰檔交過去，或 node tools/wall-routes.mjs transfer <牆 id> <新 kid> 轉給新的金鑰。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { generateKeyPairSync, createPrivateKey, randomBytes, sign as cryptoSign } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { kidOf } = require('../functions/device-key.js');
const { message } = require('../functions/publisher-key.js');

export const KEY_FILE = process.env.CLIMBIO_PUBLISHER_KEY_FILE || join(homedir(), '.climbio', 'publisher-key.json');

/** 讀金鑰檔；不存在且 create 就產生一把（權限只有自己） */
export function loadKey(file = KEY_FILE, { create = true } = {}) {
  if (!existsSync(file)) {
    if (!create) throw new Error(`找不到發佈金鑰檔 ${file}`);
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }), pub = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ kid: kidOf(pub), pub, priv: privateKey.export({ format: 'jwk' }) }), { mode: 0o600 });
    console.error(`產生了發佈金鑰 ${file}（kid=${kidOf(pub)}）：第一次發佈的金鑰就是那面牆的擁有者，請備份、不要進版控`);
  }
  const k = JSON.parse(readFileSync(file, 'utf8'));
  if (!k.kid || !k.pub || !k.priv || kidOf(k.pub) !== k.kid) throw new Error(`${file} 不是有效的發佈金鑰檔`);
  return k;
}

/** 簽一個操作：{ kid, pub, ts, nonce, sig }；extra 是 transferWall 的新 kid */
export function signAuth(key, op, id, extra = '') {
  const auth = { kid: key.kid, pub: key.pub, ts: Date.now(), nonce: randomBytes(12).toString('base64url') };
  auth.sig = cryptoSign('sha256', Buffer.from(message(op, id, auth, extra)), { key: createPrivateKey({ key: key.priv, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return auth;
}

/** 給 studio/service.js 的 sign 參數 */
export const signerFor = (key) => async (op, id, extra = '') => signAuth(key, op, id, extra);
