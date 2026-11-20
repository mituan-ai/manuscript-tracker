// 追踪面板：稿件（按期刊）、账号（按期刊类型）、设置。
import {
  send, esc, ago, fmtDate, STAGES, stageOf, prepareItems, isActive, groupByJournal, FILTERS, FAMILIES, problems, lastCheckedAt,
  msRow, journalHead, cleanStatus, peopleText, reviewText, toMarkdown, ICON, BRAND, footerHtml, themeSwitchHtml, bindThemeSwitch, toast, diagnostics,
} from './common.js';
import { originPattern } from '../lib/scan.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

let state = null;
let filter = 'active';
const expanded = new Set();
const seenThisVisit = new Set(); // 打开面板时还没看过的稿件，这次浏览期间一直标"新"

// ───────── 页签与跳转：#accounts、#accounts/ieee、#settings、#all、#ms=<key> ─────────

let pendingFocus = null;

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const tab = h.startsWith('accounts') ? 'accounts' : h === 'settings' ? 'settings' : 'manuscripts';
  for (const t of ['manuscripts', 'accounts', 'settings']) $(`#view-${t}`).hidden = t !== tab;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (h === 'all') filter = 'all';
  if (h.startsWith('ms=')) pendingFocus = { ms: h.slice(3) };
  if (h.startsWith('accounts/')) pendingFocus = { family: h.slice(9) };
  if (!pendingFocus) scrollTo({ top: 0 });
  if (state) render(false);
}

