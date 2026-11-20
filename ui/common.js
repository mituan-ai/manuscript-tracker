// 弹窗和追踪面板共用的工具。
import { STAGES, stageOf, fmtDate } from '../lib/normalize.js';
import { prepareItems, isActive, changedAt } from '../lib/view.js';

export { STAGES, stageOf, fmtDate };
export * from '../lib/view.js';

export const send = (type, data = {}) => chrome.runtime.sendMessage({ type, ...data });

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 投稿系统的名称：只用于诊断信息和运行日志，界面上按期刊展示。 */
export const PLATFORM_LABEL = {
  scholarone: 'ScholarOne',
  rex: 'IEEE Author Portal',
  paperplaza: 'PaperPlaza',
  tcct: 'TCCT',
  elsevier: 'Elsevier',
  web: '其他投稿网站',
};

export const STATUS_TEXT = {
  ok: '正常',
  partial: '部分成功',
  running: '查询中',
  disabled: '未配置',
  skipped: '已跳过',
  'need-credential': '缺少账号',
  'auth-rejected': '密码被拒',
  'need-human': '需要你处理',
  blocked: '被拦截',
  'parse-error': '页面改版',
  error: '出错',
};

export function statusTone(p) {
  if (!p) return 'idle';
  if (p.running) return 'run';
  if (p.status === 'ok') return 'ok';
  if (p.status === 'partial' || p.status === 'skipped' || p.status === 'need-credential') return 'warn';
  if (p.status === 'disabled' || !p.status) return 'idle';
  return 'bad';
}

export function ago(ms) {
  if (!ms) return '从未';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export const days = (ms) => (ms ? Math.max(0, Math.floor((Date.now() - ms) / 86400000)) : null);

const DAY = 86400000;

/** 平台给的原始状态里常带上决定日期，例如 "Accept (18-Oct-2026)"，界面上单独显示日期，这里去掉。 */
export const cleanStatus = (s) => String(s || '').replace(/\s*\(\d{1,2}-[A-Za-z]{3}-\d{4}\)/g, '').trim();

/** 一篇稿件一行：阶段、标题、稿件号，下面一行是原始状态和时间。 */
export function msRow(it, { interactive = false, compact = false } = {}) {
  const active = isActive(it);
  const waited = days(it.submittedAt);
  const ch = changedAt(it);
  const meta = [
    compact && it.manuscriptId && `<span class="mid">${esc(it.manuscriptId)}</span>`,
    esc(cleanStatus(it.status)),
    it.resubmittedAs && `已重投为 ${esc(it.resubmittedAs)}`,
    active && waited != null && `已投 ${waited} 天`,
    !active && it.decidedAt && `${fmtDate(it.decidedAt)} 决定`,
    ch && `<span class="${Date.now() - ch < 3 * DAY ? 'hot' : ''}">${ago(ch)}有变化</span>`,
  ].filter(Boolean);
  const attrs = interactive ? ` tabindex="0" role="button" aria-expanded="false"` : '';
  return `<div class="ms${compact ? ' compact' : ''}${active ? '' : ' done'}${it.unseen ? ' unseen' : ''}" data-key="${esc(it.key)}"${attrs}>
    ${stageBadge(it.stage)}
    <div class="t" title="${esc(it.title)}">${it.unseen ? '<span class="new">新</span>' : ''}${esc(it.title || '（无标题）')}</div>
    ${compact ? '' : `<span class="id">${esc(it.manuscriptId || '')}</span>`}
    <div class="meta">${meta.join(' · ')}</div>
  </div>`;
}

/** 期刊卡片的头部：全名、缩写、稿件数。 */
export function journalHead(g) {
  const count = g.active ? `${g.active} 篇进行中` : `${g.items.length} 篇`;
  return `<header><h3 title="${esc(g.name)}">${esc(g.name)}</h3>${g.abbr ? `<span class="abbr">${esc(g.abbr)}</span>` : ''}<span class="count">${count}</span></header>`;
}

/** 线条图标，来自 Lucide（ISC 许可）。 */
export const ICON = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

/** 打开追踪面板（已经开着就切过去），可以带上页签或稿件，例如 #accounts、#ms=<key>。 */
export async function openPanel(hash = '') {
  const base = chrome.runtime.getURL('ui/options.html');
  // 扩展自己的页面用 getContexts 就能找到，不需要 tabs 权限
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'] }).then((l) => l.filter((c) => c.documentUrl?.startsWith(base)));
  if (ctx) {
    await chrome.tabs.update(ctx.tabId, { active: true, url: base + hash });
    await chrome.windows.update(ctx.windowId, { focused: true });
  } else await chrome.tabs.create({ url: base + hash });
}

export function peopleText(it) {
  return (it.people || []).map((p) => `${p.role}: ${p.name}`).join('；');
}

export function reviewText(it) {
  const r = it.extra?.reviewSummary;
  if (!r) return '';
  return `审稿邀请 ${r.ReviewInvitationsSent ?? '?'} · 接受 ${r.ReviewInvitationsAccepted ?? '?'} · 完成 ${r.ReviewsCompleted ?? '?'}`;
}

/** 导出成 投稿记录.md 的风格：按论文分组，每次投稿一个代码块。 */
export function toMarkdown(itemsObj) {
  const items = prepareItems(itemsObj);
  const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9一-龥]+/g, '');
  const groups = new Map();
  for (const it of items) {
    const k = norm(it.title) || it.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [`<!-- mituan 投稿追踪导出 ${new Date().toLocaleString()} -->`, ''];
  for (const list of groups.values()) {
    list.sort((a, b) => (a.submittedAt || a.firstSeenAt) - (b.submittedAt || b.firstSeenAt));
    out.push(`### ${list[0].title || '（无标题）'}`);
    list.forEach((it, i) => {
      out.push(`#### ${i + 1}. ${it.venue || PLATFORM_LABEL[it.platform]}（${it.manuscriptId || '—'}）`, '```');
      if (it.people?.length) out.push(peopleText(it));
      if (it.submittedAt) out.push(`${fmtDate(it.submittedAt)}: Submitted`);
      for (const h of it.history || []) out.push(`${fmtDate(h.at)}: ${h.status}${h.initial ? '（首次记录）' : ''}`);
      if (it.decidedAt && !(it.history || []).some((h) => fmtDate(h.at) === fmtDate(it.decidedAt))) out.push(`${fmtDate(it.decidedAt)}: 决定日期`);
      const rv = reviewText(it);
      if (rv) out.push(rv);
      out.push('```');
    });
    out.push('');
  }
  return out.join('\n');
}

