// 追踪面板：稿件（按期刊）、账号（按期刊类型）、设置。
import {
  send, esc, ago, fmtDate, STAGES, stageOf, prepareItems, isActive, groupByJournal, FILTERS, FAMILIES, problems, lastCheckedAt,
  msRow, journalHead, cleanStatus, peopleText, reviewText, toMarkdown, ICON, BRAND, footerHtml, themeSwitchHtml, bindThemeSwitch, toast, diagnostics,
  L, loc, langSwitchHtml, bindLangSwitch, currentLangPref, localizeAttrs, setHtml, onlyLogs,
} from './common.js';
import { originPattern } from '../lib/scan.js';

// 界面文字用 L(中文, English)。切换语言会重新加载页面，所以模块顶层的 L() 也总是当前语言。
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
  $('#checked').textContent = running ? L('正在查询…', 'Checking…') : checked ? L(`${ago(checked)}查询过`, `Checked ${ago(checked)}`) : '';
  const btn = $('#refreshAll');
  btn.classList.toggle('spin', running);
  btn.disabled = running;
  $('#acctDot').hidden = !problems(state).some((p) => p.level === 'action');
}

// ───────── 稿件 ─────────

function alertHtml(p) {
  const fam = FAMILIES.find((f) => f.id === p.family);
  const btn = p.windowId
    ? `<button class="sm" data-window="${Number(p.windowId)}">${L('打开窗口', 'Open window')}</button>`
    : p.fix === 'open'
      ? `<a class="button sm" href="${esc(openUrlOf(fam))}" target="_blank">${L('打开投稿网站', 'Open website')}</a>`
      : `<button class="sm" data-goto="#accounts/${esc(p.family)}">${L('更新密码', 'Update password')}</button>`;
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
    .map((p) => `<div class="banner warn"><span class="ico">i</span><div class="grow"><b>${esc(p.title)}</b><div class="small">${esc(p.detail)}</div></div><button class="sm ghost" data-goto="#accounts/${esc(p.family)}">${L('查看', 'View')}</button></div>`)
    .join('');
  if (warn.length)
    html += `<div class="banner warn"><span class="ico">i</span><div class="grow"><b>${esc(warn.map((w) => w.title).join(L('；', '; ')))}</b><div class="small">${L('稍后将自动重试，通常无需处理。', 'It will be retried automatically; usually no action is needed.')}</div></div><button class="sm ghost" data-goto="#accounts/${esc(warn[0].family)}">${L('查看', 'View')}</button></div>`;
  setHtml($('#alerts'), html);
}

function renderTiles(items) {
  const searching = !!$('#search').value.trim();
  setHtml($('#tiles'), Object.entries(FILTERS)
    .map(([k, f]) => {
      const n = items.filter(f.test).length;
      return `<button type="button" class="tile${k === filter && !searching ? ' on' : ''}${n ? ' has' : ''}" data-filter="${k}" aria-pressed="${k === filter && !searching}"><b>${n}</b><span>${f.label}</span></button>`;
    })
    .join(''));
}

function timelineHtml(it) {
  const ev = [];
  if (it.submittedAt) ev.push({ at: it.submittedAt, text: L('投稿', 'Submitted'), stage: 'submitted' });
  for (const h of it.history || []) {
    const text = h.initial ? `${cleanStatus(h.status)}${L('（开始追踪）', ' (tracking started)')}` : h.from ? `${cleanStatus(h.from)} → ${cleanStatus(h.status)}` : cleanStatus(h.status);
    ev.push({ at: h.at, text, stage: stageOf(h.status) });
  }
  if (it.decidedAt && !ev.some((e) => fmtDate(e.at) === fmtDate(it.decidedAt))) ev.push({ at: it.decidedAt, text: L(`作出决定：${cleanStatus(it.status)}`, `Decision: ${cleanStatus(it.status)}`), stage: it.stage });
  ev.sort((a, b) => b.at - a.at);
  return `<ol class="timeline">${ev
    .map((e) => `<li style="--c:${STAGES[e.stage]?.color || 'var(--line-strong)'}"><time>${fmtDate(e.at)}</time>${esc(e.text)}</li>`)
    .join('')}</ol>`;
}

