// 状态归类、日期、合并逻辑和导出。不依赖真实样本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, parseDate, fmtDate, baseManuscriptId } from '../lib/normalize.js';
import { prepareItems, isActive, isRecentResult, toMarkdown } from '../ui/common.js';
import { setLang } from '../lib/i18n.js';

const isCurrent = (i) => isActive(i) || isRecentResult(i); // 弹窗里显示的：进行中，或 30 天内有结果

test('状态归类：各平台真实出现过的状态', () => {
  const cases = {
    // ScholarOne
    'Under Review': 'reviewing',
    Submitted: 'submitted',
    'Accept (02-Feb-2026)': 'accepted',
    'Reject (15-Jun-2026)': 'rejected',
    'Reject with the Option to Resubmit (03-Nov-2026)': 'revision',
    'Minor Revision (19-Sep-2026) / a revision has been submitted': 'revised',
    'Major Revision (01-Oct-2026)': 'revision',
    'Awaiting AE Recommendation': 'deciding',
    'Awaiting EIC Decision': 'deciding',
    'Required Reviews Completed': 'deciding',
    'Awaiting AE Assignment': 'editor',
    'ADE Assignment': 'editor',
    'Awaiting Reviewer Selection': 'reviewing',
    'Awaiting Reviewer Scores': 'reviewing',
    'Awaiting Admin Processing': 'submitted',
    // IEEE Author Portal
    Accepted: 'accepted',
    Rejected: 'rejected',
    'In Review': 'reviewing',
    Withdrawn: 'withdrawn',
    // PaperPlaza / TCCT
    Received: 'submitted',
    已收到初稿: 'submitted',
    录用: 'accepted',
    不录用: 'rejected',
    // Elsevier（适配器先映射成英文描述）
    'With Editor': 'editor',
    'Under Review (3 reviews completed)': 'reviewing',
    'Decision in Process': 'deciding',
    '': 'unknown',
  };
  for (const [s, want] of Object.entries(cases)) assert.equal(stageOf(s), want, s);
});

test('日期解析与格式化', () => {
  assert.equal(parseDate('03-Mar-2026'), new Date(2026, 2, 3).getTime());
  assert.equal(fmtDate(parseDate('03-Mar-2026')), '03-Mar-2026');
  assert.equal(fmtDate(parseDate('2026-03-05')), '05-Mar-2026');
  assert.equal(parseDate('2026-03-05'), new Date(2026, 2, 5).getTime());
  assert.equal(parseDate(1760000000), 1760000000000);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('not a date'), null);
  assert.equal(fmtDate(new Date(2026, 2, 3, 23, 30).getTime()), '03-Mar-2026');
  assert.equal(baseManuscriptId('tii-26-0002.R2'), 'TII-26-0002');
});

const DAY = 86400000;
const now = Date.now();

test('进行中 / 最近结束的判断', () => {
  const mk = (status, extra = {}) => ({ status, platform: 'scholarone', ...extra });
  const [a, b, c, d] = prepareItems({
    a: mk('Under Review'),
    b: mk('Reject with the Option to Resubmit', { decidedAt: now - 200 * DAY, lastChangedAt: now - 200 * DAY }),
    c: mk('Reject (01-Nov-2026)', { decidedAt: now - 5 * DAY }),
    d: mk('Accept', { decidedAt: now - 90 * DAY, lastChangedAt: now - 90 * DAY }),
  });
  assert.equal(isActive(a), true);
  assert.equal(isActive(b), false, '半年前的可重投决定不算进行中');
  assert.equal(isCurrent(b), false);
  assert.equal(isActive(c), false);
  assert.equal(isCurrent(c), true);
  assert.equal(isCurrent(d), false);
});

test('ScholarOne 有详情时隐藏 Author Portal 的重复条目', () => {
  const items = prepareItems({
    'rex:TII-26-0001.R1': { platform: 'rex', manuscriptId: 'TII-26-0001.R1', status: 'Rejected' },
    'scholarone:tii:TII-26-0001.R1': { platform: 'scholarone', manuscriptId: 'TII-26-0001.R1', status: 'Reject with the Option to Resubmit' },
    'rex:MM-000001': { platform: 'rex', manuscriptId: 'MM-000001', status: 'In Review' },
  });
  assert.deepEqual(items.map((i) => i.key).sort(), ['rex:MM-000001', 'scholarone:tii:TII-26-0001.R1']);
});