function applyFocus() {
  if (!pendingFocus || !state) return;
  const f = pendingFocus;
  pendingFocus = null;
  if (f.ms) {
    const it = prepareItems(state.items).find((i) => i.key === f.ms);
    if (!it) return;
    if (!FILTERS[filter].test(it)) filter = isActive(it) ? 'active' : 'all';
    expanded.add(it.key);
    renderManuscripts();
    const row = $(`.ms[data-key="${CSS.escape(it.key)}"]`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row?.classList.add('flash');
  } else if (f.family) {
    const card = $(`.fam[data-family="${CSS.escape(f.family)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    card.classList.add('focus');
    setTimeout(() => card.classList.remove('focus'), 2400);
    // 密码被拒的账号直接展开表单；没有的话展开第一个还没填的必填账号
    const slot = $$('.slot', card).find((s) => s.dataset.rejected === '1') || $$('.slot[data-cred]', card).find((s) => !s.dataset.saved && !s.dataset.optional);
    if (slot) openForm(slot);
  }
}

// ───────── 顶栏 ─────────

function renderBar() {
  const running = state.running.length > 0;
  const checked = lastCheckedAt(state);
  $('#checked').textContent = running ? '正在查询…' : checked ? `${ago(checked)}查询过` : '';
  const btn = $('#refreshAll');
  btn.classList.toggle('spin', running);
  btn.disabled = running;
  $('#acctDot').hidden = !problems(state).some((p) => p.level === 'action');
}

// ───────── 稿件 ─────────

function alertHtml(p) {
  const fam = FAMILIES.find((f) => f.id === p.family);
  const btn = p.windowId
    ? `<button class="sm" data-window="${Number(p.windowId)}">打开窗口</button>`
    : p.fix === 'open'
      ? `<a class="button sm" href="${esc(openUrlOf(fam))}" target="_blank">打开投稿网站</a>`
      : `<button class="sm" data-goto="#accounts/${esc(p.family)}">更新密码</button>`;
  return `<div class="banner"><span class="ico">!</span><div class="grow"><b>${esc(p.title)}</b>${p.detail ? `<div class="small">${esc(p.detail)}</div>` : ''}</div>${btn}</div>`;
}

function renderAlerts() {
  const list = problems(state);
  const action = list.filter((p) => p.level === 'action');
  const warn = list.filter((p) => p.level === 'warn' && !p.own);
  let html = action.map(alertHtml).join('');
  // 其他投稿网站登录过期：不会自己恢复，单独说明怎么办
  html += list
    .filter((p) => p.own)
    .map((p) => `<div class="banner warn"><span class="ico">i</span><div class="grow"><b>${esc(p.title)}</b><div class="small">${esc(p.detail)}</div></div><button class="sm ghost" data-goto="#accounts/${esc(p.family)}">查看</button></div>`)
    .join('');
  if (warn.length)
    html += `<div class="banner warn"><span class="ico">i</span><div class="grow"><b>${esc(warn.map((w) => w.title).join('；'))}</b><div class="small">稍后会自动重试，通常不用处理。</div></div><button class="sm ghost" data-goto="#accounts/${esc(warn[0].family)}">查看</button></div>`;
  $('#alerts').innerHTML = html;
}

function renderTiles(items) {
  const searching = !!$('#search').value.trim();
  $('#tiles').innerHTML = Object.entries(FILTERS)
    .map(([k, f]) => {
      const n = items.filter(f.test).length;
      return `<button type="button" class="tile${k === filter && !searching ? ' on' : ''}${n ? ' has' : ''}" data-filter="${k}" aria-pressed="${k === filter && !searching}"><b>${n}</b><span>${f.label}</span></button>`;
    })
    .join('');
}

function timelineHtml(it) {
  const ev = [];
  if (it.submittedAt) ev.push({ at: it.submittedAt, text: '投稿', stage: 'submitted' });
  for (const h of it.history || []) {
    const text = h.initial ? `${cleanStatus(h.status)}（开始追踪）` : h.from ? `${cleanStatus(h.from)} → ${cleanStatus(h.status)}` : cleanStatus(h.status);
    ev.push({ at: h.at, text, stage: stageOf(h.status) });
  }
  if (it.decidedAt && !ev.some((e) => fmtDate(e.at) === fmtDate(it.decidedAt))) ev.push({ at: it.decidedAt, text: `作出决定：${cleanStatus(it.status)}`, stage: it.stage });
  ev.sort((a, b) => b.at - a.at);
  return `<ol class="timeline">${ev
    .map((e) => `<li style="--c:${STAGES[e.stage]?.color || 'var(--line-strong)'}"><time>${fmtDate(e.at)}</time>${esc(e.text)}</li>`)
    .join('')}</ol>`;
}

function detailHtml(it) {
  const facts = [
    ['稿件号', it.manuscriptId],
    ['当前状态', it.status],
    ['投稿日期', it.submittedAt && fmtDate(it.submittedAt)],
    ['决定日期', it.decidedAt && fmtDate(it.decidedAt)],
    ['编辑', peopleText(it)],
    ['审稿进度', reviewText(it)],
    ['已重投为', it.resubmittedAs],
  ].filter(([, v]) => v);
  return `<div class="detail">
    <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
    ${timelineHtml(it)}
    <div class="row">${it.url ? `<a class="button sm" href="${esc(it.url)}" target="_blank">${ICON.external}去投稿网站查看</a>` : ''}<button class="sm ghost" data-copy="${esc(it.manuscriptId || '')}">复制稿件号</button></div>
  </div>`;
}

function renderManuscripts() {
  const all = prepareItems(state.items).map((it) => ({ ...it, unseen: it.unseen || seenThisVisit.has(it.key) }));
  const connected = Object.keys(state.creds.creds).length || state.creds.elsevierCount || state.web.length;
  const fresh = !all.length && !connected && !state.running.length;
  $('#onboard').hidden = !fresh;
  $('#installed').hidden = location.hash !== '#welcome';
  $('#dash').hidden = fresh;
  renderAlerts();
  if (fresh) {
    $('#journals').innerHTML = '';
    return;
  }
  renderTiles(all);

  const q = $('#search').value.trim().toLowerCase();
  const items = q
    ? all.filter((i) => [i.venue, i.manuscriptId, i.title, i.status].some((x) => String(x || '').toLowerCase().includes(q)))
    : all.filter(FILTERS[filter].test);
  $('#resultHint').textContent = q ? `找到 ${items.length} 篇` : '';

  if (!items.length) {
    const why = q
      ? '没有匹配的稿件'
      : !all.length
        ? state.running.length ? '正在查询你的稿件，第一次通常需要几十秒…' : '还没有查到稿件，点右上角「立即查询」试试'
        : { active: '没有进行中的稿件', revision: '没有需要修改的稿件', results: '最近 30 天没有新的结果', all: '' }[filter];
    $('#journals').innerHTML = `<div class="card empty">${esc(why)}</div>`;
    return;
  }
  $('#journals').innerHTML = groupByJournal(items)
    .map(
      (g) =>
        `<section class="journal">${journalHead(g)}${g.items
          .map((it) => {
            const open = expanded.has(it.key);
            return msRow(it, { interactive: true }).replace('aria-expanded="false"', `aria-expanded="${open}"`) + (open ? detailHtml(it) : '');
          })
          .join('')}</section>`,
    )
    .join('');
}

function toggleRow(row) {
  const key = row.dataset.key;
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  renderManuscripts();
}

// ───────── 账号 ─────────

const SLOTS = {
  ieee: [
    {
      cred: 'scholarone', adapter: 'scholarone', label: 'IEEE 投稿账号', user: 'User ID（通常是邮箱）',
      hint: '在 IEEE 期刊投稿网站（ScholarOne Manuscripts）登录用的账号，各期刊通常共用一个。',
    },
    {
      cred: 'ieee', adapter: 'rex', label: 'IEEE 账号', optional: true, user: 'IEEE 账号邮箱',
      hint: 'ieee.org 账号。用来汇总全部 IEEE 稿件、自动找到你投稿的期刊。浏览器里已登录 IEEE 时可以不填。',
    },
  ],
  ifac: [{ cred: 'paperplaza', adapter: 'paperplaza', label: 'PaperPlaza 账号', user: 'PIN / 邮箱 / ORCID', hint: 'IFAC 投稿系统 PaperPlaza 的账号，PIN、邮箱或 ORCID 都可以。' }],
  tcct: [{ cred: 'tcct', adapter: 'tcct', label: 'TCCT 账号', user: 'PIN', hint: 'TCCT 会议投稿系统的 PIN 和密码。浏览器里已登录时可以先不填，登录过期后要用它自动重新登录。' }],
};
const OPEN_ADAPTER = { ieee: 'rex', ifac: 'paperplaza', tcct: 'tcct' };
const openUrlOf = (fam) => state?.adapters.find((a) => a.id === OPEN_ADAPTER[fam?.id])?.openUrl || '#';

function slotHtml(s) {
  return `<div class="slot" data-cred="${s.cred}" data-adapter="${s.adapter}"${s.optional ? ' data-optional="1"' : ''}>
    <div class="slot-head"><span class="label">${esc(s.label)}</span>${s.optional ? '<span class="opt">可选</span>' : ''}<span class="grow"></span><span class="row" data-acts></span></div>
    <div class="who" data-who></div>
    <form data-id="${s.cred}" autocomplete="off" hidden>
      <div class="hint">${esc(s.hint)}</div>
      <div class="two"><input name="username" placeholder="${esc(s.user)}" autocomplete="off" required><input name="password" type="password" placeholder="密码" autocomplete="new-password" required></div>
      <div class="row"><button class="primary sm" type="submit">保存并验证</button><button class="sm ghost" type="button" data-cancel>取消</button></div>
    </form>
  </div>`;
}

function ieeeAdvanced() {
  return `<details class="adv"><summary>高级：手动添加期刊站点、为单个期刊使用不同账号</summary><div>
    <div class="small muted">正在查询的期刊站点（大多从 IEEE 账号自动发现）：</div>
    <div class="sites" data-sites></div>
    <label class="small muted">另外要查询的站点：投稿网址 mc.manuscriptcentral.com/ 后面的部分，逗号分隔，例如 <code>tii, t-ase</code>（其他出版社在 ScholarOne 上的期刊也可以）
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><input data-manual-sites><button class="sm" type="button" data-save-sites>保存</button></div></label>
    <div class="small muted" data-overrides></div>
    <form data-site-form autocomplete="off" class="slot">
      <div class="hint">某个期刊的密码和上面的 IEEE 投稿账号不同时，单独填写：</div>
      <input name="site" placeholder="站点，例如 tmm-ieee" required>
      <div class="two"><input name="username" placeholder="User ID" required><input name="password" type="password" placeholder="密码" autocomplete="new-password" required></div>
      <div class="row"><button class="sm" type="submit">保存该期刊的账号</button></div>
    </form>
  </div></details>`;
}

const WEB_HOWTO = `<div class="howto"><b>添加方法</b><ol>
  <li>在投稿网站登录，打开列出你稿件的页面（例如 Editorial Manager 的「Submissions Being Processed」）；</li>
  <li>点浏览器工具栏里的 mituan 图标，选「追踪这些稿件」。</li></ol>
  <div class="small">不需要填写密码。通用识别不针对具体期刊，适用于大多数用表格列出稿件的投稿系统，但还没有逐一实测，状态以投稿网站为准。</div></div>`;

function buildFamilies() {
  const root = $('#families');
  root.innerHTML = FAMILIES.map((f) => {
    const body =
      f.id === 'other'
        ? `<div class="webs" data-webs></div>${WEB_HOWTO}`
        : f.id === 'elsevier'
        ? `<div class="slot" data-elsevier-slot>
            <div class="slot-head"><span class="label">投稿追踪链接</span></div>
            <div class="who" data-who></div>
            <form data-elsevier>
              <div class="hint">Elsevier 不需要登录。把每篇稿件投稿确认邮件里的「Track your submission」链接粘贴进来，可以一次粘贴多条。</div>
              <textarea name="links" rows="2" placeholder="https://track.authorhub.elsevier.com/?uuid=…"></textarea>
              <div class="row"><button class="primary sm" type="submit">添加</button><button class="sm ghost" type="button" data-replace>替换全部</button></div>
            </form>
          </div>`
        : SLOTS[f.id].map(slotHtml).join('') + (f.id === 'ieee' ? ieeeAdvanced() : '');
    return `<div class="card fam" data-family="${f.id}">
      <header><div class="grow"><h3>${esc(f.name)}</h3><div class="small muted">${esc(f.covers)}</div></div><span class="pill idle" data-pill>…</span></header>
      <div class="found" data-found></div>
      ${body}
      <div class="msg" data-msg></div>
      <div class="foot"><button class="sm" type="button" data-run>立即查询</button>${OPEN_ADAPTER[f.id] ? `<a data-open target="_blank">打开投稿网站${ICON.external}</a>` : ''}</div>
    </div>`;
  }).join('');
  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', onAccountClick);
}

function openForm(slot) {
  const f = $('form[data-id]', slot);
  if (!f) return;
  f.hidden = false;
  f.dataset.open = '1';
  $('input', f).focus({ preventScroll: true });
}

function closeForm(form) {
  form.reset();
  form.dataset.open = '';
  form.hidden = true;
}

function famStatus(fam, hasCred) {
  if (fam.adapters.some((id) => state.running.includes(id))) return ['run', '查询中'];
  const probs = problems(state).filter((p) => p.family === fam.id);
  if (probs.some((p) => p.level === 'action')) return ['bad', '需要处理'];
  if (probs.some((p) => p.own)) return ['warn', '登录过期'];
  if (probs.length) return ['warn', '部分没查到'];
  const st = fam.adapters.map((id) => state.platforms[id]?.status);
  if (st.some((s) => s === 'ok' || s === 'skipped')) return ['ok', '正常'];
  return hasCred ? ['idle', '等待查询'] : ['idle', '未连接'];
}

function renderAccounts() {
  const { creds, elsevierCount } = state.creds;
  const items = prepareItems(state.items);
  const probs = problems(state);
  for (const card of $$('.fam')) {
    const fam = FAMILIES.find((f) => f.id === card.dataset.family);
    const famItems = items.filter((i) => fam.adapters.includes(i.platform));
    const hasCred = fam.id === 'elsevier' ? !!elsevierCount : fam.id === 'other' ? state.web.length > 0 : SLOTS[fam.id].some((s) => creds[s.cred]);
    const [tone, text] = famStatus(fam, hasCred);
    const pill = $('[data-pill]', card);
    pill.className = `pill ${tone}`;
    pill.textContent = text;
    const last = Math.max(0, ...fam.adapters.map((id) => state.platforms[id]?.lastRunAt || 0));
    $('[data-found]', card).textContent = famItems.length
      ? `已找到 ${groupByJournal(famItems).length} 本期刊、${famItems.length} 篇稿件${last ? ` · ${ago(last)}查询过` : ''}`
      : last && hasCred ? `还没有找到稿件 · ${ago(last)}查询过` : '';
    $('[data-msg]', card).textContent = probs.filter((p) => p.family === fam.id && p.level === 'warn' && p.detail).map((p) => p.detail).join(' ');
    const open = $('[data-open]', card);
    if (open) open.href = openUrlOf(fam);

    if (fam.id === 'elsevier') {
      $('[data-who]', card).innerHTML = elsevierCount ? `已添加 <b>${elsevierCount}</b> 条链接` : '还没有添加';
      continue;
    }
    if (fam.id === 'other') {
      $('[data-webs]', card).innerHTML = state.web.map(webHtml).join('');
      $('[data-run]', card).hidden = !state.web.length;
      continue;
    }
    for (const slot of $$('.slot[data-cred]', card)) {
      const s = SLOTS[fam.id].find((x) => x.cred === slot.dataset.cred);
      const c = creds[s.cred];
      const p = state.platforms[s.adapter] || {};
      const rejected = p.status === 'auth-rejected' && !state.running.includes(s.adapter);
      slot.dataset.saved = c ? '1' : '';
      slot.dataset.rejected = rejected ? '1' : '';
      const usesSession = !c && (s.adapter === 'rex' || s.adapter === 'tcct') && p.status === 'ok';
      $('[data-who]', slot).innerHTML = c
        ? `<b>${esc(c.username)}</b> · ${c.source === 'captured' ? '记自你的登录' : '手动填写'}${rejected ? ' · <span class="bad">密码被拒绝，请更新</span>' : ''}`
        : usesSession ? '正在使用浏览器里的登录' : s.optional ? '未填写' : '未填写，填好后就能自动查询';
      $('[data-acts]', slot).innerHTML = c
        ? `<button class="sm ghost" type="button" data-edit>更换</button><button class="sm ghost danger" type="button" data-delete="${s.cred}">删除</button>`
        : `<button class="sm${s.optional ? ' ghost' : ''}" type="button" data-edit>填写</button>`;
      // 密码被拒时直接展开表单，其余情况等你点「填写」「更换」
      const form = $('form', slot);
      if (!form.dataset.open && !form.matches(':focus-within')) form.hidden = !rejected;
    }
    if (fam.id === 'ieee') {
      const names = state.discovered.siteNames || {};
      const manual = state.settings.scholaroneSites;
      const all = [...new Set([...state.discovered.scholaroneSites, ...manual])];
      $('[data-sites]', card).innerHTML = all.length
        ? all.map((x) => `<span>${names[x] ? `${esc(names[x])} ` : ''}<code>${esc(x)}</code></span>`).join('')
        : '<span class="muted">还没有，填好 IEEE 账号后会自动发现</span>';
      const overrides = Object.keys(creds).filter((k) => k.startsWith('scholarone:'));
      $('[data-overrides]', card).innerHTML = overrides.length
        ? `单独账号：${overrides.map((k) => `<code>${esc(k.slice(11))}</code> <button class="sm ghost danger" type="button" data-delete="${esc(k)}">删除</button>`).join(' ')}`
        : '';
      const input = $('[data-manual-sites]', card);
      if (document.activeElement !== input) input.value = manual.join(', ');
    }
  }
}

function webHtml(w) {
  const when =
    !w.granted ? '只在你打开这个页面、点扩展图标时更新'
    : w.status === 'expired' ? '<span class="bad">登录已过期，打开一次就会恢复</span>'
    : w.status === 'error' ? `<span class="bad">${esc(w.message || '查询失败')}</span>`
    : w.lastOkAt ? `${ago(w.lastOkAt)}更新` : '';
  return `<div class="web" data-site="${esc(w.site)}" data-pattern="${esc(originPattern(w.url))}">
    <div class="grow"><b>${esc(w.journal)}</b><div class="small muted">${esc(w.host)} · ${w.count ?? 0} 篇${when ? ` · ${when}` : ''}</div></div>
    ${w.granted ? '' : '<button class="sm" type="button" data-grant>允许后台更新</button>'}
    <a class="button sm ghost" href="${esc(w.url)}" target="_blank" rel="noopener">打开</a>
    <button class="sm ghost danger" type="button" data-remove-web>移除</button>
  </div>`;
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (form.matches('[data-elsevier]')) return saveElsevier(form, true);
  const fd = new FormData(form);
  const id = form.matches('[data-site-form]') ? `scholarone:${String(fd.get('site')).trim().toLowerCase()}` : form.dataset.id;
  const res = await send('ui:saveCred', { id, username: String(fd.get('username')), password: String(fd.get('password')) });
  if (!res?.ok) return toast(res?.error || '保存失败');
  if (form.matches('[data-site-form]')) form.reset();
  else closeForm(form);
  toast('已保存，正在验证登录…');
  pillRunning(form.closest('.fam'));
}

async function saveElsevier(form, append) {
  const res = await send('ui:setElsevier', { text: new FormData(form).get('links'), append });
  form.reset();
  toast(`已${append ? '添加' : '替换为'} ${res?.count ?? 0} 条链接，正在查询…`);
  pillRunning(form.closest('.fam'));
}

function pillRunning(card) {
  const pill = $('[data-pill]', card);
  pill.className = 'pill run';
  pill.textContent = '查询中';
}

async function onAccountClick(e) {
  const t = e.target.closest('button');
  const card = e.target.closest('.fam');
  if (!t || !card) return;
  if (t.matches('[data-grant]')) {
    // 必须在点击的同一时刻请求权限；授权后后台会自动注册页面脚本并查询一次
    const granted = await chrome.permissions.request({ origins: [t.closest('.web').dataset.pattern] }).catch(() => false);
    toast(granted ? '已允许，之后会在后台自动更新' : '没有允许，仍然只在你打开页面时更新');
    return render();
  }
  if (t.matches('[data-remove-web]')) {
    const w = t.closest('.web');
    if (confirm(`不再追踪「${$('b', w).textContent}」？这个网站的稿件记录也会一起删除。`)) await send('ui:webRemove', { site: w.dataset.site });
    return;
  }
  const fam = FAMILIES.find((f) => f.id === card.dataset.family);
  if (t.matches('[data-run]')) {
    for (const id of fam.adapters) await send('ui:refresh', { id });
    pillRunning(card);
    toast('已开始查询');
  } else if (t.matches('[data-edit]')) openForm(t.closest('.slot'));
  else if (t.matches('[data-cancel]')) closeForm(t.closest('form'));
  else if (t.matches('[data-delete]')) {
    if (confirm('删除这个账号？之后不会再用它自动查询。')) await send('ui:deleteCred', { id: t.dataset.delete });
  } else if (t.matches('[data-replace]')) {
    if (confirm('用文本框里的链接替换全部已保存的链接？')) saveElsevier($('form[data-elsevier]', card), false);
  } else if (t.matches('[data-save-sites]')) {
    const list = $('[data-manual-sites]', card).value.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    await send('ui:saveSettings', { patch: { scholaroneSites: list } });
    toast('已保存，下次查询时生效');
  }
}

// ───────── 设置 ─────────

const PRESETS = {
  frequent: { label: '勤快', desc: 'IEEE 期刊每小时、其他每 2 小时查询一次', s1: 60, other: 120 },
  standard: { label: '标准（推荐）', desc: 'IEEE 期刊每 2 小时、其他每 6 小时查询一次', s1: 120, other: 360 },
  relaxed: { label: '省心', desc: 'IEEE 期刊每 6 小时、其他每 12 小时查询一次', s1: 360, other: 720 },
};

function presetOf(intervals) {
  const others = Object.entries(intervals).filter(([k]) => k !== 'scholarone').map(([, v]) => v);
  return Object.keys(PRESETS).find((k) => PRESETS[k].s1 === intervals.scholarone && others.every((v) => v === PRESETS[k].other)) || 'custom';
}

function renderSettings() {
  const s = state.settings;
  $('#notify').checked = s.notify;
  $('#capture').checked = s.captureLogins;
  $('#pause').checked = s.pauseWhenActiveMinutes > 0;
  const cur = presetOf(s.intervals);
  $('#freq').innerHTML =
    Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('') +
    (cur === 'custom' ? '<option value="custom">自定义</option>' : '');
  $('#freq').value = cur;
  $('#freqDesc').textContent = cur === 'custom' ? '你设置过自定义的查询间隔，选一个预设会替换它' : PRESETS[cur].desc;
  $('#bgHint').textContent = /Edg\//.test(navigator.userAgent)
    ? '浏览器在后台运行时扩展就会继续查询。Edge 默认如此：设置 → 系统和性能 →「在 Microsoft Edge 关闭后继续运行后台扩展和应用」。'
    : '浏览器在后台运行时扩展就会继续查询。请在 Chrome 设置 → 系统 里打开「关闭 Google Chrome 后继续运行后台应用」。';
}

async function saveSetting(patch, msg = '已保存') {
  await send('ui:saveSettings', { patch });
  toast(msg);
}

async function renderLogs() {
  const { logs = [] } = await chrome.storage.local.get('logs');
  $('#logs').innerHTML =
    logs
      .slice(-200)
      .reverse()
      .map((l) => `<div class="${l.level === 'error' ? 'err' : ''}">${esc(new Date(l.at).toLocaleString())}  [${esc(l.source)}] ${esc(l.msg)}</div>`)
      .join('') || '暂无';
}

// ───────── 渲染 ─────────

let settingsRendered = false;
async function render(fetch = true) {
  if (fetch) state = await send('ui:state');
  if (!state) return;
  renderBar();
  if (!$('#view-manuscripts').hidden) renderManuscripts();
  renderAccounts();
  if (!settingsRendered) {
    renderSettings();
    settingsRendered = true;
  }
  if (!$('#view-settings').hidden && $('#logsBox').open) renderLogs();
  applyFocus();
}

// ───────── 事件 ─────────

$('#home').href = BRAND.homepage;
$('#issues').href = `${BRAND.github}/issues`;
$('#refreshAll').innerHTML = `${ICON.refresh}立即查询`;
$('#export').innerHTML = `${ICON.download}导出`;
$('#searchIcon').outerHTML = ICON.search;
$('#lockIcon').innerHTML = ICON.lock;
$('#themeSlot').innerHTML = themeSwitchHtml();
$('#footer').innerHTML = footerHtml();
$('#picks').innerHTML = FAMILIES.map((f) => `<button type="button" data-goto="#accounts/${f.id}"><b>${esc(f.name)}</b><span>${esc(f.covers)}</span></button>`).join('');
bindThemeSwitch();
buildFamilies();

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) location.hash = b.dataset.tab === 'manuscripts' ? '' : b.dataset.tab;
});
$('#tiles').addEventListener('click', (e) => {
  const t = e.target.closest('[data-filter]');
  if (!t) return;
  filter = t.dataset.filter;
  $('#search').value = '';
  renderManuscripts();
});
$('#search').addEventListener('input', renderManuscripts);
$('#journals').addEventListener('click', (e) => {
  if (e.target.closest('a, button')) return;
  const row = e.target.closest('.ms[data-key]');
  if (row) toggleRow(row);
});
$('#journals').addEventListener('keydown', (e) => {
  const row = e.target.closest?.('.ms[data-key]');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    toggleRow(row);
    $(`.ms[data-key="${CSS.escape(row.dataset.key)}"]`)?.focus();
  }
});
document.body.addEventListener('click', async (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) location.hash = g.dataset.goto;
  const w = e.target.closest('[data-window]');
  if (w) send('ui:focusWindow', { windowId: Number(w.dataset.window) });
  const c = e.target.closest('[data-copy]');
  if (c) {
    await navigator.clipboard.writeText(c.dataset.copy);
    toast('稿件号已复制');
  }
});
$('#refreshAll').addEventListener('click', async () => {
  $('#refreshAll').classList.add('spin');
  $('#refreshAll').disabled = true;
  await send('ui:refresh');
  toast('已开始查询，结果会自动出现在这里');
});

$('#notify').addEventListener('change', (e) => saveSetting({ notify: e.target.checked }, e.target.checked ? '已开启通知' : '已关闭通知'));
$('#capture').addEventListener('change', (e) => saveSetting({ captureLogins: e.target.checked }));
$('#pause').addEventListener('change', (e) => saveSetting({ pauseWhenActiveMinutes: e.target.checked ? 10 : 0 }));
$('#freq').addEventListener('change', async (e) => {
  const p = PRESETS[e.target.value];
  if (!p) return;
  await saveSetting({ intervals: Object.fromEntries(state.adapters.map((a) => [a.id, a.id === 'scholarone' ? p.s1 : p.other])) }, `查询频率：${p.label}`);
  state = await send('ui:state');
  renderSettings();
});
$('#logsBox').addEventListener('toggle', () => $('#logsBox').open && renderLogs());

function download() {
  const url = URL.createObjectURL(new Blob([toMarkdown(state.items)], { type: 'text/markdown' }));
  Object.assign(document.createElement('a'), { href: url, download: `投稿记录-${new Date().toISOString().slice(0, 10)}.md` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('#export').addEventListener('click', download);
$('#downloadMd').addEventListener('click', download);
$('#copyMd').addEventListener('click', async () => {
  await navigator.clipboard.writeText(toMarkdown(state.items));
  toast('投稿记录已复制');
});
$('#copyDiag').addEventListener('click', async () => {
  await navigator.clipboard.writeText(await diagnostics(state));
  toast('诊断信息已复制');
});
$('#clearAll').addEventListener('click', async () => {
  if (!confirm('确定删除本机保存的全部账号、稿件记录和日志？此操作不能撤销。')) return;
  await send('ui:clearAll');
  settingsRendered = false;
  toast('已全部清除');
  render();
});

let timer;
chrome.storage.onChanged.addListener(() => {
  clearTimeout(timer);
  timer = setTimeout(render, 400);
});
addEventListener('hashchange', route);

(async () => {
  state = await send('ui:state');
  for (const it of Object.values(state?.items || {})) if (it.unseen) seenThisVisit.add(it.key);
  route();
  // 看过面板就清掉工具栏图标上的数字；这次浏览期间"新"的标记保留
  if (seenThisVisit.size) setTimeout(() => send('ui:markSeen'), 3000);
})();
