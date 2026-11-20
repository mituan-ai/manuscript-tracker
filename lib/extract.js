// 页面解析：输入 Document，输出纯 JSON。
// 在 offscreen 文档里用浏览器的 DOMParser 运行；测试时用 linkedom 运行同一份代码。

import { scanPage } from './scan.js'; // 其他投稿系统的通用识别

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const text = (el) => clean(el?.textContent);

/** 去掉元素里的链接后取文本（例如标题单元格里的 "View Submission"）。 */
function textWithoutLinks(el) {
  if (!el) return '';
  const copy = el.cloneNode(true);
  for (const a of copy.querySelectorAll('a, script, style')) a.remove();
  return text(copy);
}

/** 按浏览器提交表单的规则收集字段（跳过按钮和未勾选的复选框）。 */
export function formPairs(form) {
  if (!form) return [];
  const els = form.elements?.length ? [...form.elements] : [...form.querySelectorAll('input, select, textarea')];
  const pairs = [];
  for (const el of els) {
    const name = el.getAttribute('name');
    if (!name) continue;
    const tag = el.tagName.toUpperCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (['button', 'submit', 'image', 'reset', 'file'].includes(type) || tag === 'BUTTON') continue;
    if ((type === 'checkbox' || type === 'radio') && !el.hasAttribute('checked')) continue;
    let value;
    if (tag === 'SELECT') {
      const opt = el.querySelector('option[selected]') || el.querySelector('option');
      value = opt ? opt.getAttribute('value') ?? text(opt) : '';
    } else if (tag === 'TEXTAREA') value = el.textContent;
    else value = el.getAttribute('value') ?? '';
    pairs.push([name, value]);
  }
  return pairs;
}

const absUrl = (href, base) => {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
};

/** 表格的直接行（不含嵌套表格里的行）。 */
function ownRows(table) {
  return [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
}
const ownCells = (tr) => [...tr.children].filter((c) => /^(TD|TH)$/i.test(c.tagName));

// ───────────────────────── IEEE ScholarOne ─────────────────────────

const S1_SKIP_QUEUE = /draft|unsubmitted|e-?mail|incomplete|invited|invitation/i;

function s1Rows(doc) {
  const table = doc.getElementById('authorDashboardQueue');
  if (!table) return null;
  const rows = [];
  for (const tr of ownRows(table)) {
    const cells = {};
    for (const td of ownCells(tr)) {
      const label = (td.getAttribute('data-label') || '').toLowerCase();
      if (label) cells[label] = td;
    }
    if (!cells.id) continue;
    const st = cells.status;
    const people = [];
    for (const nobr of st?.querySelectorAll('nobr') || []) {
      const m = /^([A-Za-z-]{2,8}):\s*(.+)$/.exec(text(nobr));
      if (m) people.push({ role: m[1].toUpperCase(), name: m[2] });
    }
    let lines = [...(st?.querySelectorAll('.pagecontents') || [])].map(textWithoutLinks).filter(Boolean);
    if (!lines.length && st) {
      lines = [textWithoutLinks(st).replace(/Contact Journal/gi, '')];
      for (const p of people) lines[0] = lines[0].replace(`${p.role}: ${p.name}`, '');
      lines = lines.map(clean).filter(Boolean);
    }
    rows.push({
      id: text(cells.id).replace(/\s*\(.*$/, ''),
      title: textWithoutLinks(cells.title),
      status: [...new Set(lines)].join(' / '),
      people,
      created: text(cells.created) || null,
      submitted: text(cells.submitted) || null,
      decisioned: text(cells.decisioned) || null,
      action: textWithoutLinks(cells.action) || null,
    });
  }
  return rows;
}

function s1Queues(doc, pairs) {
  const queues = [];
  for (const a of doc.querySelectorAll('a[href*="MS_LIST_TO_DISPLAY"]')) {
    const m = /MS_LIST_TO_DISPLAY'\s*,\s*'?(\d+)'?/.exec(a.getAttribute('href'));
    if (!m) continue;
    const name = text(a).replace(/^\d+\s+/, '');
    queues.push({ value: m[1], name, skip: S1_SKIP_QUEUE.test(name) });
  }
  const current = pairs.find(([k]) => k === 'MS_LIST_TO_DISPLAY')?.[1] ?? null;
  const seen = new Set();
  return {
    current,
    queues: queues.filter((q) => q.value !== current && !seen.has(q.value) && seen.add(q.value)),
  };
}

export function s1Page(doc, url) {
  const form = doc.forms?.[0] || doc.querySelector('form');
  const pairs = formPairs(form);
  const html = doc.documentElement?.outerHTML || '';
  const authorHref = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').find((h) => /AUTHOR_VIEW_MANUSCRIPTS/.test(h));
  const roleId = authorHref ? /'XIK_CUR_ROLE_ID'\s*,\s*'([^']+)'/.exec(authorHref)?.[1] || null : null;
  const rows = s1Rows(doc);
  const hasPassword = !!doc.querySelector('input[type=password]');
  const loginError = text(doc.querySelector('#notificationDiv .alert-error, #notificationDiv .alert-danger, .alert-error'));
  let kind = 'unknown';
  if (hasPassword && doc.querySelector('[name=USERID], #USERID')) kind = 'login';
  else if (rows) kind = 'dashboard';
  else if (roleId) kind = 'menu';
  else if (form) kind = 'boot';
  return {
    kind,
    url,
    title: text(doc.querySelector('title')),
    journal: text(doc.querySelector('a.brand')) || null, // 页面顶部的期刊全名
    action: form ? absUrl(form.getAttribute('action') || url, url) : null,
    pairs,
    roleId,
    loginAction: /var loginAction\s*=\s*'([^']+)'/.exec(html)?.[1] || null,
    homePage: /var homePage\s*=\s*'([^']+)'/.exec(html)?.[1] || null,
    loginError,
    rows,
    ...s1Queues(doc, pairs),
  };
}

