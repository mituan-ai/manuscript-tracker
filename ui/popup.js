// 弹窗：一眼看到各期刊里进行中、以及 30 天内刚有结果的稿件。账号、全部稿件和设置在追踪面板里。
import { send, esc, ago, prepareItems, isActive, isRecentResult, groupByJournal, problems, lastCheckedAt, msRow, journalHead, ICON, openPanel, BRAND, footerHtml, L, localizeAttrs, setHtml, onlyLogs } from './common.js';
import { scanPage, siteOf, originPattern, NATIVE_HOSTS } from '../lib/scan.js';

const $ = (s) => document.querySelector(s);

function alertHtml(p) {
  const btn = p.windowId
    ? `<button class="sm" data-window="${Number(p.windowId)}">${L('打开窗口', 'Open window')}</button>`
    : `<button class="sm" data-panel="#accounts/${esc(p.family)}">${L('去处理', 'Resolve')}</button>`;
  return `<div class="banner${p.level === 'warn' ? ' warn' : ''}"><span class="ico">!</span><div class="grow"><b>${esc(p.title)}</b>${p.level === 'action' && p.detail ? `<div class="small">${esc(p.detail)}</div>` : ''}</div>${p.level === 'action' ? btn : ''}</div>`;
}

async function render() {
  const s = await send('ui:state');
  if (!s) return;
  const running = s.running.length > 0;
  $('#refresh').classList.toggle('spin', running);
  $('#refresh').disabled = running;

  // 只提示要你动手的；暂时失败的会自动重试，在追踪面板里能看到
  setHtml($('#alerts'), problems(s).filter((p) => p.level === 'action').map(alertHtml).join(''));

  const all = prepareItems(s.items);
  const shown = all.filter((it) => isActive(it) || isRecentResult(it));
  const active = all.filter(isActive).length;
  const groups = groupByJournal(shown);
  const checked = lastCheckedAt(s);
  setHtml(
    $('#summary'),
    all.length
    ? `<span>${L(`<b>${active}</b> 篇进行中${groups.length ? ` · ${groups.length} 本期刊` : ''}`, `<b>${active}</b> in progress${groups.length ? ` · ${groups.length} journal${groups.length === 1 ? '' : 's'}` : ''}`)}</span><span class="when">${running ? L('正在查询…', 'Checking…') : checked ? L(`${ago(checked)}查询`, `Checked ${ago(checked)}`) : ''}</span>`
      : '',
  );

  if (!all.length) {
    const connected = Object.keys(s.creds.creds).length || s.creds.elsevierCount || s.web.length;
    setHtml(
      $('#list'),
      connected
      ? `<div class="card welcome"><b>${running ? L('正在查询你的稿件…', 'Checking your manuscripts…') : L('还没有查到稿件', 'No manuscripts found yet')}</b><p>${running ? L('首次查询通常需要几十秒。', 'The first check can take up to a minute.') : L('点右上角的刷新按钮立即查询。', 'Click the refresh button at the top right to check now.')}</p></div>`
      : `<div class="card welcome"><img src="logo.svg" alt=""><b>${L('所有投稿，一处追踪', 'All your submissions in one place')}</b>
          <p>${L('连接一次投稿账号，之后自动查询各期刊的审稿状态，有变化就通知你。', 'Connect your submission accounts once. Review status is then checked automatically and you are notified of changes.')}</p>
          <button class="primary" data-panel="#accounts">${L('连接投稿账号', 'Connect accounts')}</button>
          <p class="small">${L('也可以直接去投稿网站正常登录一次，或在任一投稿网站的稿件列表页点这个图标添加。', 'You can also sign in on the submission website once, or click this icon on any manuscript list page to add it.')}</p></div>`,
    );
    return;
  }
  if (!groups.length) {
    setHtml($('#list'), `<div class="card welcome"><b>${L('没有进行中的稿件', 'No manuscripts in progress')}</b><p>${L(`全部 ${all.length} 篇稿件可在追踪面板中查看。`, `All ${all.length} manuscript${all.length === 1 ? '' : 's'} can be viewed in the dashboard.`)}</p><button class="sm" data-panel="#all">${L('查看全部稿件', 'View all manuscripts')}</button></div>`);
    return;
  }
  setHtml(
    $('#list'),
    groups.map((g) => `<section class="journal">${journalHead(g)}${g.items.map((it) => msRow(it, { compact: true })).join('')}</section>`).join('') +
    `<div class="more"><a href="#" data-panel="#all">${L(`查看全部 ${all.length} 篇稿件`, `View all ${all.length} manuscript${all.length === 1 ? '' : 's'}`)}</a></div>`,
  );
}

