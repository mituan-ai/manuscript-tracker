// mituan 投稿追踪 · 后台（service worker）
// 定时调度各平台适配器，合并结果，状态变化时发通知。

import rex from './adapters/rex.js';
import scholarone from './adapters/scholarone.js';
import paperplaza from './adapters/paperplaza.js';
import tcct from './adapters/tcct.js';
import elsevier, { parseTrackId } from './adapters/elsevier.js';
import web, { toItems, originPattern } from './adapters/web.js';
import { siteOf, NATIVE_HOSTS } from './lib/scan.js';
import { extract } from './lib/dom.js';
import { log } from './lib/log.js';
import { CREDENTIAL_ORIGINS, sleep, request, formWith } from './lib/http.js';
import { getCredential, setCredential, removeCredential, credentialSummary, setElsevierIds, getElsevierIds, readVault, clearVault } from './lib/vault.js';
import { getSettings, saveSettings, getPlatformState, patchPlatformState, updatePlatformState, setPlatformStatus, applyResults, markAllSeen, deleteItem } from './lib/store.js';
import { getWorker, isWorkerTab, onWorkerPage, onWorkerAttempt, closeAllWorkers } from './lib/worker.js';
import { stageOf, STAGES, hideDuplicates, baseManuscriptId } from './lib/normalize.js';
import { familyOf, ACCOUNT_LABEL } from './lib/view.js';
import { L, B, loc, pair, mapB, setLang, resolveLang } from './lib/i18n.js';

// 顺序有意义：ReX 先跑，ScholarOne 才知道要查哪些站点
const ADAPTERS = [rex, scholarone, paperplaza, tcct, elsevier, web];
const byId = Object.fromEntries(ADAPTERS.map((a) => [a.id, a]));
const TICK_MINUTES = 10;

// 后台生成的文字（通知、平台状态）跟随设置里的语言：auto = 浏览器界面语言
const syncLang = async () => setLang(resolveLang((await getSettings()).lang));
syncLang();

// ───────────────────────── 运行队列 ─────────────────────────

let queue = Promise.resolve();
const waiting = new Map(); // 排队中、还没开始的：平台 → 选项
let current = null; // 正在运行的平台
let epoch = 0; // "全部清除"后丢弃还在路上的结果

/** 同一平台已在排队时合并请求；正在运行时再排一次（例如运行中刚保存了新密码）。 */
function enqueue(id, opts = {}) {
  const w = waiting.get(id);
  if (w) {
    w.force ||= !!opts.force;
    return queue;
  }
  const job = { force: !!opts.force, reason: opts.reason || '定时' };
  waiting.set(id, job);
  queue = queue
    .catch(() => {})
    .then(async () => {
      waiting.delete(id);
      current = id;
      try {
        await runPlatform(id, job);
      } finally {
        current = null;
      }
    });
  return queue;
}

const busy = () => [...new Set([...(current ? [current] : []), ...waiting.keys()])];

/** 平台用到的账号指纹：账号或密码更新后会变。 */
function credStamp(adapter, creds) {
  return Object.entries(creds)
    .filter(([k]) => (adapter.credIds || []).some((c) => k === c || k.startsWith(`${c}:`)))
    .map(([k, v]) => `${k}@${v.savedAt}`)
    .sort()
    .join(',');
}

/** 密码被拒后、你更新账号之前，不再自动拿同一个密码去试（避免账号被锁）。 */
async function stillRejected(adapter, p) {
  if (p.status !== 'auth-rejected' || p.rejectedStamp == null) return false;
  return p.rejectedStamp === credStamp(adapter, (await credentialSummary()).creds);
}

async function makeCtx(adapter, { force = false } = {}) {
  const settings = await getSettings();
  return {
    platform: adapter.id,
    settings,
    force,
    log: (msg, level) => log(adapter.label, msg, level),
    getCred: (id) => getCredential(id),
    getState: (id = adapter.id) => getPlatformState(id),
    setState: (patch) => patchPlatformState(adapter.id, patch),
    updateState: (fn) => updatePlatformState(adapter.id, fn),
    extract,
  };
}