// ───────────────────────── IFAC PaperPlaza ─────────────────────────

function ppRows(doc) {
  for (const table of doc.querySelectorAll('table')) {
    const rows = ownRows(table);
    const headerIdx = rows.findIndex((tr) => ownCells(tr).some((c) => /^Submission number$/i.test(text(c))));
    if (headerIdx < 0) continue;
    const header = ownCells(rows[headerIdx]).map((c) => text(c).toLowerCase());
    const col = (re) => header.findIndex((h) => re.test(h));
    const idx = {
      id: col(/^submission number/),
      version: col(/^version/),
      type: col(/^type/),
      status: col(/^status/),
      title: col(/^title/),
      authors: col(/^authors/),
      received: col(/first received/),
      latest: col(/latest action/),
      action: col(/required action/),
    };
    const out = [];
    for (const tr of rows.slice(headerIdx + 1)) {
      const cells = ownCells(tr);
      if (cells.length < header.length - 1) continue;
      const cell = (k) => (idx[k] >= 0 ? cells[idx[k]] : null);
      const id = text(cell('id'));
      if (!/\d/.test(id)) continue;
      out.push({
        id,
        version: text(cell('version')),
        type: text(cell('type')),
        status: text(cell('status')),
        title: text(cell('title')),
        authors: text(cell('authors')),
        received: cell('received')?.getAttribute('value') || text(cell('received')) || null,
        latest: cell('latest')?.getAttribute('value') || text(cell('latest')) || null,
        action: text(cell('action')).replace(/^None$/i, '') || null,
      });
    }
    return out;
  }
  return null;
}

export function ppPage(doc, url) {
  const html = doc.documentElement?.outerHTML || '';
  const form = doc.forms?.[0] || doc.querySelector('form');
  const commands = [...new Set([...html.matchAll(/command\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
  const enterLinks = [];
  for (const a of doc.querySelectorAll('a[href*="login.pl?PIN="]')) {
    const href = absUrl(a.getAttribute('href'), url);
    const row = a.closest('tr');
    enterLinks.push({ href, text: text(a), context: text(row || a.parentElement).slice(0, 200) });
  }
  const errEl = [...doc.querySelectorAll('font[color], .error, .alert, span[style*="red"], b')].find((e) =>
    /incorrect|invalid|not (valid|recognized|found)|failed|wrong|denied|locked/i.test(text(e)),
  );
  return {
    url,
    title: text(doc.querySelector('title')),
    hasPassword: !!doc.querySelector('input[type=password]'),
    action: form ? absUrl(form.getAttribute('action') || url, url) : null,
    pairs: formPairs(form),
    // 会议页的 command() 会在命令后加 ".x"，期刊页（external.v2.js）不加
    commandSuffix: /Command\.value\s*=\s*commandValue\s*\+\s*'\.x'/.test(html) ? '.x' : '',
    commands,
    enterLinks,
    loginError: errEl ? text(errEl).slice(0, 200) : null,
    securityViolation: /Security violation/i.test(html),
    rows: ppRows(doc),
  };
}

// ───────────────────────── TCCT CMS ─────────────────────────

export function tcctAuthor(doc, url) {
  let rows = null;
  for (const table of doc.querySelectorAll('table')) {
    const trs = ownRows(table);
    const headerIdx = trs.findIndex((tr) => ownCells(tr).some((c) => text(c) === '投稿编号'));
    if (headerIdx < 0) continue;
    const header = ownCells(trs[headerIdx]).map(text);
    const col = (name) => header.indexOf(name);
    rows = [];
    for (const tr of trs.slice(headerIdx + 1)) {
      const cells = ownCells(tr);
      const get = (name) => (col(name) >= 0 ? cells[col(name)] : null);
      const id = text(get('投稿编号'));
      if (!/^\d+$/.test(id)) continue;
      const info = get('基本信息');
      const infoText = text(info);
      const title = /题目[:：]\s*(.+?)(?=\s*(作者|Authors?|关键词|摘要)[:：]|$)/.exec(infoText)?.[1] || infoText;
      rows.push({
        id,
        type: text(get('投稿类型')),
        title: clean(title),
        track: text(get('所属方向')),
        status: text(get('当前状态')),
        fee: text(get('付费信息')) || null,
      });
    }
    break;
  }
  const short = [...doc.querySelectorAll('td.bkHeader b, .bkHeader b')].map(text).find((t) => /\d{4}/.test(t)) || null;
  return {
    url,
    loggedIn: !doc.getElementById('loginform') && !doc.querySelector('input[type=password]'),
    confShort: short,
    confName: text(doc.querySelector('h3')) || null,
    rows,
  };
}

export function tcctConfids(doc) {
  const ids = new Set();
  for (const a of doc.querySelectorAll('a[href*="author.php?confid="]')) {
    const m = /confid=(\d+)/.exec(a.getAttribute('href'));
    if (m) ids.add(Number(m[1]));
  }
  return [...ids].sort((a, b) => b - a);
}

export const EXTRACTORS = { s1Page, ppPage, tcctAuthor, tcctConfids, webPage: scanPage };
