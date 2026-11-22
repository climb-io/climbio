// Studio 的發佈金鑰（瀏覽器）：第一次發佈時產生一把 ECDSA P-256 金鑰存在這個瀏覽器（localStorage），發佈、下架、轉交都用它簽章；
// 伺服器把第一次發佈的金鑰記成這面牆的擁有者（functions/publisher-key.js）。金鑰只有一份檔案的內容（{ kid, pub, priv }）：
// 換電腦或換 AI 代理，匯出（exportKey）、匯入（importKey），或轉交給新的 kid（transferWall）。命令列用同一種檔（tools/publisher-auth.mjs）。
const STORE = 'climbio.studio.publisherKey';
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hex = (bytes) => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const kidOf = async (pub) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pub.x}.${pub.y}`))).slice(0, 32);

let cached = null;
const read = () => { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { return null; } };
async function make() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey), priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y };
  return { kid: await kidOf(pub), pub, priv };
}
async function load() {
  if (cached) return cached;
  let k = read();
  if (!k) { k = await make(); try { localStorage.setItem(STORE, JSON.stringify(k)); } catch { /* 存不了就只用這一次 */ } }
  const priv = await crypto.subtle.importKey('jwk', k.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return (cached = { ...k, signKey: priv });
}

/** 發佈金鑰的 kid（沒有就先產生） */
export const publisherKid = async () => (await load()).kid;
/** 匯出金鑰檔的內容（JSON 字串，要保管好：拿到的人就是擁有者） */
export const exportKey = async () => { const { kid, pub, priv } = await load(); return JSON.stringify({ kid, pub, priv }); };
/** 匯入金鑰檔的內容；格式或指紋不對丟錯 */
export async function importKey(text) {
  const k = JSON.parse(text);
  if (!k || !k.pub || !k.priv || (await kidOf(k.pub)) !== k.kid) throw new Error('bad key file');
  localStorage.setItem(STORE, JSON.stringify({ kid: k.kid, pub: k.pub, priv: k.priv })); cached = null;
  return k.kid;
}
/** 簽一個操作：{ kid, pub, ts, nonce, sig }；extra 是 transferWall 的新 kid，其他不給 */
export async function sign(op, id, extra = '') {
  const k = await load(), ts = Date.now(), nonce = b64u(crypto.getRandomValues(new Uint8Array(12)));
  const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.signKey, new TextEncoder().encode(JSON.stringify([op, id, ts, nonce, extra]))));
  return { kid: k.kid, pub: k.pub, ts, nonce, sig };
}