async function runPlatform(id, { force = false, reason = '定时' } = {}) {
  const adapter = byId[id];
  const ctx = await makeCtx(adapter, { force });
  const { platforms = {} } = await chrome.storage.local.get('platforms');
  const prev = platforms[id] || {};
  if (!(await adapter.enabled(ctx))) {
    await setPlatformStatus(id, { status: 'disabled', message: B('未配置', 'Not set up'), running: false });
    return;
  }
  if (!force && (await stillRejected(adapter, prev))) {
    await log(adapter.label, '账号上次被拒绝，更新密码或在追踪面板的账号页点「立即查询」后再试');
    return;
  }
  await setPlatformStatus(id, { running: true });
  await log(adapter.label, `开始查询（${reason}）`);
  const started = Date.now();
  const myEpoch = epoch;
  try {
    const res = await adapter.run(ctx);
    if (myEpoch !== epoch) return; // 运行期间你点了"全部清除"
    if (res.skipped) {
      await setPlatformStatus(id, { status: prev.status === 'ok' ? 'ok' : 'skipped', message: res.note, running: false, lastRunAt: Date.now() - (byInterval(ctx, id) - 15) * 60000 });
      await log(adapter.label, res.note);
      return;
    }
    const changes = await applyResults(id, res.items, { firstRun: !prev.lastOkAt });
    const warn = res.warnings?.length ? B(res.warnings.map((w) => pair(w)[0]).join('；'), res.warnings.map((w) => pair(w)[1]).join('; ')) : '';
    await setPlatformStatus(id, {
      windowId: res.attention?.windowId || null,
      rejectedStamp: null,
      status: warn ? 'partial' : 'ok',
      message: warn || res.note || B(`${res.items.length} 篇`, `${res.items.length} manuscript${res.items.length === 1 ? '' : 's'}`),
      running: false,
      lastRunAt: Date.now(),
      lastOkAt: Date.now(),
      count: res.items.length,
      ms: Date.now() - started,
    });
    await log(adapter.label, `完成：${res.items.length} 篇，${changes.length} 处变化，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`);
    await notifyChanges(changes);
    // 部分站点留了窗口给你处理（例如人机验证）
    if (res.attention) await notifyAttention(adapter, res.attention);
  } catch (e) {
    if (myEpoch !== epoch) return;
    const code = e.code || 'error';
    const rejectedStamp = code === 'auth-rejected' ? credStamp(adapter, (await credentialSummary()).creds) : null;
    await setPlatformStatus(id, { status: code, message: e.message, running: false, lastRunAt: Date.now(), windowId: e.windowId || null, rejectedStamp });
    await log(adapter.label, mapB(e.message, (t, l) => (l === 'zh' ? `失败（${code}）：${t}` : `Failed (${code}): ${t}`)), 'error');
    if (code === 'auth-rejected' || code === 'need-human') await notifyAttention(adapter, e);
    if (code === 'error') console.error(e);
  } finally {
    if (myEpoch !== epoch) await setPlatformStatus(id, { running: false });
    await updateBadge();
  }
}

function byInterval(ctx, id) {
  return ctx.settings.intervals[id] || 360;
}

async function runDue(reason = '定时') {
  const settings = await getSettings();
  const { platforms = {} } = await chrome.storage.local.get('platforms');
  const { creds } = await credentialSummary();
  for (const a of ADAPTERS) {
    const p = platforms[a.id] || {};
    const interval = (settings.intervals[a.id] || 360) * 60000;
    // 密码被拒：等你更新账号；需要人工处理：12 小时后再试
    if (p.status === 'auth-rejected' && p.rejectedStamp != null && p.rejectedStamp === credStamp(a, creds)) continue;
    if (p.status === 'auth-rejected' || p.status === 'need-human') {
      if (Date.now() - (p.lastRunAt || 0) < 12 * 3600000) continue;
    }
    if (!p.lastRunAt || Date.now() - p.lastRunAt >= interval * (0.9 + Math.random() * 0.2)) enqueue(a.id, { reason });
  }
}

