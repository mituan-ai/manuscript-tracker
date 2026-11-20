// 弹窗：一眼看到各期刊里进行中、以及 30 天内刚有结果的稿件。账号、全部稿件和设置在追踪面板里。
import { send, esc, ago, prepareItems, isActive, isRecentResult, groupByJournal, problems, lastCheckedAt, msRow, journalHead, ICON, openPanel, BRAND, footerHtml } from './common.js';
import { scanPage, siteOf, originPattern, NATIVE_HOSTS } from '../lib/scan.js';

const $ = (s) => document.querySelector(s);

function alertHtml(p) {
  const btn = p.windowId
    ? `<button class="sm" data-window="${Number(p.windowId)}">打开窗口</button>`
    : `<button class="sm" data-panel="#accounts/${esc(p.family)}">去处理</button>`;
  return `<div class="banner${p.level === 'warn' ? ' warn' : ''}"><span class="ico">!</span><div class="grow"><b>${esc(p.title)}</b>${p.level === 'action' && p.detail ? `<div class="small">${esc(p.detail)}</div>` : ''}</div>${p.level === 'action' ? btn : ''}</div>`;
}

async function render() {
  const s = await send('ui:state');
  if (!s) return;
  const running = s.running.length > 0;
  $('#refresh').classList.toggle('spin', running);
  $('#refresh').disabled = running;

  // 只提示要你动手的；暂时失败的会自动重试，在追踪面板里能看到
  $('#alerts').innerHTML = problems(s).filter((p) => p.level === 'action').map(alertHtml).join('');

  const all = prepareItems(s.items);
  const shown = all.filter((it) => isActive(it) || isRecentResult(it));
  const active = all.filter(isActive).length;
  const groups = groupByJournal(shown);
  const checked = lastCheckedAt(s);
  $('#summary').innerHTML = all.length
    ? `<span><b>${active}</b> 篇进行中${groups.length ? ` · ${groups.length} 本期刊` : ''}</span><span class="when">${running ? '正在查询…' : checked ? `${ago(checked)}查询` : ''}</span>`
    : '';

  if (!all.length) {
    const connected = Object.keys(s.creds.creds).length || s.creds.elsevierCount || s.web.length;
    $('#list').innerHTML = connected
      ? `<div class="card welcome"><b>${running ? '正在查询你的稿件…' : '还没有查到稿件'}</b><p>${running ? '第一次查询通常需要几十秒。' : '点右上角的刷新按钮立即查询。'}</p></div>`
      : `<div class="card welcome"><img src="logo.svg" alt=""><b>所有投稿，一处追踪</b>
          <p>连接一次投稿账号，之后自动查询各期刊的审稿状态，有变化就通知你。</p>
          <button class="primary" data-panel="#accounts">连接投稿账号</button>
          <p class="small">也可以直接去投稿网站正常登录一次，或在任一投稿网站的稿件列表页点这个图标添加。</p></div>`;
    return;
  }
  if (!groups.length) {
    $('#list').innerHTML = `<div class="card welcome"><b>没有进行中的稿件</b><p>全部 ${all.length} 篇稿件都在追踪面板里。</p><button class="sm" data-panel="#all">查看全部稿件</button></div>`;
    return;
  }
  $('#list').innerHTML =
    groups.map((g) => `<section class="journal">${journalHead(g)}${g.items.map((it) => msRow(it, { compact: true })).join('')}</section>`).join('') +
    `<div class="more"><a href="#" data-panel="#all">查看全部 ${all.length} 篇稿件</a></div>`;
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
      ? slim('这个期刊正在追踪')
      : slim('进入这个期刊的作者中心就会开始追踪', '登录后打开 Author Center 即可，之后会自动查询。', 'i');
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
    return slim(`正在追踪「${esc(tracked.journal)}」`, `刚刚用这个页面更新了 ${rows.length} 篇稿件${tracked.granted ? '' : ' · <a href="#" id="hereGrant">允许后台更新</a>'}`);
  }
  here(`<div class="card here">
    <div class="here-head"><span class="ico">${ICON.search}</span><div class="grow"><b>这个页面上有 ${rows.length} 篇稿件</b><div class="small">追踪后，状态有变化会出现在这里并通知你</div></div></div>
    <label>期刊名称<input id="hereJournal" maxlength="120" value="${esc(scan.journal)}"></label>
    <button class="primary" id="hereAdd" type="button">追踪这些稿件</button>
    <div class="small faint">通用识别，尚未在这个网站实测，状态以投稿网站为准。不需要密码。</div>
  </div>`);
  $('#hereAdd').addEventListener('click', () => {
    const journal = $('#hereJournal').value.trim();
    send('ui:webAdd', { url: tab.url, journal, rows, folders });
    // 后台更新要能访问这个网站：权限请求必须在点击的同一时刻发起
    chrome.permissions.request({ origins: [originPattern(tab.url)] }).then(
      (ok) => slim(`已开始追踪「${esc(journal || scan.journal)}」`, ok ? '之后会在后台自动更新。' : '没有允许访问这个网站：只在你打开这个页面、点扩展图标时更新。'),
      () => slim(`已开始追踪「${esc(journal || scan.journal)}」`, '只在你打开这个页面、点扩展图标时更新。'),
    );
  });
  $('#hereJournal').addEventListener('keydown', (e) => e.key === 'Enter' && $('#hereAdd').click());
}

let grantPattern = null; // 「允许后台更新」要请求的网站

function elsevierHere(s, url) {
  const id = UUID.exec(url)?.[0]?.toLowerCase();
  if (!id) return;
  if (s.elsevierIds.some((x) => id.startsWith(x.replace('…', '')))) return slim('这篇 Elsevier 稿件已在追踪');
  here(`<div class="card here">
    <div class="here-head"><span class="ico">${ICON.search}</span><div class="grow"><b>这是一篇 Elsevier 稿件的追踪页</b><div class="small">追踪后会定期查询审稿进度，不需要登录</div></div></div>
    <button class="primary" id="hereAdd" type="button">追踪这篇稿件</button>
  </div>`);
  $('#hereAdd').addEventListener('click', async () => {
    await send('ui:setElsevier', { text: url, append: true });
    slim('已开始追踪这篇 Elsevier 稿件', '正在查询，结果马上出现在下面。');
  });
}

$('#here').addEventListener('click', (e) => {
  if (e.target.id !== 'hereGrant') return;
  e.preventDefault();
  chrome.permissions.request({ origins: [grantPattern] }).then((ok) => ok && slim('已允许后台更新', '之后会在后台自动更新这个网站的稿件。'), () => {});
});

$('#home').href = BRAND.homepage;
$('#refresh').innerHTML = ICON.refresh;
$('#panel').innerHTML = `${ICON.panel}追踪面板`;
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
chrome.storage.onChanged.addListener(() => {
  clearTimeout(timer);
  timer = setTimeout(render, 300);
});

render().then(() => setTimeout(() => send('ui:markSeen'), 2500));
send('ui:state').then((s) => s && detectHere(s)).catch(() => {});