function detailHtml(it) {
  const facts = [
    [L('稿件号', 'Manuscript ID'), it.manuscriptId],
    [L('当前状态', 'Status'), it.status],
    [L('投稿日期', 'Submitted'), it.submittedAt && fmtDate(it.submittedAt)],
    [L('决定日期', 'Decided'), it.decidedAt && fmtDate(it.decidedAt)],
    [L('编辑', 'Editors'), peopleText(it)],
    [L('审稿进度', 'Reviews'), reviewText(it)],
    [L('已重投为', 'Resubmitted as'), it.resubmittedAs],
  ].filter(([, v]) => v);
  return `<div class="detail">
    <div class="facts">${facts.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('')}</div>
    ${timelineHtml(it)}
    <div class="row">${it.url ? `<a class="button sm" href="${esc(it.url)}" target="_blank">${ICON.external}${L('去投稿网站查看', 'View on website')}</a>` : ''}<button class="sm ghost" data-copy="${esc(it.manuscriptId || '')}">${L('复制稿件号', 'Copy ID')}</button></div>
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
    setHtml($('#journals'), '');
    return;
  }
  renderTiles(all);

  const q = $('#search').value.trim().toLowerCase();
  const items = q
    ? all.filter((i) => [i.venue, i.manuscriptId, i.title, i.status].some((x) => String(x || '').toLowerCase().includes(q)))
    : all.filter(FILTERS[filter].test);
  $('#resultHint').textContent = q ? L(`找到 ${items.length} 篇`, `${items.length} found`) : '';

  if (!items.length) {
    const why = q
      ? L('没有匹配的稿件', 'No matching manuscripts')
      : !all.length
        ? state.running.length ? L('正在查询稿件，首次查询通常需要几十秒…', 'Checking manuscripts. The first check can take up to a minute…') : L('尚未查到稿件，可点击右上角「立即查询」', 'No manuscripts found yet. Click Check now at the top right.')
        : { active: L('没有进行中的稿件', 'No manuscripts in progress'), revision: L('没有需要修改的稿件', 'No manuscripts awaiting revision'), results: L('最近 30 天没有新的结果', 'No decisions in the last 30 days'), all: '' }[filter];
    setHtml($('#journals'), `<div class="card empty">${esc(why)}</div>`);
    return;
  }
  setHtml($('#journals'), groupByJournal(items)
    .map(
      (g) =>
        `<section class="journal">${journalHead(g)}${g.items
          .map((it) => {
            const open = expanded.has(it.key);
            return msRow(it, { interactive: true }).replace('aria-expanded="false"', `aria-expanded="${open}"`) + (open ? detailHtml(it) : '');
          })
          .join('')}</section>`,
    )
    .join(''));
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
      cred: 'scholarone', adapter: 'scholarone', label: L('IEEE 投稿账号', 'IEEE submission account'), user: L('User ID（通常是邮箱）', 'User ID (usually your email)'),
      hint: L('登录 IEEE 期刊投稿网站（ScholarOne Manuscripts）的账号，各期刊通常通用。', 'Your account for IEEE journal submission sites (ScholarOne Manuscripts), usually the same for all journals.'),
    },
    {
      cred: 'ieee', adapter: 'rex', label: L('IEEE 账号', 'IEEE account'), optional: true, user: L('IEEE 账号邮箱', 'IEEE account email'),
      hint: L('ieee.org 账号，用于汇总全部 IEEE 稿件并自动发现你投稿的期刊。浏览器已登录 IEEE 时可不填写。', 'Your ieee.org account, used to list all IEEE manuscripts and find the journals you submitted to. Optional if the browser is signed in to IEEE.'),
    },
  ],
  ifac: [{ cred: 'paperplaza', adapter: 'paperplaza', label: L('PaperPlaza 账号', 'PaperPlaza account'), user: L('PIN / 邮箱 / ORCID', 'PIN / email / ORCID'), hint: L('IFAC 投稿系统 PaperPlaza 的账号，可使用 PIN、邮箱或 ORCID。', 'Your account for PaperPlaza, the IFAC submission system. PIN, email or ORCID all work.') }],
  tcct: [{ cred: 'tcct', adapter: 'tcct', label: L('TCCT 账号', 'TCCT account'), user: 'PIN', hint: L('TCCT 会议投稿系统的 PIN 和密码。浏览器已登录时可暂不填写，登录过期后需要用它自动重新登录。', 'PIN and password for the TCCT conference submission system. Optional while the browser is signed in; needed to sign in again automatically when the session expires.') }],
};
const OPEN_ADAPTER = { ieee: 'rex', ifac: 'paperplaza', tcct: 'tcct' };
const openUrlOf = (fam) => state?.adapters.find((a) => a.id === OPEN_ADAPTER[fam?.id])?.openUrl || '#';

function slotHtml(s) {
  return `<div class="slot" data-cred="${s.cred}" data-adapter="${s.adapter}"${s.optional ? ' data-optional="1"' : ''}>
    <div class="slot-head"><span class="label">${esc(s.label)}</span>${s.optional ? `<span class="opt">${L('可选', 'Optional')}</span>` : ''}<span class="grow"></span><span class="row" data-acts></span></div>
    <div class="who" data-who></div>
    <form data-id="${s.cred}" autocomplete="off" hidden>
      <div class="hint">${esc(s.hint)}</div>
      <div class="two"><input name="username" placeholder="${esc(s.user)}" autocomplete="off" required><input name="password" type="password" placeholder="${L('密码', 'Password')}" autocomplete="new-password" required></div>
      <div class="row"><button class="primary sm" type="submit">${L('保存并验证', 'Save and verify')}</button><button class="sm ghost" type="button" data-cancel>${L('取消', 'Cancel')}</button></div>
    </form>
  </div>`;
}

function ieeeAdvanced() {
  return `<details class="adv"><summary>${L('高级：手动添加期刊站点、为单个期刊使用不同账号', 'Advanced: add journal sites manually or use a different account for one journal')}</summary><div>
    <div class="small muted">${L('正在查询的期刊站点（大多从 IEEE 账号自动发现）：', 'Journal sites being checked (mostly found through your IEEE account):')}</div>
    <div class="sites" data-sites></div>
    <label class="small muted">${L('另外要查询的站点：投稿网址 mc.manuscriptcentral.com/ 后面的部分，逗号分隔，例如 <code>tii, t-ase</code>（其他出版社在 ScholarOne 上的期刊也可以）', 'Additional sites: the part after mc.manuscriptcentral.com/ in the submission URL, separated by commas, e.g. <code>tii, t-ase</code> (journals of other publishers on ScholarOne also work)')}
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><input data-manual-sites><button class="sm" type="button" data-save-sites>${L('保存', 'Save')}</button></div></label>
    <div class="small muted" data-overrides></div>
    <form data-site-form autocomplete="off" class="slot">
      <div class="hint">${L('某个期刊的账号与上方 IEEE 投稿账号不同时，在此单独填写：', 'If a journal uses a different account from the IEEE submission account above, add it here:')}</div>
      <input name="site" placeholder="${L('站点，例如 tmm-ieee', 'Site, e.g. tmm-ieee')}" required>
      <div class="two"><input name="username" placeholder="User ID" required><input name="password" type="password" placeholder="${L('密码', 'Password')}" autocomplete="new-password" required></div>
      <div class="row"><button class="sm" type="submit">${L('保存该期刊的账号', 'Save account for this journal')}</button></div>
    </form>
  </div></details>`;
}

const WEB_HOWTO = L(
  `<div class="howto"><b>添加方法</b><ol>
  <li>登录投稿网站，打开列出稿件的页面（如 Editorial Manager 的「Submissions Being Processed」）；</li>
  <li>点击浏览器工具栏中的 mituan 图标，选择「追踪这些稿件」。</li></ol>
  <div class="small">无需填写密码。通用识别适用于大多数以列表展示稿件的投稿系统，未逐一实测，状态以投稿网站为准。</div></div>`,
  `<div class="howto"><b>How to add</b><ol>
  <li>Sign in to the submission website and open the page that lists your manuscripts (for example "Submissions Being Processed" in Editorial Manager).</li>
  <li>Click the mituan icon in the browser toolbar and choose Track these manuscripts.</li></ol>
  <div class="small">No password needed. Generic detection works with most submission systems that list manuscripts in a table. Not every system has been tested; the submission website is authoritative.</div></div>`,
);

function buildFamilies() {
  const root = $('#families');
  root.innerHTML = FAMILIES.map((f) => {
    const body =
      f.id === 'other'
        ? `<div class="webs" data-webs></div>${WEB_HOWTO}`
        : f.id === 'elsevier'
        ? `<div class="slot" data-elsevier-slot>
            <div class="slot-head"><span class="label">${L('投稿追踪链接', 'Tracking links')}</span></div>
            <div class="who" data-who></div>
            <form data-elsevier>
              <div class="hint">${L('Elsevier 无需登录。粘贴每篇稿件投稿确认邮件中的「Track your submission」链接，可一次粘贴多条。', 'No sign-in needed for Elsevier. Paste the "Track your submission" link from each confirmation email; several links can be pasted at once.')}</div>
              <textarea name="links" rows="2" placeholder="https://track.authorhub.elsevier.com/?uuid=…"></textarea>
              <div class="row"><button class="primary sm" type="submit">${L('添加', 'Add')}</button><button class="sm ghost" type="button" data-replace>${L('替换全部', 'Replace all')}</button></div>
            </form>
          </div>`
        : SLOTS[f.id].map(slotHtml).join('') + (f.id === 'ieee' ? ieeeAdvanced() : '');
    return `<div class="card fam" data-family="${f.id}">
      <header><div class="grow"><h3>${esc(f.name)}</h3><div class="small muted">${esc(f.covers)}</div></div><span class="pill idle" data-pill>…</span></header>
      <div class="found" data-found></div>
      ${body}
      <div class="msg" data-msg></div>
      <div class="foot"><button class="sm" type="button" data-run>${L('立即查询', 'Check now')}</button>${OPEN_ADAPTER[f.id] ? `<a data-open target="_blank">${L('打开投稿网站', 'Open website')}${ICON.external}</a>` : ''}</div>
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
  if (fam.adapters.some((id) => state.running.includes(id))) return ['run', L('查询中', 'Checking')];
  const probs = problems(state).filter((p) => p.family === fam.id);
  if (probs.some((p) => p.level === 'action')) return ['bad', L('需要处理', 'Needs attention')];
  if (probs.some((p) => p.own)) return ['warn', L('登录过期', 'Sign-in expired')];
  if (probs.length) return ['warn', L('部分没查到', 'Partly checked')];
  const st = fam.adapters.map((id) => state.platforms[id]?.status);
  if (st.some((s) => s === 'ok' || s === 'skipped')) return ['ok', L('正常', 'OK')];
  return hasCred ? ['idle', L('等待查询', 'Waiting')] : ['idle', L('未连接', 'Not connected')];
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
    const checked = last ? L(` · ${ago(last)}查询过`, ` · checked ${ago(last)}`) : '';
    const nj = groupByJournal(famItems).length;
    $('[data-found]', card).textContent = famItems.length
      ? L(`已找到 ${nj} 本期刊、${famItems.length} 篇稿件`, `${famItems.length} manuscript${famItems.length === 1 ? '' : 's'} in ${nj} journal${nj === 1 ? '' : 's'}`) + checked
      : last && hasCred ? L('还没有找到稿件', 'No manuscripts found yet') + checked : '';
    $('[data-msg]', card).textContent = probs.filter((p) => p.family === fam.id && p.level === 'warn' && p.detail).map((p) => p.detail).join(' ');
    const open = $('[data-open]', card);
    if (open) open.href = openUrlOf(fam);

    if (fam.id === 'elsevier') {
      $('[data-who]', card).innerHTML = elsevierCount ? L(`已添加 <b>${elsevierCount}</b> 条链接`, `<b>${elsevierCount}</b> link${elsevierCount === 1 ? '' : 's'} added`) : L('还没有添加', 'None added yet');
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
        ? `<b>${esc(c.username)}</b> · ${c.source === 'captured' ? L('来自你的登录', 'from your sign-in') : L('手动填写', 'entered manually')}${rejected ? ` · <span class="bad">${L('密码被拒绝，请更新', 'Password rejected; please update it')}</span>` : ''}`
        : usesSession ? L('正在使用浏览器里的登录', "Using the browser's sign-in") : s.optional ? L('未填写', 'Not added') : L('未填写，填写后即可自动查询', 'Not added; add it to enable automatic checks');
      $('[data-acts]', slot).innerHTML = c
        ? `<button class="sm ghost" type="button" data-edit>${L('更换', 'Change')}</button><button class="sm ghost danger" type="button" data-delete="${s.cred}">${L('删除', 'Delete')}</button>`
        : `<button class="sm${s.optional ? ' ghost' : ''}" type="button" data-edit>${L('填写', 'Add')}</button>`;
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
        : `<span class="muted">${L('暂无，填写 IEEE 账号后自动发现', 'None yet; found automatically after you add the IEEE account')}</span>`;
      const overrides = Object.keys(creds).filter((k) => k.startsWith('scholarone:'));
      $('[data-overrides]', card).innerHTML = overrides.length
        ? `${L('单独账号：', 'Separate accounts: ')}${overrides.map((k) => `<code>${esc(k.slice(11))}</code> <button class="sm ghost danger" type="button" data-delete="${esc(k)}">${L('删除', 'Delete')}</button>`).join(' ')}`
        : '';
      const input = $('[data-manual-sites]', card);
      if (document.activeElement !== input) input.value = manual.join(', ');
    }
  }
}