function runAll(reason, force = false) {
  for (const a of ADAPTERS) enqueue(a.id, { force, reason });
}

// ───────────────────────── 通知与角标 ─────────────────────────

async function notifyChanges(changes) {
  if (!changes.length || !(await getSettings()).notify) return;
  // 同一篇稿件 ScholarOne 和 IEEE Author Portal 都有时，只按 ScholarOne 通知一次
  const { items = {} } = await chrome.storage.local.get('items');
  const s1Ids = new Set(Object.values(items).filter((i) => i.platform === 'scholarone').map((i) => baseManuscriptId(i.manuscriptId)));
  changes = changes.filter((c) => c.item.platform !== 'rex' || !s1Ids.has(baseManuscriptId(c.item.manuscriptId)));
  if (!changes.length) return;
  await syncLang();
  const lines = changes.map((c) => {
    const it = c.item;
    const head = `${it.venue || it.platform} ${it.manuscriptId || ''}`.trim();
    return c.type === 'new' ? L(`新稿件 ${head}：${it.status}`, `New manuscript ${head}: ${it.status}`) : L(`${head}：${c.from} → ${it.status}`, `${head}: ${c.from} → ${it.status}`);
  });
  const n = changes.length;
  chrome.notifications.create(`changes:${Date.now()}`, {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: n === 1 ? L('投稿状态有变化', 'Manuscript status changed') : L(`${n} 篇投稿状态有变化`, `${n} manuscripts changed status`),
    message: lines.slice(0, 4).join('\n') + (lines.length > 4 ? L(`\n……等 ${lines.length} 条`, `\n…and ${lines.length - 4} more`) : ''),
    priority: 2,
  });
}

async function notifyAttention(adapter, e) {
  if (!(await getSettings()).notify) return;
  await syncLang();
  const id = e.windowId ? `window:${e.windowId}` : `account:${familyOf(adapter.id).id}:${Date.now()}`;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: e.code === 'auth-rejected' ? L(`${ACCOUNT_LABEL[adapter.id]}的密码被拒绝`, `${ACCOUNT_LABEL[adapter.id]}: password rejected`) : L(`${familyOf(adapter.id).name}登录需要处理`, `${familyOf(adapter.id).name}: sign-in needs attention`),
    message: loc(e.message) + (e.windowId ? L('\n点击打开该窗口。', '\nClick to open the window.') : L('\n点击打开追踪面板处理。', '\nClick to open the dashboard.')),
    priority: 2,
    requireInteraction: !!e.windowId,
  });
}

/** 打开追踪面板（已经开着就切过去），可以带上页签，例如 #accounts/ieee。 */
async function openPanel(hash = '') {
  const base = chrome.runtime.getURL('ui/options.html');
  const [ctx] = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] })).filter((c) => c.documentUrl?.startsWith(base));
  if (ctx) {
    await chrome.tabs.update(ctx.tabId, { active: true, url: base + hash });
    await chrome.windows.update(ctx.windowId, { focused: true });
  } else {
    const win = await chrome.windows.getLastFocused().catch(() => null);
    if (win && win.type === 'normal') await chrome.tabs.create({ url: base + hash, windowId: win.id });
    else await chrome.windows.create({ url: base + hash, focused: true }); // 关掉所有窗口后点通知
  }
}

chrome.notifications.onClicked.addListener(async (nid) => {
  chrome.notifications.clear(nid);
  if (nid.startsWith('window:')) {
    const winId = Number(nid.split(':')[1]);
    await chrome.windows.update(winId, { state: 'normal', focused: true }).catch(() => openPanel());
  } else if (nid.startsWith('account:')) openPanel(`#accounts/${nid.split(':')[1]}`);
  else openPanel();
});

async function updateBadge() {
  const { items = {}, platforms = {} } = await chrome.storage.local.get(['items', 'platforms']);
  const unseen = hideDuplicates(Object.values(items)).filter((i) => i.unseen).length;
  const attention = Object.values(platforms).some((p) => ['auth-rejected', 'need-human', 'parse-error'].includes(p.status));
  await chrome.action.setBadgeBackgroundColor({ color: attention && !unseen ? '#dc2626' : '#2563eb' });
  await chrome.action.setBadgeText({ text: unseen ? String(unseen) : attention ? '!' : '' });
}

