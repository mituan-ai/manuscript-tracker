// 把各平台的原始状态归到统一阶段，并解析各种日期格式。

import { L } from './i18n.js';

// label 是 getter：每次读取时按当前界面语言取
const stage = (zh, en, rest) => Object.defineProperty(rest, 'label', { get: () => L(zh, en), enumerable: true });

export const STAGES = {
  submitted: stage('已投稿', 'Submitted', { order: 1, color: '#64748b' }),
  editor: stage('编辑处理', 'With editor', { order: 2, color: '#0891b2' }),
  reviewing: stage('审稿中', 'In review', { order: 3, color: '#2563eb' }),
  deciding: stage('待决定', 'Awaiting decision', { order: 4, color: '#7c3aed' }),
  revision: stage('需修改', 'Revision', { order: 5, color: '#d97706' }),
  revised: stage('已修回', 'Revised', { order: 6, color: '#a3a3a3', final: true }),
  accepted: stage('接收', 'Accepted', { order: 7, color: '#16a34a', final: true }),
  rejected: stage('拒稿', 'Rejected', { order: 8, color: '#dc2626', final: true }),
  withdrawn: stage('已撤回', 'Withdrawn', { order: 9, color: '#9ca3af', final: true }),
  unknown: stage('其他', 'Other', { order: 10, color: '#9ca3af' }),
};

// 按顺序匹配，第一个命中的算数。前面是各平台实测过的状态，后面补了 Editorial Manager、eJournalPress、
// MDPI、OJS 和中文期刊系统里常见的说法（通用识别用，未逐一实测）。
const RULES = [
  // ScholarOne 旧版本：已经交了修改稿，新版本（.R1、.R2）另起一行跟踪
  ['revised', /a revision has been submitted|revision (has been )?submitted|已提交修改稿/i],
  ['revision', /reject.{0,20}(resubmi|option)|revise and resubmit|(major|minor) revisions?|revisions? (required|requested|needed)|awaiting revision|\brevise\b|需修改|修改后|退修|返修/i],
  ['rejected', /not (been )?accepted|不录用|未录用|不接受|未被接受/i],
  ['accepted', /\baccept|录用|已接收|接受|in production|production completed|copyedit|in press|\bpublished\b|已发表|已出版|待出版|已见刊/i],
  ['rejected', /\breject|\bdeclined?\b|拒稿|退稿|不录用|未录用/i],
  ['withdrawn', /withdraw|撤稿|撤回/i],
  ['deciding', /required reviews? complete|review complete|^reviews? completed?$|awaiting .*(decision|recommendation)|decision in process|pending (editor'?s? )?decision|decision pending|make decision|待决定|终审/i],
  ['editor', /(ae|editor|eic|ade)\s+assignment|with (the )?editor|editor (invited|assigned)|assigned to (an? )?editor|in eic office|awaiting (ae|eic|editor)|under (editorial )?consideration|editorial (assessment|check|review)|编辑|初审/i],
  ['reviewing', /review|审稿|评审|审查中|外审|复审|送审/i],
  ['submitted', /submitted|received|admin|checklist|initial|technical check|quality check|已收到|初稿|已投稿|待审/i],
];

export function stageOf(status) {
  const s = status || '';
  for (const [key, re] of RULES) if (re.test(s)) return key;
  return 'unknown';
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** 返回毫秒时间戳（只有日期时取本地零点，和 fmtDate 的本地显示对应）；无法解析时返回 null。支持 03-Mar-2026、2026-03-05、March 5, 2026、ISO、秒级时间戳。 */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const s = String(v).trim();
  let m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] != null) return new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1]).getTime();
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** 03-Mar-2026 风格，和 ScholarOne、投稿记录.md 一致。 */
export function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const mon = Object.keys(MONTHS)[d.getMonth()];
  return `${String(d.getDate()).padStart(2, '0')}-${mon[0].toUpperCase()}${mon.slice(1)}-${d.getFullYear()}`;
}

/** 去掉修订号，用于把 ReX 和 ScholarOne 的同一篇稿件对上。 */
export const baseManuscriptId = (id) => (id || '').replace(/\.R\d+$/i, '').trim().toUpperCase();

const titleKey = (t) => (t || '').toLowerCase().replace(/[^a-z0-9一-龥]+/g, '');

/**
 * 收到"需修改 / 可重投"决定后，又提交了同标题的新稿件（重投会换新稿号，ScholarOne 不会在旧稿件上标注），
 * 旧稿件就算已修回，不再算进行中。items 需已带 stage。
 */
export function markResubmitted(items) {
  const byTitle = new Map();
  for (const i of items) {
    const k = titleKey(i.title);
    if (k.length < 12) continue;
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(i);
  }
  return items.map((i) => {
    const since = i.decidedAt || i.lastChangedAt;
    if (i.stage !== 'revision' || !since) return i;
    const later = (byTitle.get(titleKey(i.title)) || []).find(
      (b) => b.submittedAt && b.submittedAt >= since - 86400000 && baseManuscriptId(b.manuscriptId) !== baseManuscriptId(i.manuscriptId),
    );
    return later ? { ...i, stage: 'revised', resubmittedAs: later.manuscriptId } : i;
  });
}

/** IEEE Author Portal 的条目如果 ScholarOne 里有更详细的，就隐藏（同一篇稿件只算一次）。 */
export function hideDuplicates(items) {
  const s1Ids = new Set(items.filter((i) => i.platform === 'scholarone').map((i) => baseManuscriptId(i.manuscriptId)));
  return items.filter((i) => i.platform !== 'rex' || !s1Ids.has(baseManuscriptId(i.manuscriptId)));
}