test('Markdown 导出按论文分组，标题跟随界面语言', () => {
  const items = {
    x: { platform: 'scholarone', venue: 'TII', manuscriptId: 'TII-1', title: 'A Paper', status: 'Reject', submittedAt: new Date(2026, 0, 2).getTime(), firstSeenAt: 1, history: [{ at: new Date(2026, 2, 3).getTime(), status: 'Reject' }] },
    y: { platform: 'scholarone', venue: 'TASE', manuscriptId: 'TASE-2', title: 'A paper.', status: 'Under Review', submittedAt: new Date(2026, 3, 4).getTime(), firstSeenAt: 2, history: [] },
  };
  setLang('zh');
  const md = toMarkdown(items);
  assert.equal((md.match(/^### /gm) || []).length, 1, md);
  assert.match(md, /#### 1\. TII（TII-1）\n```\n02-Jan-2026: Submitted\n03-Mar-2026: Reject\n```/);
  assert.match(md, /#### 2\. TASE（TASE-2）/);
  setLang('en');
  const en = toMarkdown(items);
  assert.match(en, /^<!-- mituan Manuscript Tracker export /);
  assert.match(en, /#### 1\. TII \(TII-1\)\n```\n02-Jan-2026: Submitted/);
  assert.doesNotMatch(en, /[\u4e00-\u9fa5（）]/);
});

test('同一篇稿件 ScholarOne 和 IEEE Author Portal 都有时只算一次（通知、角标、列表一致）', async () => {
  const { hideDuplicates } = await import('../lib/normalize.js');
  const items = [
    { platform: 'scholarone', manuscriptId: 'TII-26-1234.R1' },
    { platform: 'rex', manuscriptId: 'tii-26-1234' },
    { platform: 'rex', manuscriptId: 'TASE-26-9' },
  ];
  assert.deepEqual(hideDuplicates(items).map((i) => i.manuscriptId), ['TII-26-1234.R1', 'TASE-26-9']);
});

test('变化时间：只有"第一次看到"时不算变化', async () => {
  const { changedAt } = await import('../ui/common.js');
  const now = Date.now();
  assert.equal(changedAt({ firstSeenAt: now, lastChangedAt: now, history: [{ at: now, initial: true }] }), null);
  assert.equal(changedAt({ firstSeenAt: now, lastChangedAt: now - 5 * 86400000, history: [{ at: now, initial: true }] }), now - 5 * 86400000);
  assert.equal(changedAt({ firstSeenAt: now - 9e6, lastChangedAt: now, history: [{ at: now - 9e6, initial: true }, { at: now, status: 'x' }] }), now);
});

test('可重投的稿件用新稿号重投后，不再算进行中', () => {
  const d = (s) => Date.parse(s);
  const items = {
    a: { platform: 'scholarone', manuscriptId: 'TII-26-1000', title: 'Graph Learning for Fault Diagnosis', status: 'Reject with the Option to Resubmit (19-Jun-2026)', submittedAt: d('2026-05-18'), decidedAt: d('2026-06-19') },
    b: { platform: 'scholarone', manuscriptId: 'TII-26-2000', title: 'Graph learning for fault diagnosis', status: 'Under Review', submittedAt: d('2026-07-20') },
    c: { platform: 'scholarone', manuscriptId: 'TII-26-3000.R1', title: 'Another Pending Manuscript Title', status: 'Reject with the Option to Resubmit (03-Nov-2026)', submittedAt: d('2026-09-24'), decidedAt: d('2026-11-03') },
    // 同一稿件的修改版本（.R1）不算重投
    e: { platform: 'scholarone', manuscriptId: 'TII-26-3000', title: 'Another Pending Manuscript Title', status: 'Minor Revision', submittedAt: d('2026-07-05'), decidedAt: d('2026-09-16') },
  };
  const list = prepareItems(items);
  const by = Object.fromEntries(list.map((i) => [i.manuscriptId, i]));
  assert.equal(by['TII-26-1000'].stage, 'revised');
  assert.equal(by['TII-26-1000'].resubmittedAs, 'TII-26-2000');
  assert.equal(isActive(by['TII-26-1000']), false);
  assert.equal(by['TII-26-3000.R1'].stage, 'revision');
  assert.equal(isActive(by['TII-26-3000.R1']), true);
});