// ───────────────────────── 调度 ─────────────────────────

async function ensureAlarms() {
  if (!(await chrome.alarms.get('tick'))) chrome.alarms.create('tick', { periodInMinutes: TICK_MINUTES, delayInMinutes: 1 });
}

// 每次 service worker 启动都检查：闹钟丢了就补上；上次被终止时没跑完的平台不再显示"查询中"
ensureAlarms();
chrome.storage.local.get('platforms').then(async ({ platforms = {} }) => {
  for (const [id, p] of Object.entries(platforms)) if (p.running && !busy().includes(id)) await setPlatformStatus(id, { running: false });
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  // 第一次安装：马上打开追踪面板告诉用户装好了、下一步做什么（更新、重新加载时不打开）
  if (reason === 'install') openPanel('#welcome').catch(() => {});
  await ensureAlarms();
  await syncWebScripts();
  await updateBadge();
  await injectIntoOpenTabs();
  chrome.alarms.create('installed', { delayInMinutes: 0.5 });
});

/** 安装或更新后，给已经打开的平台页面补上页面脚本：你已登录的 ScholarOne 页面可以马上提供会话令牌。 */
const CONTENT_MATCHES = chrome.runtime.getManifest().content_scripts.flatMap((c) => c.matches);

function injectInto(tabId) {
  // 页面脚本自带防重复；休眠中的标签页注入会一直挂起，所以限时
  const run = chrome.scripting.executeScript({ target: { tabId }, files: ['content/login.js'] }).catch(() => {});
  return Promise.race([run, sleep(5000)]);
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: CONTENT_MATCHES });
  await Promise.all(tabs.filter((t) => !t.discarded && !t.frozen).map((t) => injectInto(t.id)));
}

// 休眠的标签页等你切回去时再补
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const [hit] = await chrome.tabs.query({ url: CONTENT_MATCHES }).then((ts) => ts.filter((t) => t.id === tabId));
  if (hit && !isWorkerTab(tabId)) injectInto(tabId);
});
chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await syncWebScripts();
  chrome.alarms.create('startup', { delayInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'tick') runDue('定时');
  else if (a.name === 'startup') runDue('浏览器启动');
  else if (a.name === 'installed') runDue('安装或更新');
  else if (a.name.startsWith('soon:')) enqueue(a.name.slice(5), { reason: '新保存的账号' });
});

// ───────────────────────── 页面脚本的消息 ─────────────────────────

function originAllowed(credPlatform, url) {
  try {
    return (CREDENTIAL_ORIGINS[credPlatform] || []).includes(new URL(url).origin);
  } catch {
    return false;
  }
}

async function onContentMessage(msg, sender) {
  const tabId = sender.tab?.id;
  switch (msg.type) {
    case 'tracker:hello': {
      const w = getWorker(tabId);
      if (!w) {
        await settleCapture(tabId, sender.url, !!msg.loginForm, !!msg.loginError);
        await noticeSession(sender.url, !!msg.loginForm);
        return { role: 'normal', capture: (await getSettings()).captureLogins };
      }
      const credPlatform = w.platform === 'rex' ? 'ieee' : w.platform;
      if (!originAllowed(credPlatform, sender.url)) return { role: 'worker', platform: w.platform };
      const cred = w.credId ? await getCredential(w.platform === 'scholarone' ? `scholarone:${w.site}` : w.credId) : null;
      return { role: 'worker', platform: w.platform, site: w.site, username: cred?.username, password: cred?.password };
    }
    case 'tracker:page':
      onWorkerPage(tabId, msg.page);
      return { ok: true };
    case 'tracker:attempt':
      return { ok: onWorkerAttempt(tabId, msg) };
    case 'tracker:capture':
      return captureCredential(msg, sender);
    case 'tracker:webpage':
      return onWebPage(msg, sender);
    case 'tracker:s1tokens': {
      if (isWorkerTab(tabId) || !msg.site || !msg.roleId) return { ok: false };
      const st = await getPlatformState('scholarone');
      await patchPlatformState('scholarone', { tokens: { ...(st.tokens || {}), [msg.site]: { pairs: msg.pairs, roleId: msg.roleId, at: Date.now(), from: 'page' } } });
      await retrySoonIfStuck('scholarone', 15);
      return { ok: true };
    }
  }
  return null;
}

