#!/usr/bin/env node
// 把当前版本上传到 Edge 加载项和 Chrome 应用商店，并提交审核。商店详情页的文字和截图不在这里改，仍在各自的后台改。
// 凭据放在 ~/.config/mituan/stores.env（不在仓库里，权限 600），格式见 deploy/README.md。
//
// 用法：npm run publish:stores                 两个商店都发布
//       npm run publish:stores -- --edge       只发布 Edge（--chrome 同理）
//       npm run publish:stores -- --check      只检查凭据和打包，不上传
//       npm run publish:stores -- --status     查看 Chrome 的审核状态（Edge 没有查询接口，去 Partner Center 看）
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONF_FILE = process.env.MITUAN_STORES_ENV || path.join(os.homedir(), '.config/mituan/stores.env');
const args = new Set(process.argv.slice(2));
const only = args.has('--edge') ? ['edge'] : args.has('--chrome') ? ['chrome'] : ['edge', 'chrome'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

function readConf() {
  if (!existsSync(CONF_FILE)) die(`找不到凭据文件 ${CONF_FILE}，见 deploy/README.md「自动发布」`);
  if (statSync(CONF_FILE).mode & 0o077) console.warn(`! ${CONF_FILE} 其他用户可读，建议 chmod 600`);
  const conf = {};
  for (const line of readFileSync(CONF_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) conf[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/^~(?=\/)/, os.homedir());
  }
  return conf;
}
function need(conf, keys, store) {
  const missing = keys.filter((k) => !conf[k]);
  if (missing.length) die(`${store} 缺少凭据：${missing.join('、')}（在 ${CONF_FILE} 里填写）`);
}

const version = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const NOTES = `Version ${version}. Release notes: https://github.com/mituan-ai/manuscript-tracker/releases/tag/v${version}

Testing notes: every supported submission system needs a real author account (ScholarOne / IEEE Author Portal, IFAC PaperPlaza, TCCT) or a private Elsevier tracking link, and these systems do not offer test accounts. Without an account you can review the interface: the welcome page, the toolbar popup and the dashboard tabs. The extension only reads status pages, never submits or changes anything, keeps credentials encrypted locally, and loads no remote code. Source: https://github.com/mituan-ai/manuscript-tracker`;

// ───── Edge 加载项：Update REST API v1.1（Client ID + API key） ─────
const EDGE_API = process.env.MITUAN_EDGE_API || 'https://api.addons.microsoftedge.microsoft.com'; // 环境变量只给测试用
async function edgePoll(url, headers, label) {
  for (let i = 0; i < 120; i++) {
    const r = await fetch(url, { headers });
    const j = await r.json().catch(() => ({}));
    if (j.status && j.status !== 'InProgress') {
      if (j.status !== 'Succeeded') die(`${label}失败：${j.message || ''} ${JSON.stringify(j.errors || j.errorCode || '')}`);
      return j;
    }
    await sleep(5000);
  }
  die(`${label}超时，去 Partner Center 查看`);
}
async function publishEdge(conf, zip) {
  need(conf, ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'], 'Edge');
  if (args.has('--check')) return console.log('✓ Edge 凭据已填写（Edge 没有只读接口，凭据是否有效要到上传时才知道）');
  const h = { Authorization: `ApiKey ${conf.EDGE_API_KEY}`, 'X-ClientID': conf.EDGE_CLIENT_ID };
  const base = `${EDGE_API}/v1/products/${conf.EDGE_PRODUCT_ID}/submissions`;
  console.log('… Edge：上传扩展包');
  let r = await fetch(`${base}/draft/package`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/zip' }, body: readFileSync(zip) });
  if (r.status !== 202) die(`Edge 上传被拒绝（HTTP ${r.status}）：${await r.text()}`);
  await edgePoll(`${base}/draft/package/operations/${r.headers.get('location').split('/').pop()}`, h, 'Edge 上传');
  console.log('… Edge：提交审核');
  r = await fetch(base, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: NOTES }) });
  if (r.status !== 202) die(`Edge 提交被拒绝（HTTP ${r.status}）：${await r.text()}`);
  await edgePoll(`${base}/operations/${r.headers.get('location').split('/').pop()}`, h, 'Edge 提交');
  console.log(`✓ Edge：v${version} 已提交审核（最多 7 个工作日），结果会发邮件`);
}

