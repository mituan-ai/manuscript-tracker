// 界面用的稿件视图：按期刊归并、进行中判断、问题提示。
// 投稿系统（ScholarOne、PaperPlaza……）只在后台使用；界面上按期刊和稿件展示，账号按"哪类期刊"组织。

import { STAGES, stageOf, hideDuplicates, markResubmitted } from './normalize.js';
import { L, loc } from './i18n.js';

const DAY = 86400000;

/** 账号分组：用户按"投哪类期刊"理解账号，而不是按投稿系统。 */
// name、covers 是 getter：每次读取时按当前界面语言取
const family = (id, name, covers, adapters) => ({
  id,
  get name() {
    return L(...name);
  },
  get covers() {
    return L(...covers);
  },
  adapters,
});
export const FAMILIES = [
  // IEEE TAC、RA-L 等少数期刊用 PaperCept 投稿，不在这里
  family('ieee', ['IEEE 期刊', 'IEEE journals'], ['TPAMI、TII、TMI 等用 ScholarOne 或 IEEE Author Portal 投稿的 IEEE 期刊', 'TPAMI, TII, TMI and other IEEE journals on ScholarOne or IEEE Author Portal'], ['scholarone', 'rex']),
  family('elsevier', ['Elsevier 期刊', 'Elsevier journals'], ['Elsevier 旗下期刊，凭投稿确认邮件中的追踪链接查询，无需登录', 'Elsevier journals, tracked through the link in the submission confirmation email; no sign-in needed'], ['elsevier']),
  family('ifac', ['Automatica 与 IFAC 会议', 'Automatica and IFAC conferences'], ['Automatica、IFAC 世界大会等 IFAC 期刊和会议', 'Automatica, the IFAC World Congress and other IFAC journals and conferences'], ['paperplaza']),
  family('tcct', ['CCDC、CCC 等会议', 'CCDC, CCC and related conferences'], ['中国控制与决策会议、中国控制会议等 TCCT 会议', 'Chinese Control and Decision Conference, Chinese Control Conference and other TCCT conferences'], ['tcct']),
  family('other', ['其他期刊与会议', 'Other journals and conferences'], ['Springer Nature、Wiley、Taylor & Francis 等：在稿件列表页点击扩展图标添加', 'Springer Nature, Wiley, Taylor & Francis and others: open the manuscript list and click the extension icon'], ['web']),
];

export const familyOf = (platform) => FAMILIES.find((f) => f.adapters.includes(platform)) || FAMILIES[0];

/** 给稿件补上阶段；同一篇稿件在两个渠道都有时只留一条。 */
export function prepareItems(itemsObj) {
  return hideDuplicates(markResubmitted(Object.entries(itemsObj).map(([key, it]) => ({ ...it, key, stage: stageOf(it.status) }))));
}

/** 进行中：未结束，且不是 90 天前就给了"可重投"决定却一直没动的。 */
export function isActive(it) {
  if (STAGES[it.stage]?.final) return false;
  if (it.stage === 'revision' && it.decidedAt && Date.now() - it.decidedAt > 90 * DAY) return false;
  return true;
}

/** 结束的时间（决定日期或最后一次变化）。 */
export const endedAt = (it) => Math.max(it.decidedAt || 0, it.lastChangedAt || 0, it.updatedAt || 0) || null;

/** 30 天内有了结果（接收、拒稿等）。 */
export const isRecentResult = (it) => !isActive(it) && !!endedAt(it) && Date.now() - endedAt(it) < 30 * DAY;

/** 真正发生变化的时间：观察到变化，或平台给了日期；只是"第一次看到"时返回 null。 */
export function changedAt(it) {
  if ((it.history || []).some((h) => !h.initial)) return it.lastChangedAt || null;
  if (it.lastChangedAt && it.firstSeenAt && it.firstSeenAt - it.lastChangedAt > 3600000) return it.lastChangedAt;
  return null;
}

const activityAt = (it) => changedAt(it) || it.submittedAt || it.firstSeenAt || 0;

/** 期刊名归一：大小写、标点、& 与 and 的差异不算不同期刊。 */
export const journalKey = (venue) =>
  String(venue || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9一-龥]+/g, '');

// 少数 IEEE 期刊的稿件号前缀和大家常说的缩写不一样
const IEEE_PREFIX = { MM: 'TMM', CYB: 'TCYB', SMCA: 'TSMC', SMC: 'TSMC', SMCC: 'TSMC' };

/** 从稿件号取期刊缩写：TII-26-0412 → TII，T-ASE-2026-0123 → T-ASE，MM-2026-0001 → TMM，JPROCONT-D-26-00123 → JPROCONT。 */
export function abbrOf(id) {
  const m = /^([A-Za-z][A-Za-z-]{1,14}?)-\d/.exec(String(id || '').trim());
  if (!m) return null;
  const p = m[1].toUpperCase().replace(/-[A-Z]$/, ''); // JPROCONT-D、CYB-E 这类后缀不是缩写的一部分
  return IEEE_PREFIX[p] || p;
}