/**
 * 你在网页上手动登录时，记下账号用于以后的自动登录。
 * 点登录的那一刻还不知道密码对不对，所以先暂存在内存（storage.session，不落盘），
 * 等同一个标签页打开的下一个页面不再是登录页，才算登录成功、加密保存。
 */
async function captureCredential(msg, sender) {
  if (isWorkerTab(sender.tab?.id) || !(await getSettings()).captureLogins) return { ok: false };
  if (!originAllowed(msg.platform, sender.url) || !msg.username || !msg.password) return { ok: false };
  const staged = { platform: msg.platform, site: msg.site, username: msg.username, password: msg.password, host: new URL(sender.url).host, at: Date.now() };
  await chrome.storage.session.set({ [`capture:${sender.tab.id}`]: staged });
  return { ok: true, pending: true };
}

async function settleCapture(tabId, url, loginForm, loginError) {
  const key = `capture:${tabId}`;
  const c = (await chrome.storage.session.get(key))[key];
  if (!c) return;
  const fresh = Date.now() - c.at < 5 * 60000;
  // 跳到了别的站的登录页（例如统一登录的中转），继续等
  if (fresh && loginForm && new URL(url).host !== c.host) return;
  await chrome.storage.session.remove(key);
  // 又回到登录页，或出现登录错误页（PaperPlaza 密码错时是一个没有密码框的错误页），多半是密码错了；太久没有结果也丢弃
  if (!fresh || loginForm || loginError) return;
  await saveCaptured(c);
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`capture:${tabId}`));

/** 你在已登录的页面上（ReX 看板、TCCT 作者工作区）时，说明浏览器里又有会话了，下一轮可以再试。 */
async function noticeSession(url, loginForm) {
  if (loginForm || !url) return;
  const u = new URL(url);
  const id =
    u.host === 'ieee.submission.researchexchange.com' && u.pathname.startsWith('/submission') ? 'rex'
    : u.host === 'cms.amss.ac.cn' && u.pathname.endsWith('/author.php') ? 'tcct'
    : null;
  if (!id) return;
  if ((await getPlatformState(id)).noSession) await patchPlatformState(id, { noSession: false });
  await retrySoonIfStuck(id, 1);
}

/** 你在网页上处理好了（登录、过了验证码），平台却还停在"需要处理"时，不等 12 小时，尽快再查一次。 */
async function retrySoonIfStuck(id, minutes) {
  const { platforms = {} } = await chrome.storage.local.get('platforms');
  const p = platforms[id] || {};
  if (!['need-human', 'need-credential', 'blocked', 'disabled'].includes(p.status) || busy().includes(id)) return;
  chrome.alarms.create(`soon:${id}`, { delayInMinutes: minutes });
}