// ───── Chrome 应用商店：API v2（服务账号 JSON 密钥换取访问令牌） ─────
const CWS = process.env.MITUAN_CWS_API || 'https://chromewebstore.googleapis.com'; // 同上
async function googleToken(file) {
  if (!existsSync(file)) die(`找不到 Chrome 服务账号密钥 ${file}`);
  const sa = JSON.parse(readFileSync(file, 'utf8'));
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore', aud, iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) die(`Google 拒绝了服务账号：${JSON.stringify(j)}`);
  return j.access_token;
}
async function chromeStatus(conf, token) {
  const r = await fetch(`${CWS}/v2/publishers/${conf.CHROME_PUBLISHER_ID}/items/${conf.CHROME_ITEM_ID}:fetchStatus`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) die(`Chrome 查询状态失败（HTTP ${r.status}）：${JSON.stringify(j)}`);
  return j;
}
const rev = (s) => (s ? `${s.state}${s.distributionChannels?.[0]?.crxVersion ? ` v${s.distributionChannels[0].crxVersion}` : ''}` : '无');
async function publishChrome(conf, zip) {
  need(conf, ['CHROME_PUBLISHER_ID', 'CHROME_ITEM_ID', 'CHROME_SERVICE_ACCOUNT'], 'Chrome');
  const token = await googleToken(conf.CHROME_SERVICE_ACCOUNT);
  const st = await chromeStatus(conf, token);
  if (args.has('--check') || args.has('--status')) {
    return console.log(`✓ Chrome 凭据有效。已发布：${rev(st.publishedItemRevisionStatus)}；审核中：${rev(st.submittedItemRevisionStatus)}`);
  }
  const name = `publishers/${conf.CHROME_PUBLISHER_ID}/items/${conf.CHROME_ITEM_ID}`;
  console.log('… Chrome：上传扩展包');
  let r = await fetch(`${CWS}/upload/v2/${name}:upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' }, body: readFileSync(zip) });
  let j = await r.json();
  if (!r.ok) die(`Chrome 上传被拒绝（HTTP ${r.status}）：${JSON.stringify(j)}`);
  let state = j.uploadState;
  for (let i = 0; state === 'IN_PROGRESS' && i < 120; i++) {
    await sleep(5000);
    state = (await chromeStatus(conf, token)).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') die(`Chrome 上传失败：${state}`);
  console.log('… Chrome：提交审核');
  r = await fetch(`${CWS}/v2/${name}:publish`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }) });
  j = await r.json();
  if (!r.ok) die(`Chrome 提交被拒绝（HTTP ${r.status}）：${JSON.stringify(j)}`);
  console.log(`✓ Chrome：v${version} ${j.state === 'PENDING_REVIEW' ? '已提交审核，通过后自动发布' : `状态 ${j.state}`}`);
}

const conf = readConf();
if (args.has('--status')) {
  if (only.includes('chrome')) await publishChrome(conf, null);
  if (only.includes('edge')) console.log(`Edge 没有查询审核状态的接口，请到 Partner Center 查看：https://partner.microsoft.com/dashboard/microsoftedge/overview`);
  process.exit(0);
}
const zip = execFileSync('bash', [path.join(ROOT, 'scripts/package.sh')], { encoding: 'utf8' }).trim();
const manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
if ('key' in manifest) die('扩展包里还带着 manifest 的 key，商店会拒收');
console.log(`扩展包：${zip}（v${manifest.version}）`);
for (const store of only) await (store === 'edge' ? publishEdge : publishChrome)(conf, zip);