function mostCommon(list) {
  const n = new Map();
  for (const x of list) if (x) n.set(x, (n.get(x) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * 按期刊分组。组内：进行中的在前，然后按最近动静排序；
 * 组间：有进行中稿件的期刊在前，然后按最近动静排序。
 */
export function groupByJournal(items) {
  const groups = new Map();
  for (const it of items) {
    const name = (it.venue || '').trim() || L('未注明期刊', 'Unknown journal');
    const k = journalKey(name) || it.key;
    if (!groups.has(k)) groups.set(k, { key: k, name, items: [] });
    groups.get(k).items.push(it);
  }
  const out = [...groups.values()].map((g) => {
    g.items.sort((a, b) => isActive(b) - isActive(a) || activityAt(b) - activityAt(a));
    const abbr = mostCommon(g.items.map((i) => abbrOf(i.manuscriptId)));
    // IEEE 期刊的缩写以 T、J、L 开头（TII、JBHI、LRA）；不像缩写的前缀就不显示，免得误导
    const plausible = abbr && abbr.length <= 10 && (!/^IEEE/i.test(g.name) || /^[TJL]/.test(abbr));
    g.abbr = plausible && !g.name.toUpperCase().includes(abbr) ? abbr : null;
    g.active = g.items.filter(isActive).length;
    g.lastAt = Math.max(...g.items.map(activityAt));
    return g;
  });
  return out.sort((a, b) => (b.active > 0) - (a.active > 0) || b.lastAt - a.lastAt);
}

/** 稿件筛选：进行中 / 需修改 / 30 天内有结果 / 全部。 */
const filter = (zh, en, test) => ({
  get label() {
    return L(zh, en);
  },
  test,
});
export const FILTERS = {
  active: filter('进行中', 'In progress', isActive),
  revision: filter('需修改', 'Needs revision', (it) => isActive(it) && it.stage === 'revision'),
  results: filter('近 30 天有结果', 'Recent results', isRecentResult),
  all: filter('全部稿件', 'All', () => true),
};

/**
 * 需要用户知道的问题，按账号分组描述，不出现投稿系统内部的名称。
 * level: action = 要你动手（密码被拒、验证码窗口）；warn = 暂时失败，会自动重试。
 */
export function problems(state) {
  const out = [];
  for (const a of state.adapters) {
    const p = state.platforms[a.id] || {};
    if (state.running.includes(a.id)) continue;
    if (a.id === 'web') {
      // 其他投稿网站：登录过期不算故障，打开一次页面就恢复
      const stale = (state.web || []).filter((w) => w.status === 'expired');
      if (stale.length) {
        const names = stale.map((w) => w.journal).slice(0, 2);
        const title = L(
          `${names.join('、')}${stale.length > 2 ? ` 等 ${stale.length} 个网站` : ''}的登录已过期`,
          `Sign-in expired on ${names.join(', ')}${stale.length > 2 ? ` and ${stale.length - 2} more` : ''}`
        );
        out.push({ id: a.id, family: 'other', level: 'warn', own: true, title, detail: L('打开一次那个网站的稿件列表页就会恢复更新。', 'Open the manuscript list on that site once to resume updates.') });
      }
    }
    const fam = familyOf(a.id);
    const acct = ACCOUNT_LABEL[a.id] || fam.name;
    const detail = loc(p.message);
    if (p.windowId) out.push({ id: a.id, family: fam.id, level: 'action', title: L(`${fam.name}：登录窗口在等你完成验证`, `${fam.name}: the sign-in window needs your verification`), detail, windowId: p.windowId });
    else if (p.status === 'auth-rejected') out.push({ id: a.id, family: fam.id, level: 'action', title: L(`${acct}的密码被拒绝了`, `${acct}: password rejected`), detail: L('更新密码后会自动重新查询。', 'Update the password and it will be checked again.'), fix: 'account' });
    else if (p.status === 'need-human') out.push({ id: a.id, family: fam.id, level: 'action', title: L(`${fam.name}：需要你手动登录一次`, `${fam.name}: sign in manually once`), detail, fix: 'open' });
    else if (['blocked', 'parse-error', 'error', 'partial'].includes(p.status))
      out.push({ id: a.id, family: fam.id, level: 'warn', title: L(`${fam.name}有一部分暂时没查到`, `${fam.name}: some manuscripts could not be checked`), detail });
  }
  return out;
}

/** 账号的叫法（用户在哪个网站登录用的账号）。 */
const ACCOUNT_TEXT = {
  scholarone: ['IEEE 投稿账号', 'IEEE submission account'],
  rex: ['IEEE 账号', 'IEEE account'],
  paperplaza: ['PaperPlaza 账号', 'PaperPlaza account'],
  tcct: ['TCCT 账号', 'TCCT account'],
  elsevier: ['Elsevier 追踪链接', 'Elsevier tracking links'],
  web: ['其他投稿网站', 'Other submission sites'],
};
export const ACCOUNT_LABEL = {};
for (const [k, t] of Object.entries(ACCOUNT_TEXT)) Object.defineProperty(ACCOUNT_LABEL, k, { get: () => L(...t), enumerable: true });

/** 最近一次查询的时间（任一来源）。 */
export const lastCheckedAt = (state) => Math.max(0, ...Object.values(state.platforms || {}).map((p) => p.lastRunAt || 0)) || null;
