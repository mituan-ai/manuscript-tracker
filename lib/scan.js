// 通用稿件列表识别：不针对具体期刊或出版社，在任意投稿系统的页面里找"稿件号或标题 + 状态"的表格。
// 用在三处：弹窗里的「追踪这些稿件」、后台刷新已添加的网站、你再次打开这些网站时顺手更新。
// Editorial Manager、eJournalPress 等系统没有逐一实测；识别不到时返回空列表，不会猜。

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const text = (el) => clean(el?.textContent);

/** 表头文字 → 列的含义。按顺序匹配，第一个命中的算数（"Status Date" 是日期，不是状态）。 */
const COLUMNS = [
  ['id', /^((manuscript|submission|paper|article|ms|tracking|reference|ref)\.?\s*(number|no\.?|num\.?|id|#)|(manuscript|submission|paper)\s*#|id|#|no\.?|(稿件|投稿|论文|文章)?(编号|稿号))$/i],
  ['title', /^((manuscript|submission|paper|article)\s+)?title\b|^(标题|题目|(论文|文章|稿件)(标题|题目|名称))$/i],
  ['status', /^((current|manuscript|submission|review|paper|article)\s+)?(status|stage)$|^current stage\b|^status\b(?!\s*date)|^decision( status)?$|^(当前|稿件|处理|审稿)?(状态|进度)$/i],
  ['submitted', /date submitted|^submitted( on| date)?$|^submission date|^(date )?received|^first received|^initial date|^(投稿|提交|收稿)(日期|时间)/i],
  ['updated', /status date|last (update|updated|modified|action|activity)|latest action|^updated|^decision date|^(状态|更新|处理)(日期|时间)|^最后更新/i],
  ['journal', /^(journal|conference|venue|publication)( name| title)?$|^(期刊|会议|刊物)(名称)?$/i],
];

function columnOf(label) {
  const s = clean(label.replace(/[▲▼↑↓⇅:：*]+/g, ' ')).toLowerCase();
  if (!s || s.length > 40) return null;
  return COLUMNS.find(([, re]) => re.test(s))?.[0] || null;
}

const ROLE_TABLE = '[role=table],[role=grid],[role=treegrid]';
const ROLE_CELL = '[role=columnheader],[role=rowheader],[role=cell],[role=gridcell]';

/** 表格（或 ARIA 表格）的直接行，每行是单元格数组；嵌套表格里的行不算。 */
function gridOf(root) {
  if (root.tagName?.toUpperCase() === 'TABLE') {
    return [...root.querySelectorAll('tr')]
      .filter((tr) => tr.closest('table') === root)
      .map((tr) => [...tr.children].filter((c) => /^(TD|TH)$/i.test(c.tagName)));
  }
  return [...root.querySelectorAll('[role=row]')]
    .filter((r) => r.closest(ROLE_TABLE) === root)
    .map((r) => [...r.querySelectorAll(ROLE_CELL)].filter((c) => c.closest('[role=row]') === r));
}

/** 去掉单元格里的操作链接（"View Submission" 之类）；整格就是一个链接时保留链接文字。 */
function cellText(el) {
  if (!el) return '';
  const copy = el.cloneNode(true);
  for (const x of copy.querySelectorAll('script, style, button, select, [hidden], [aria-hidden=true]')) x.remove();
  const full = text(copy);
  for (const a of copy.querySelectorAll('a')) a.remove();
  const rest = text(copy);
  return rest.length >= 3 ? rest : full;
}

const looksLikeId = (s) => !!s && s.length <= 40 && /\d/.test(s);

function rowsOfGrid(grid) {
  const headerIdx = grid.slice(0, 5).findIndex((cells) => {
    const kinds = cells.map((c) => columnOf(text(c)));
    return kinds.includes('status') && (kinds.includes('id') || kinds.includes('title'));
  });
  if (headerIdx < 0) return null;
  const kinds = grid[headerIdx].map((c) => columnOf(text(c)));
  const col = (k) => kinds.indexOf(k);
  const out = [];
  for (const cells of grid.slice(headerIdx + 1)) {
    if (cells.length < kinds.length - 1) continue; // 展开的详情行、分组标题行
    const get = (k) => (col(k) >= 0 ? cellText(cells[col(k)]) : '');
    const status = get('status').slice(0, 200);
    let id = get('id').replace(/\s*\(.*$/, '');
    const title = get('title').slice(0, 400);
    if (!looksLikeId(id)) id = '';
    if (!status || (!id && title.length < 8)) continue;
    out.push({ id, title, status, submitted: get('submitted') || null, updated: get('updated') || null, journal: get('journal') || null });
  }
  return out;
}

// 文件夹式的菜单页（例如 Editorial Manager 的 Author Main Menu）：「Submissions Being Processed (2)」这类链接
const FOLDER = /\b(submissions?|revisions?|manuscripts?|papers?)\b|稿件|投稿|修改稿/i;
const FOLDER_SKIP = /incomplete|draft|waiting for author|sent back|未完成|草稿/i;

function foldersOf(doc, url) {
  const out = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const label = text(a);
    const m = /\((\d+)\)\s*$/.exec(label);
    if (!m || +m[1] === 0 || !FOLDER.test(label) || FOLDER_SKIP.test(label)) continue;
    let href;
    try {
      href = new URL(a.getAttribute('href'), url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(href.protocol) || href.origin !== new URL(url).origin || seen.has(href.href)) continue;
    seen.add(href.href);
    out.push({ url: href.href, name: label.replace(/\s*\(\d+\)\s*$/, ''), count: +m[1] });
  }
  return out.slice(0, 8);
}

// 页面标题里的通用词，不是期刊名
// 页面标题里的通用词，不是期刊名（"… for Author 张三" 这类带姓名的部分整段去掉）
const GENERIC = /editorial manager|manuscript (tracking|submission|central)|scholarone( manuscripts)?|author (main menu|dashboard|cent(er|re)|home|area)|submissions? (being processed|with a decision)|my (submissions|manuscripts|papers)|submission system|peer review|dashboard|home ?page|log ?in|sign ?in|welcome|\bfor author\b.*$|^(home|main menu|menu|author)$|作者(中心|首页)|投稿系统|我的(稿件|投稿)/gi;
const EDGE = /^[\s\-–—|:·•]+|[\s\-–—|:·•]+$/g;

function journalOf(doc, url) {
  const cands = [
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content'),
    doc.querySelector('meta[name="application-name"]')?.getAttribute('content'),
    text(doc.querySelector('.journal-name, .journalName, #journalName, [id$=JournalName], [class*=journal-title], a.brand, .navbar-brand')),
    text(doc.querySelector('title')),
    text(doc.querySelector('h1')),
  ];
  for (const c of cands) {
    const name = clean(String(c || '').replace(/[®™]/g, ''))
      .split(/\s+[|–—•·:]\s+|\s+-\s+/)
      .map((p) => clean(clean(p).replace(GENERIC, ' ')).replace(EDGE, ''))
      .find((p) => p.length >= 3 && p.length <= 120 && /[a-z一-龥]/i.test(p));
    if (name) return name;
  }
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
  return seg && !/\.(aspx?|php|html?|pl|jsp)$/i.test(seg) ? seg.toUpperCase() : new URL(url).hostname.replace(/^www\./, '');
}

// 一个网址下按路径第一段区分期刊的投稿系统（www.editorialmanager.com/<期刊>/…）
const MULTI_TENANT = /(^|\.)(editorialmanager\.com|manuscriptcentral\.com)$/i;

/** 同一个期刊（网站）的标识：用于合并同一网站多个页面的稿件。 */
export function siteOf(url) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean)[0];
  return MULTI_TENANT.test(host) && seg ? `${host}/${seg.toLowerCase()}` : host;
}

/** 访问权限按网站申请（不分端口），例如 https://www.editorialmanager.com/*。 */
export function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

/** 已有专门支持的网站：不走通用识别。 */
export const NATIVE_HOSTS = /^(mc\.manuscriptcentral\.com|ieee\.submission\.researchexchange\.com|ieee-rex\.scienceconnect\.io|ifac-sms\.org|ifac\.papercept\.net|cms\.amss\.ac\.cn|track\.authorhub\.elsevier\.com)$/i;

/**
 * 识别页面里的稿件。
 * @returns {{rows: object[], tables: number, folders: object[], journal: string, login: boolean}}
 *   tables：识别出的稿件表格个数（为 0 且没有稿件时，说明这不是稿件列表页，或者登录过期了）。
 */
export function scanPage(doc, url) {
  const rows = [];
  let tables = 0;
  for (const root of doc.querySelectorAll(`table, ${ROLE_TABLE}`)) {
    const r = rowsOfGrid(gridOf(root));
    if (!r) continue;
    tables++;
    rows.push(...r);
  }
  const seen = new Set();
  const unique = rows.filter((r) => {
    const k = r.id || r.title.toLowerCase();
    return !seen.has(k) && seen.add(k);
  });
  return {
    rows: unique.slice(0, 300),
    tables,
    folders: unique.length ? [] : foldersOf(doc, url),
    journal: journalOf(doc, url),
    login: !unique.length && !!doc.querySelector('input[type=password]'),
  };
}