// ───────── 当前页面：其他投稿网站的稿件列表、Elsevier 追踪页 ─────────
// 点扩展图标时浏览器临时允许读取当前页面（activeTab），不需要事先授权任何网站。

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const here = (html) => ($('#here').innerHTML = html);
const slim = (title, sub, ico = '✓') => here(`<div class="card here slim"><span class="ico">${ico}</span><div class="grow"><b>${title}</b>${sub ? `<div class="small">${sub}</div>` : ''}</div></div>`);

async function readTab(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = r.id || r.title.toLowerCase();
    return !seen.has(k) && seen.add(k);
  });
}

async function detectHere(s) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  if (!tab?.url || !/^https?:/.test(tab.url)) return; // 没有 activeTab 时看不到网址
  const host = new URL(tab.url).hostname;
  if (host === 'track.authorhub.elsevier.com') return elsevierHere(s, tab.url);
  if (host === 'mc.manuscriptcentral.com') {
    // ScholarOne（IEEE 以外的出版社也一样）：登录后进入作者中心，就会记下会话、开始自动查询
    const site = new URL(tab.url).pathname.split('/')[1]?.toLowerCase();
    if (!site) return;
    return s.discovered.scholaroneSites.includes(site) || s.settings.scholaroneSites.includes(site)
      ? slim(L('该期刊已在追踪', 'This journal is being tracked'))
      : slim(L('进入该期刊的作者中心后开始追踪', 'Tracking starts when you open the Author Center'), L('登录后打开 Author Center 即可，之后会自动查询。', 'Sign in and open the Author Center; it is checked automatically from then on.'), 'i');
  }
  if (NATIVE_HOSTS.test(host)) return; // 已有专门支持，打开就会自动更新

  const parse = (html) => scanPage(new DOMParser().parseFromString(html || '', 'text/html'), tab.url);
  let scan;
  try {
    scan = parse(await readTab(tab.id, () => document.documentElement.outerHTML));
  } catch {
    return; // 浏览器自带页面、扩展商店等不允许读取
  }
  let rows = scan.rows;
  if (!rows.length && scan.folders.length) {
    // 文件夹菜单页：在页面里打开各个稿件文件夹（同源请求，用的是你当前的登录）
    const pages = await readTab(tab.id, (urls) => Promise.all(urls.map((u) => fetch(u, { credentials: 'include' }).then((r) => r.text(), () => ''))), [scan.folders.map((f) => f.url)]).catch(() => []);
    rows = uniqueRows((pages || []).flatMap((h) => parse(h).rows));
  }
  if (!rows.length) return;

  const site = siteOf(tab.url);
  const folders = scan.folders.map((f) => f.url);
  const tracked = s.web.find((w) => w.site === site);
  if (tracked) {
    // 已在追踪：顺手用当前页面更新
    await send('ui:webAdd', { url: tab.url, rows, folders });
    grantPattern = originPattern(tab.url);
    const grant = tracked.granted ? '' : ` · <a href="#" id="hereGrant">${L('允许后台更新', 'Allow background updates')}</a>`;
    return slim(L(`正在追踪「${esc(tracked.journal)}」`, `Tracking ${esc(tracked.journal)}`), L(`已根据本页更新 ${rows.length} 篇稿件`, `Updated ${rows.length} manuscript${rows.length === 1 ? '' : 's'} from this page`) + grant);
  }
  here(`<div class="card here">
    <div class="here-head"><span class="ico">${ICON.search}</span><div class="grow"><b>${L(`本页识别到 ${rows.length} 篇稿件`, `${rows.length} manuscript${rows.length === 1 ? '' : 's'} found on this page`)}</b><div class="small">${L('追踪后，状态有变化会出现在这里并通知你', 'Once tracked, status changes appear here and you are notified')}</div></div></div>
    <label>${L('期刊名称', 'Journal name')}<input id="hereJournal" maxlength="120" value="${esc(scan.journal)}"></label>
    <button class="primary" id="hereAdd" type="button">${L('追踪这些稿件', 'Track these manuscripts')}</button>
    <div class="small faint">${L('通用识别，尚未在这个网站实测，状态以投稿网站为准。不需要密码。', 'Generic detection, not yet tested on this site; the submission website is authoritative. No password needed.')}</div>
  </div>`);
  $('#hereAdd').addEventListener('click', () => {
    const journal = $('#hereJournal').value.trim();
    send('ui:webAdd', { url: tab.url, journal, rows, folders });
    // 后台更新要能访问这个网站：权限请求必须在点击的同一时刻发起
    const name = esc(journal || scan.journal);
    const started = L(`已开始追踪「${name}」`, `Now tracking ${name}`);
    chrome.permissions.request({ origins: [originPattern(tab.url)] }).then(
      (ok) => slim(started, ok ? L('之后会在后台自动更新。', 'It will be updated in the background.') : L('未授权访问该网站：仅在你打开此页面并点击扩展图标时更新。', 'Site access not allowed: it is updated only when you open this page and click the extension icon.')),
      () => slim(started, L('仅在你打开此页面并点击扩展图标时更新。', 'It is updated only when you open this page and click the extension icon.')),
    );
  });
  $('#hereJournal').addEventListener('keydown', (e) => e.key === 'Enter' && $('#hereAdd').click());
}