// ───────── mituan 品牌与通用组件 ─────────

export const BRAND = {
  name: 'mituan',
  product: '投稿追踪',
  homepage: 'https://tracker.eonmaze.com/', // 产品官网（顶部 logo 链接）
  author: 'https://mituan-ai.github.io/', // mituan 个人主页
  github: 'https://github.com/mituan-ai/manuscript-tracker',
};

export const footerHtml = () =>
  `Crafted with ♥ by <a href="${BRAND.author}" target="_blank"><b>mituan</b></a> · 免费使用 · <a href="${BRAND.homepage}" target="_blank">官网</a> · <a href="${BRAND.github}" target="_blank">GitHub</a> · <a href="${BRAND.github}/issues" target="_blank">反馈问题</a>`;

/** 阶段徽章：文字和边框用阶段色，背景是同色的淡色。 */
export function stageBadge(stage) {
  const st = STAGES[stage] || STAGES.unknown;
  return `<span class="stage" style="color:${st.color};background:${st.color}1f;border-color:${st.color}55">${st.label}</span>`;
}

/* 主题：system / dark / light，与 mituan 控制台共用 mt-theme。图标来自 Lucide（ISC 许可）：monitor / moon / sun */
const THEME_ICONS = {
  system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
};
const THEME_TITLE = { system: '跟随系统', dark: '暗色', light: '亮色' };

export function currentTheme() {
  try {
    return localStorage.getItem('mt-theme') || 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(t) {
  try {
    if (t === 'system') localStorage.removeItem('mt-theme');
    else localStorage.setItem('mt-theme', t);
  } catch {}
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  document.querySelectorAll('.theme button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
}

export function themeSwitchHtml() {
  const cur = currentTheme();
  return `<span class="theme" role="group" aria-label="主题">${Object.keys(THEME_ICONS)
    .map(
      (t) => `<button type="button" data-t="${t}" class="${t === cur ? 'on' : ''}" title="${THEME_TITLE[t]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${THEME_ICONS[t]}</svg></button>`,
    )
    .join('')}</span>`;
}

export function bindThemeSwitch(root = document) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('.theme button');
    if (b) setTheme(b.dataset.t);
  });
}

export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 1800);
}

/** 诊断信息：用于反馈问题。只含平台状态、设置和运行日志，不含账号、密码和稿件标题。 */
export async function diagnostics(state) {
  const { logs = [] } = await chrome.storage.local.get('logs');
  const items = Object.values(state.items);
  return JSON.stringify(
    {
      product: `${BRAND.name} ${BRAND.product}`,
      version: chrome.runtime.getManifest().version,
      userAgent: navigator.userAgent,
      at: new Date().toISOString(),
      settings: state.settings,
      accounts: Object.fromEntries(Object.entries(state.creds.creds).map(([k, v]) => [k, { source: v.source, savedAt: v.savedAt }])),
      elsevierLinks: state.creds.elsevierCount,
      discovered: { scholaroneSites: state.discovered.scholaroneSites, tcctConfids: state.discovered.tcctConfids },
      platforms: state.platforms,
      items: Object.fromEntries(Object.keys(PLATFORM_LABEL).map((p) => [p, items.filter((i) => i.platform === p).length])),
      logs: logs.slice(-100).map((l) => `${new Date(l.at).toISOString()} ${l.level || 'info'} [${l.source}] ${l.msg}`),
    },
    null,
    2,
  );
}