function webHtml(w) {
  const when =
    !w.granted ? L('仅在你打开该页面并点击扩展图标时更新', 'Updated only when you open the page and click the extension icon')
    : w.status === 'expired' ? `<span class="bad">${L('登录已过期，打开一次该页面即可恢复', 'Sign-in expired; open the page once to resume')}</span>`
    : w.status === 'error' ? `<span class="bad">${esc(loc(w.message) || L('查询失败', 'Check failed'))}</span>`
    : w.lastOkAt ? L(`${ago(w.lastOkAt)}更新`, `updated ${ago(w.lastOkAt)}`) : '';
  const n = w.count ?? 0;
  return `<div class="web" data-site="${esc(w.site)}" data-pattern="${esc(originPattern(w.url))}">
    <div class="grow"><b>${esc(w.journal)}</b><div class="small muted">${esc(w.host)} · ${L(`${n} 篇`, `${n} manuscript${n === 1 ? '' : 's'}`)}${when ? ` · ${when}` : ''}</div></div>
    ${w.granted ? '' : `<button class="sm" type="button" data-grant>${L('允许后台更新', 'Allow background updates')}</button>`}
    <a class="button sm ghost" href="${esc(w.url)}" target="_blank" rel="noopener">${L('打开', 'Open')}</a>
    <button class="sm ghost danger" type="button" data-remove-web>${L('移除', 'Remove')}</button>
  </div>`;
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  if (form.matches('[data-elsevier]')) return saveElsevier(form, true);
  const fd = new FormData(form);
  const id = form.matches('[data-site-form]') ? `scholarone:${String(fd.get('site')).trim().toLowerCase()}` : form.dataset.id;
  const res = await send('ui:saveCred', { id, username: String(fd.get('username')), password: String(fd.get('password')) });
  if (!res?.ok) return toast(res?.error || L('保存失败', 'Save failed'));
  if (form.matches('[data-site-form]')) form.reset();
  else closeForm(form);
  toast(L('已保存，正在验证登录…', 'Saved. Verifying sign-in…'));
  pillRunning(form.closest('.fam'));
}