let grantPattern = null; // 「允许后台更新」要请求的网站

function elsevierHere(s, url) {
  const id = UUID.exec(url)?.[0]?.toLowerCase();
  if (!id) return;
  if (s.elsevierIds.some((x) => id.startsWith(x.replace('…', '')))) return slim(L('这篇 Elsevier 稿件已在追踪', 'This Elsevier manuscript is being tracked'));
  here(`<div class="card here">
    <div class="here-head"><span class="ico">${ICON.search}</span><div class="grow"><b>${L('这是一篇 Elsevier 稿件的追踪页', 'This is an Elsevier manuscript tracking page')}</b><div class="small">${L('追踪后会定期查询审稿进度，不需要登录', 'Once tracked, review progress is checked regularly; no sign-in needed')}</div></div></div>
    <button class="primary" id="hereAdd" type="button">${L('追踪这篇稿件', 'Track this manuscript')}</button>
  </div>`);
  $('#hereAdd').addEventListener('click', async () => {
    await send('ui:setElsevier', { text: url, append: true });
    slim(L('已开始追踪这篇 Elsevier 稿件', 'Now tracking this Elsevier manuscript'), L('正在查询，结果将显示在下方。', 'Checking; results will appear below.'));
  });
}

$('#here').addEventListener('click', (e) => {
  if (e.target.id !== 'hereGrant') return;
  e.preventDefault();
  chrome.permissions.request({ origins: [grantPattern] }).then((ok) => ok && slim(L('已允许后台更新', 'Background updates allowed'), L('该网站的稿件将在后台自动更新。', 'Manuscripts on this site will be updated in the background.')), () => {});
});

document.title = L('mituan · 投稿追踪', 'mituan · Manuscript Tracker');
localizeAttrs();
$('#home').href = BRAND.homepage;
$('#refresh').innerHTML = ICON.refresh;
$('#panel').innerHTML = `${ICON.panel}${L('追踪面板', 'Dashboard')}`;
$('#footer').innerHTML = footerHtml();
$('#refresh').addEventListener('click', async () => {
  $('#refresh').classList.add('spin');
  $('#refresh').disabled = true;
  await send('ui:refresh');
  render();
});
$('#panel').addEventListener('click', () => openPanel().then(() => window.close()));
document.body.addEventListener('click', (e) => {
  const p = e.target.closest('[data-panel]');
  if (p) {
    e.preventDefault();
    return openPanel(p.dataset.panel).then(() => window.close());
  }
  const w = e.target.closest('[data-window]');
  if (w) return send('ui:focusWindow', { windowId: Number(w.dataset.window) }).then(() => window.close());
  const row = e.target.closest('.ms[data-key]');
  if (row) openPanel(`#ms=${encodeURIComponent(row.dataset.key)}`).then(() => window.close());
});

let timer;
chrome.storage.onChanged.addListener((changes) => {
  if (onlyLogs(changes)) return; // 运行日志不影响弹窗的内容，见追踪面板里的说明
  clearTimeout(timer);
  timer = setTimeout(render, 300);
});

render().then(() => setTimeout(() => send('ui:markSeen'), 2500));
send('ui:state').then((s) => s && detectHere(s)).catch(() => {});