async function saveCaptured(c) {
  const { creds = {} } = await readVault();
  let id = c.platform;
  if (c.platform === 'scholarone') {
    const def = creds.scholarone;
    if (def && (def.username !== c.username || def.password !== c.password) && c.site) id = `scholarone:${c.site}`;
  }
  const cur = creds[id];
  const changed = !(cur && cur.username === c.username && cur.password === c.password);
  if (changed) {
    await setCredential(id, c.username, c.password, 'captured');
    const label = { scholarone: 'ScholarOne', ieee: 'IEEE', paperplaza: 'PaperPlaza', tcct: 'TCCT' }[c.platform];
    await log('账号', `已记住 ${label}${id.includes(':') ? `（${c.site}）` : ''} 的账号（来自你的手动登录）`);
    if ((await getSettings()).notify) {
      await syncLang();
      chrome.notifications.create(`captured:${Date.now()}`, {
        type: 'basic',
        iconUrl: 'icons/128.png',
        title: L('mituan 投稿追踪', 'mituan Manuscript Tracker'),
        message: L(`已保存 ${label} 的账号，之后将自动登录查询。`, `Saved your ${label} account. It will be used to sign in automatically.`),
        priority: 0,
      });
    }
  }
  // 这个密码刚刚登录成功：之前"被拒"的记录作废
  const adapterId = c.platform === 'ieee' ? 'rex' : c.platform;
  if (adapterId === 'rex') await patchPlatformState('rex', { noSession: false, rejected: null });
  if (adapterId === 'tcct') await patchPlatformState('tcct', { noSession: false });
  if (adapterId === 'scholarone' && c.site) {
    const { [c.site]: _, ...rest } = (await getPlatformState('scholarone')).rejected || {};
    await patchPlatformState('scholarone', { rejected: rest });
  }
  const { platforms = {} } = await chrome.storage.local.get('platforms');
  const p = platforms[adapterId] || {};
  if (p.rejectedStamp) await setPlatformStatus(adapterId, { rejectedStamp: null });
  // ScholarOne 不立刻查：你此刻正在用它
  if (adapterId !== 'scholarone' && (changed || p.status !== 'ok')) chrome.alarms.create(`soon:${adapterId}`, { delayInMinutes: 1 });
}

// ───────────────────────── 其他投稿网站（通用识别） ─────────────────────────

const WEB_SCRIPT = 'web-capture';
const cut = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** 页面脚本只注册到你添加过、并允许扩展访问的网站。 */
async function syncWebScripts() {
  const { pages = {} } = await getPlatformState('web');
  const matches = [];
  for (const pattern of new Set(Object.values(pages).map((p) => originPattern(p.url))))
    if (await chrome.permissions.contains({ origins: [pattern] })) matches.push(pattern);
  const [cur] = await chrome.scripting.getRegisteredContentScripts({ ids: [WEB_SCRIPT] });
  if (!matches.length) {
    if (cur) await chrome.scripting.unregisterContentScripts({ ids: [WEB_SCRIPT] });
    return;
  }
  const def = { id: WEB_SCRIPT, matches, js: ['content/capture.js'], runAt: 'document_idle' };
  await (cur ? chrome.scripting.updateContentScripts([def]) : chrome.scripting.registerContentScripts([def]));
}

chrome.permissions.onAdded.addListener(async (p) => {
  await syncWebScripts();
  if (p.origins?.length && (await web.enabled(await makeCtx(web)))) enqueue('web', { force: true, reason: '允许后台更新' });
});
chrome.permissions.onRemoved.addListener(() => syncWebScripts());

/** 弹窗或页面脚本识别出的稿件：记下网站，合并稿件。first 为 true 时只入库，不算"新稿件"。 */
async function mergeWebRows(site, rows, { url, journal, first = false } = {}) {
  const clean = rows.slice(0, 300).map((r) => ({
    id: cut(r.id, 40), title: cut(r.title, 400), status: cut(r.status, 200),
    submitted: cut(r.submitted, 40) || null, updated: cut(r.updated, 40) || null, journal: cut(r.journal, 120) || null,
  })).filter((r) => r.status && (r.id || r.title));
  const st = await updatePlatformState('web', (cur) => {
    const pages = { ...(cur.pages || {}) };
    const prev = pages[site];
    const page = prev ? { ...prev } : { site, url, journal: journal || site, addedAt: Date.now(), more: [] };
    if (journal) page.journal = journal;
    // 同一网站的其他列表页（例如另一个稿件文件夹）也记下，后台一起刷新
    if (prev && url && url !== page.url && !(page.more || []).includes(url)) page.more = [...(page.more || []), url].slice(-5);
    pages[site] = { ...page, status: 'ok', message: null, lastOkAt: Date.now(), count: clean.length };
    return { ...cur, pages };
  });
  const page = st.pages[site];
  const changes = await applyResults('web', toItems(page, clean), { firstRun: first });
  await notifyChanges(changes);
  if (!busy().includes('web')) await setPlatformStatus('web', { status: 'ok', message: null, lastRunAt: Date.now(), lastOkAt: Date.now() });
  await updateBadge();
  return page;
}

