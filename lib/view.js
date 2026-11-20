// 界面用的稿件视图：按期刊归并、进行中判断、问题提示。
// 投稿系统（ScholarOne、PaperPlaza……）只在后台使用；界面上按期刊和稿件展示，账号按"哪类期刊"组织。

import { STAGES, stageOf, hideDuplicates, markResubmitted } from './normalize.js';

const DAY = 86400000;

/** 账号分组：用户按"投哪类期刊"理解账号，而不是按投稿系统。 */
export const FAMILIES = [
  // IEEE TAC、RA-L 等少数期刊用 PaperCept 投稿，不在这里
  { id: 'ieee', name: 'IEEE 期刊', covers: 'TPAMI、TII、TMI 等用 ScholarOne 或 IEEE Author Portal 投稿的 IEEE 期刊', adapters: ['scholarone', 'rex'] },
  { id: 'elsevier', name: 'Elsevier 期刊', covers: 'Elsevier 旗下期刊，凭投稿确认邮件里的追踪链接查询，不需要登录', adapters: ['elsevier'] },
  { id: 'ifac', name: 'Automatica 与 IFAC 会议', covers: 'Automatica、IFAC 世界大会等 IFAC 期刊和会议', adapters: ['paperplaza'] },
  { id: 'tcct', name: 'CCDC、CCC 等会议', covers: '中国控制与决策会议、中国控制会议等 TCCT 会议', adapters: ['tcct'] },
  { id: 'other', name: '其他期刊与会议', covers: 'Springer Nature、Wiley、Taylor & Francis、医学期刊等：在投稿网站的稿件列表页点扩展图标添加', adapters: ['web'] },
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
    const name = (it.venue || '').trim() || '未注明期刊';
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
export const FILTERS = {
  active: { label: '进行中', test: isActive },
  revision: { label: '需修改', test: (it) => isActive(it) && it.stage === 'revision' },
  results: { label: '近 30 天有结果', test: isRecentResult },
  all: { label: '全部稿件', test: () => true },
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
      if (stale.length)
        out.push({ id: a.id, family: 'other', level: 'warn', own: true, title: `${stale.map((w) => w.journal).slice(0, 2).join('、')}${stale.length > 2 ? ` 等 ${stale.length} 个网站` : ''}的登录已过期`, detail: '打开一次那个网站的稿件列表页就会恢复更新。' });
    }
    const fam = familyOf(a.id);
    const acct = ACCOUNT_LABEL[a.id] || fam.name;
    if (p.windowId) out.push({ id: a.id, family: fam.id, level: 'action', title: `${fam.name}：登录窗口在等你完成验证`, detail: p.message, windowId: p.windowId });
    else if (p.status === 'auth-rejected') out.push({ id: a.id, family: fam.id, level: 'action', title: `${acct}的密码被拒绝了`, detail: '更新密码后会自动重新查询。', fix: 'account' });
    else if (p.status === 'need-human') out.push({ id: a.id, family: fam.id, level: 'action', title: `${fam.name}：需要你手动登录一次`, detail: p.message, fix: 'open' });
    else if (['blocked', 'parse-error', 'error', 'partial'].includes(p.status))
      out.push({ id: a.id, family: fam.id, level: 'warn', title: `${fam.name}有一部分暂时没查到`, detail: p.message });
  }
  return out;
}

/** 账号的叫法（用户在哪个网站登录用的账号）。 */
export const ACCOUNT_LABEL = {
  scholarone: 'IEEE 投稿账号',
  rex: 'IEEE 账号',
  paperplaza: 'PaperPlaza 账号',
  tcct: 'TCCT 账号',
  elsevier: 'Elsevier 追踪链接',
  web: '其他投稿网站',
};

/** 最近一次查询的时间（任一来源）。 */
export const lastCheckedAt = (state) => Math.max(0, ...Object.values(state.platforms || {}).map((p) => p.lastRunAt || 0)) || null;