async function saveElsevier(form, append) {
  const res = await send('ui:setElsevier', { text: new FormData(form).get('links'), append });
  form.reset();
  const n = res?.count ?? 0;
  const links = `${n} link${n === 1 ? '' : 's'}`;
  toast(L(`已${append ? '添加' : '替换为'} ${n} 条链接，正在查询…`, append ? `Added ${links}. Checking…` : `Replaced with ${links}. Checking…`));
  pillRunning(form.closest('.fam'));
}

function pillRunning(card) {
  const pill = $('[data-pill]', card);
  pill.className = 'pill run';
  pill.textContent = L('查询中', 'Checking');
}

async function onAccountClick(e) {
  const t = e.target.closest('button');
  const card = e.target.closest('.fam');
  if (!t || !card) return;
  if (t.matches('[data-grant]')) {
    // 必须在点击的同一时刻请求权限；授权后后台会自动注册页面脚本并查询一次
    const granted = await chrome.permissions.request({ origins: [t.closest('.web').dataset.pattern] }).catch(() => false);
    toast(granted ? L('已允许，之后会在后台自动更新', 'Allowed. It will be updated in the background.') : L('未授权，仍仅在你打开页面时更新', 'Not allowed. It is updated only when you open the page.'));
    return render();
  }
  if (t.matches('[data-remove-web]')) {
    const w = t.closest('.web');
    const name = $('b', w).textContent;
    if (confirm(L(`停止追踪「${name}」？该网站的稿件记录将一并删除。`, `Stop tracking "${name}"? Its manuscript records will also be deleted.`))) await send('ui:webRemove', { site: w.dataset.site });
    return;
  }
  const fam = FAMILIES.find((f) => f.id === card.dataset.family);
  if (t.matches('[data-run]')) {
    for (const id of fam.adapters) await send('ui:refresh', { id });
    pillRunning(card);
    toast(L('已开始查询', 'Check started'));
  } else if (t.matches('[data-edit]')) openForm(t.closest('.slot'));
  else if (t.matches('[data-cancel]')) closeForm(t.closest('form'));
  else if (t.matches('[data-delete]')) {
    if (confirm(L('删除此账号？之后将不再使用它自动查询。', 'Delete this account? It will no longer be used for automatic checks.'))) await send('ui:deleteCred', { id: t.dataset.delete });
  } else if (t.matches('[data-replace]')) {
    if (confirm(L('用文本框里的链接替换全部已保存的链接？', 'Replace all saved links with the links in the text box?'))) saveElsevier($('form[data-elsevier]', card), false);
  } else if (t.matches('[data-save-sites]')) {
    const list = $('[data-manual-sites]', card).value.split(/[,，\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    await send('ui:saveSettings', { patch: { scholaroneSites: list } });
    toast(L('已保存，下次查询时生效', 'Saved. Takes effect at the next check.'));
  }
}

// ───────── 设置 ─────────

const PRESETS = {
  frequent: { label: L('高频', 'Frequent'), desc: L('IEEE 期刊每小时、其他每 2 小时查询一次', 'IEEE journals hourly, others every 2 hours'), s1: 60, other: 120 },
  standard: { label: L('标准（推荐）', 'Standard (recommended)'), desc: L('IEEE 期刊每 2 小时、其他每 6 小时查询一次', 'IEEE journals every 2 hours, others every 6 hours'), s1: 120, other: 360 },
  relaxed: { label: L('低频', 'Relaxed'), desc: L('IEEE 期刊每 6 小时、其他每 12 小时查询一次', 'IEEE journals every 6 hours, others every 12 hours'), s1: 360, other: 720 },
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
    (cur === 'custom' ? `<option value="custom">${L('自定义', 'Custom')}</option>` : '');
  $('#freq').value = cur;
  $('#freqDesc').textContent = cur === 'custom' ? L('当前为自定义查询间隔，选择预设将覆盖它', 'Custom intervals are in use; choosing a preset replaces them') : PRESETS[cur].desc;
  $('#bgHint').textContent = /Edg\//.test(navigator.userAgent)
    ? L('浏览器在后台运行时，扩展会继续查询。Edge 默认开启，位置：设置 → 系统和性能 →「在 Microsoft Edge 关闭后继续运行后台扩展和应用」。', "Checks continue while the browser runs in the background. On by default in Edge: Settings → System and performance → 'Continue running background extensions and apps when Microsoft Edge is closed'.")
    : L('浏览器在后台运行时，扩展会继续查询。请在 Chrome「设置 → 系统」中开启「关闭 Google Chrome 后继续运行后台应用」。', "Checks continue while the browser runs in the background. In Chrome, turn on Settings → System → 'Continue running background apps when Google Chrome is closed'.");
}

async function saveSetting(patch, msg = L('已保存', 'Saved')) {
  await send('ui:saveSettings', { patch });
  toast(msg);
}

async function renderLogs() {
  const { logs = [] } = await chrome.storage.local.get('logs');
  $('#logs').innerHTML =
    logs
      .slice(-200)
      .reverse()
      .map((l) => `<div class="${l.level === 'error' ? 'err' : ''}">${esc(new Date(l.at).toLocaleString())}  [${esc(loc(l.source))}] ${esc(loc(l.msg))}</div>`)
      .join('') || L('暂无', 'No entries');
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
document.title = L('追踪面板 · mituan 投稿追踪', 'Dashboard · mituan Manuscript Tracker');
localizeAttrs();
$('#refreshAll').innerHTML = `${ICON.refresh}${L('立即查询', 'Check now')}`;
$('#export').innerHTML = `${ICON.download}${L('导出', 'Export')}`;
$('#searchIcon').outerHTML = ICON.search;
$('#lockIcon').innerHTML = ICON.lock;
$('#themeSlot').innerHTML = themeSwitchHtml();
$('#langSlot').innerHTML = langSwitchHtml();
$('#footer').innerHTML = footerHtml();
$('#picks').innerHTML = FAMILIES.map((f) => `<button type="button" data-goto="#accounts/${f.id}"><b>${esc(f.name)}</b><span>${esc(f.covers)}</span></button>`).join('');
bindThemeSwitch();
bindLangSwitch();
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
    toast(L('稿件号已复制', 'Manuscript ID copied'));
  }
});
$('#refreshAll').addEventListener('click', async () => {
  $('#refreshAll').classList.add('spin');
  $('#refreshAll').disabled = true;
  await send('ui:refresh');
  toast(L('已开始查询，结果将自动显示', 'Check started. Results will appear automatically.'));
});