/** 你打开已添加网站的页面时，页面脚本把页面交过来识别。 */
async function onWebPage(msg, sender) {
  if (!sender.url || isWorkerTab(sender.tab?.id)) return { ok: false };
  const site = siteOf(sender.url);
  const page = (await getPlatformState('web')).pages?.[site];
  if (!page || new URL(page.url).origin !== new URL(sender.url).origin) return { ok: false };
  const scan = await extract('webPage', String(msg.html || ''), sender.url);
  if (!scan.rows.length) return { ok: true, rows: 0 };
  await mergeWebRows(site, scan.rows, { url: sender.url.split('#')[0] });
  return { ok: true, rows: scan.rows.length };
}

async function removeWebSite(site) {
  await updatePlatformState('web', (cur) => {
    const { [site]: _, ...pages } = cur.pages || {};
    return { ...cur, pages };
  });
  const { items = {} } = await chrome.storage.local.get('items');
  for (const k of Object.keys(items)) if (k.startsWith(`web:${site}:`)) await deleteItem(k);
  await syncWebScripts();
}

const sameOrigin = (url, origin) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

// ───────────────────────── 追踪面板与弹窗的消息 ─────────────────────────

async function webPages() {
  const { pages = {} } = await getPlatformState('web');
  return Promise.all(
    Object.values(pages)
      .sort((a, b) => a.addedAt - b.addedAt)
      .map(async (p) => ({ ...p, host: new URL(p.url).hostname, granted: await chrome.permissions.contains({ origins: [originPattern(p.url)] }) })),
  );
}

async function uiState() {
  const all = await chrome.storage.local.get(['items', 'platforms', 'logs']);
  const s1 = await getPlatformState('scholarone');
  const rexState = await getPlatformState('rex');
  const tcctState = await getPlatformState('tcct');
  return {
    items: all.items || {},
    platforms: all.platforms || {},
    settings: await getSettings(),
    creds: await credentialSummary(),
    elsevierIds: (await getElsevierIds()).map((x) => x.slice(0, 8) + '…'),
    discovered: { scholaroneSites: [...new Set([...(rexState.sites || []), ...Object.keys(s1.tokens || {})])], siteNames: rexState.siteNames || {}, tcctConfids: tcctState.confids || [] },
    s1Rejected: Object.keys(s1.rejected || {}),
    web: await webPages(),
    adapters: ADAPTERS.map((a) => ({ id: a.id, label: a.label, openUrl: a.openUrl })),
    stages: STAGES,
    running: busy(),
  };
}

