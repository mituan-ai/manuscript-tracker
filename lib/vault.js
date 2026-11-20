// 凭证库：AES-GCM 加密后存在 chrome.storage.local，不进 storage.sync，不发往任何服务器。
// 密钥是安装时生成的不可导出 CryptoKey，存在扩展自己的 IndexedDB 里。
//
// 库内容：{ creds: { [id]: { username, password, savedAt, source } }, elsevier: [uuid] }
// 凭证 id：scholarone（所有 ScholarOne 站点的默认账号）、scholarone:<站点>（单站点覆盖）、
//          ieee、paperplaza、tcct

const DB_NAME = 'submission-tracker-vault';
const STORE = 'keys';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务被中止'));
  });
}

let keyPromise = null;
function deviceKey() {
  keyPromise ||= (async () => {
    const db = await openDb();
    let key = await idb(db, 'readonly', (s) => s.get('device'));
    if (!key) {
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await idb(db, 'readwrite', (s) => s.put(key, 'device'));
    }
    return key;
  })();
  keyPromise.catch(() => (keyPromise = null));
  return keyPromise;
}

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function read() {
  const { vault } = await chrome.storage.local.get('vault');
  if (!vault) return {};
  // 读密钥失败（IndexedDB 暂时出错）时直接报错：当成空库的话，下一次写入会把所有账号覆盖掉
  const key = await deviceKey();
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // 密钥对不上（例如扩展数据被清除过）时永远无法解密，只能当作空库
    console.warn('凭证库无法解密，已视为空');
    return {};
  }
}

async function write(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deviceKey(), new TextEncoder().encode(JSON.stringify(obj)));
  await chrome.storage.local.set({ vault: { v: 1, iv: toB64(iv), ct: toB64(ct) } });
}

let chain = Promise.resolve();
/** 串行读写，避免并发覆盖。fn 可以原地修改并返回 undefined。 */
export function updateVault(fn) {
  const next = chain.then(async () => {
    const v = await read();
    const out = (await fn(v)) ?? v;
    await write(out);
    return out;
  });
  chain = next.catch(() => {});
  return next;
}

export function readVault() {
  const next = chain.then(read);
  chain = next.catch(() => {});
  return next;
}

/** ScholarOne 先找单站点账号，再找默认账号。 */
export async function getCredential(id) {
  const { creds = {} } = await readVault();
  if (creds[id]) return { id, ...creds[id] };
  if (id.startsWith('scholarone:') && creds.scholarone) return { id: 'scholarone', ...creds.scholarone };
  return null;
}

export async function setCredential(id, username, password, source = 'manual') {
  await updateVault((v) => {
    v.creds ||= {};
    v.creds[id] = { username, password, savedAt: Date.now(), source };
  });
}

export async function removeCredential(id) {
  await updateVault((v) => {
    if (v.creds) delete v.creds[id];
  });
}

export async function getElsevierIds() {
  return (await readVault()).elsevier || [];
}

export async function setElsevierIds(ids) {
  await updateVault((v) => {
    v.elsevier = [...new Set(ids)];
  });
}

/** 给界面用的摘要：不含密码，用户名打码。 */
export async function credentialSummary() {
  const { creds = {}, elsevier = [] } = await readVault();
  const mask = (u) => (u.length <= 4 ? u[0] + '***' : u.slice(0, 3) + '***' + u.slice(u.indexOf('@') > 3 ? u.indexOf('@') : -2));
  const out = {};
  for (const [id, c] of Object.entries(creds)) out[id] = { username: mask(c.username), savedAt: c.savedAt, source: c.source };
  return { creds: out, elsevierCount: elsevier.length };
}

export function clearVault() {
  const next = chain.then(async () => {
    await chrome.storage.local.remove('vault');
    const db = await openDb();
    await idb(db, 'readwrite', (s) => s.clear());
    keyPromise = null;
  });
  chain = next.catch(() => {});
  return next;
}