$('#notify').addEventListener('change', (e) => saveSetting({ notify: e.target.checked }, e.target.checked ? L('已开启通知', 'Notifications on') : L('已关闭通知', 'Notifications off')));
$('#capture').addEventListener('change', (e) => saveSetting({ captureLogins: e.target.checked }));
$('#pause').addEventListener('change', (e) => saveSetting({ pauseWhenActiveMinutes: e.target.checked ? 10 : 0 }));
$('#freq').addEventListener('change', async (e) => {
  const p = PRESETS[e.target.value];
  if (!p) return;
  await saveSetting({ intervals: Object.fromEntries(state.adapters.map((a) => [a.id, a.id === 'scholarone' ? p.s1 : p.other])) }, L(`查询频率：${p.label}`, `Check frequency: ${p.label}`));
  state = await send('ui:state');
  renderSettings();
});
$('#logsBox').addEventListener('toggle', () => $('#logsBox').open && renderLogs());

function download() {
  const url = URL.createObjectURL(new Blob([toMarkdown(state.items)], { type: 'text/markdown' }));
  Object.assign(document.createElement('a'), { href: url, download: `${L('投稿记录', 'manuscripts')}-${new Date().toISOString().slice(0, 10)}.md` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('#export').addEventListener('click', download);
$('#downloadMd').addEventListener('click', download);
$('#copyMd').addEventListener('click', async () => {
  await navigator.clipboard.writeText(toMarkdown(state.items));
  toast(L('投稿记录已复制', 'Manuscripts copied'));
});
$('#copyDiag').addEventListener('click', async () => {
  await navigator.clipboard.writeText(await diagnostics(state));
  toast(L('诊断信息已复制', 'Diagnostics copied'));
});
$('#clearAll').addEventListener('click', async () => {
  if (!confirm(L('确定删除本机保存的全部账号、稿件记录和日志？此操作不能撤销。', 'Delete all accounts, manuscript records and logs stored on this device? This cannot be undone.'))) return;
  await send('ui:clearAll');
  await syncLangSetting();
  settingsRendered = false;
  toast(L('已全部清除', 'All data cleared'));
  render();
});

/** 语言偏好以本页的 localStorage 为准（theme.js 绘制前读它），同步给后台用于通知。 */
const syncLangSetting = () => send('ui:saveSettings', { patch: { lang: currentLangPref() } });

let timer, logTimer;
chrome.storage.onChanged.addListener((changes) => {
  // 查询的每一步都会写一条运行日志：这种变化只刷新展开着的日志，不重绘整个面板（否则查询期间每秒重建一两次期刊卡片，会闪）
  if (onlyLogs(changes)) {
    if (!$('#view-settings').hidden && $('#logsBox').open) {
      clearTimeout(logTimer);
      logTimer = setTimeout(renderLogs, 400);
    }
    return;
  }
  clearTimeout(timer);
  timer = setTimeout(render, 400);
});
addEventListener('hashchange', route);

(async () => {
  state = await send('ui:state');
  if (state && (state.settings.lang || 'auto') !== currentLangPref()) syncLangSetting();
  for (const it of Object.values(state?.items || {})) if (it.unseen) seenThisVisit.add(it.key);
  route();
  // 入场动画只在打开面板时播放一次；之后内容更新、切换页签时卡片不再重新浮现
  setTimeout(() => document.documentElement.classList.add('settled'), 1000);
  // 看过面板就清掉工具栏图标上的数字；这次浏览期间"新"的标记保留
  if (seenThisVisit.size) setTimeout(() => send('ui:markSeen'), 3000);
})();