async function onUiMessage(msg) {
  switch (msg.type) {
    case 'ui:state':
      return uiState();
    case 'ui:refresh':
      if (msg.id) enqueue(msg.id, { force: true, reason: '手动' });
      else runAll('手动');
      return { ok: true };
    case 'ui:saveCred': {
      const id = String(msg.id || '');
      if (!/^(scholarone(:[\w-]+)?|ieee|paperplaza|tcct)$/.test(id) || !msg.username || !msg.password) return { ok: false, error: L('参数不完整', 'Incomplete parameters') };
      await setCredential(id, msg.username.trim(), msg.password, 'manual');
      await log('账号', `已保存 ${id} 的账号`);
      const adapterId = id === 'ieee' ? 'rex' : id.split(':')[0];
      if (adapterId === 'rex' || adapterId === 'tcct') await patchPlatformState(adapterId, { noSession: false });
      enqueue(adapterId, { force: true, reason: '保存账号后验证' });
      if (adapterId === 'rex') enqueue('scholarone', { force: true, reason: '保存账号后验证' });
      return { ok: true };
    }
    case 'ui:deleteCred': {
      const id = String(msg.id);
      await removeCredential(id);
      await log('账号', `已删除 ${id} 的账号`);
      enqueue(id === 'ieee' ? 'rex' : id.split(':')[0], { reason: '删除账号后更新状态' });
      return { ok: true };
    }
    case 'ui:saveSettings': {
      const next = await saveSettings(msg.patch || {});
      return { ok: true, settings: next };
    }
    case 'ui:setElsevier': {
      const ids = String(msg.text || '')
        .split(/\s+/)
        .map(parseTrackId)
        .filter(Boolean);
      const keep = msg.append ? await getElsevierIds() : [];
      await setElsevierIds([...keep, ...ids]);
      enqueue('elsevier', { force: true, reason: '更新 Track 链接' });
      return { ok: true, count: ids.length };
    }
    case 'ui:webAdd': {
      const u = new URL(String(msg.url));
      if (!/^https?:$/.test(u.protocol) || NATIVE_HOSTS.test(u.hostname)) return { ok: false, error: L('这个网站不需要这样添加', 'This site does not need to be added this way') };
      const site = siteOf(u.href);
      const first = !(await getPlatformState('web')).pages?.[site];
      const page = await mergeWebRows(site, Array.isArray(msg.rows) ? msg.rows : [], { url: u.href.split('#')[0], journal: cut(msg.journal, 120), first });
      if (Array.isArray(msg.folders))
        await updatePlatformState('web', (cur) => {
          const p = cur.pages[site];
          const more = [...new Set([...(p.more || []), ...msg.folders.map(String).filter((f) => sameOrigin(f, u.origin))])].slice(-5);
          return { ...cur, pages: { ...cur.pages, [site]: { ...p, more } } };
        });
      if (first) await log('其他投稿网站', `已添加 ${page.journal}（${u.hostname}）`);
      await syncWebScripts();
      return { ok: true, first, journal: page.journal };
    }
    case 'ui:webRemove': {
      const site = String(msg.site);
      const page = (await getPlatformState('web')).pages?.[site];
      if (!page) return { ok: false };
      await removeWebSite(site);
      // 同一网址下没有别的期刊了，就收回访问权限
      const others = Object.values((await getPlatformState('web')).pages || {}).some((p) => originPattern(p.url) === originPattern(page.url));
      if (!others) await chrome.permissions.remove({ origins: [originPattern(page.url)] }).catch(() => {});
      await log('其他投稿网站', `已移除 ${page.journal}`);
      return { ok: true };
    }
    case 'ui:markSeen':
      await markAllSeen();
      await updateBadge();
      return { ok: true };
    case 'ui:deleteItem':
      await deleteItem(String(msg.key));
      return { ok: true };
    case 'ui:focusWindow':
      await chrome.windows.update(msg.windowId, { state: 'normal', focused: true }).catch(() => openPanel());
      return { ok: true };
    case 'ui:clearAll':
      epoch++; // 正在运行的查询结果不再写回
      await closeAllWorkers();
      await clearVault();
      await chrome.storage.local.clear();
      await syncWebScripts();
      // 收回为其他投稿网站授予的访问权限（清单里固定的那些不受影响）
      const fixed = new Set(chrome.runtime.getManifest().host_permissions);
      const extra = ((await chrome.permissions.getAll()).origins || []).filter((o) => !fixed.has(o));
      if (extra.length) await chrome.permissions.remove({ origins: extra }).catch(() => {});
      await chrome.storage.session.clear(); // 暂存中、还没确认的手动登录
      await chrome.alarms.clearAll();
      await ensureAlarms();
      await updateBadge();
      return { ok: true };
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type || msg.target === 'offscreen') return false;
  const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('ui/'));
  const handler = msg.type.startsWith('ui:') ? (fromExtensionPage ? onUiMessage : null) : msg.type.startsWith('tracker:') && sender.tab ? onContentMessage : null;
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.items) updateBadge();
  if (changes.settings) syncLang();
});

// 调试用：在扩展的 service worker 控制台里可以直接调用
globalThis.tracker = { runPlatform, runAll, runDue, enqueue, stageOf, extract, request, formWith };
