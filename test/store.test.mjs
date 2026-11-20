// 用内存版 chrome.storage 测试结果合并：首次入库不提醒、状态变化提醒、旧稿件补录不提醒。
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(k) {
        const keys = typeof k === 'string' ? [k] : k;
        return Object.fromEntries(keys.filter((x) => x in mem).map((x) => [x, structuredClone(mem[x])]));
      },
      async set(o) {
        Object.assign(mem, structuredClone(o));
      },
    },
  },
};
const { applyResults } = await import('../lib/store.js');

const DAY = 86400000;
const item = (id, status, extra = {}) => ({ key: `scholarone:tii:${id}`, platform: 'scholarone', manuscriptId: id, status, ...extra });

test('首次查询只入库，不提醒', async () => {
  const ch = await applyResults('scholarone', [item('A', 'Under Review'), item('B', 'Reject', { decidedAt: Date.now() - 100 * DAY })], { firstRun: true });
  assert.equal(ch.length, 0);
  assert.equal(mem.items['scholarone:tii:A'].unseen, undefined);
  assert.ok(mem.items['scholarone:tii:B'].lastChangedAt < Date.now() - 99 * DAY, '首次记录用平台给的日期');
});

test('状态变化会提醒并记入历史', async () => {
  const ch = await applyResults('scholarone', [item('A', 'Awaiting AE Recommendation'), item('B', 'Reject', { decidedAt: Date.now() - 100 * DAY })], { firstRun: false });
  assert.equal(ch.length, 1);
  assert.equal(ch[0].type, 'status');
  assert.equal(ch[0].from, 'Under Review');
  const a = mem.items['scholarone:tii:A'];
  assert.equal(a.unseen, true);
  assert.deepEqual(a.history.map((h) => h.status), ['Under Review', 'Awaiting AE Recommendation']);
});

test('新出现的稿件：最近投的提醒，很久以前的只补录', async () => {
  const ch = await applyResults(
    'scholarone',
    [item('C', 'Submitted', { submittedAt: Date.now() - 2 * DAY }), item('D', 'Reject', { submittedAt: Date.now() - 400 * DAY, decidedAt: Date.now() - 300 * DAY })],
    { firstRun: false },
  );
  assert.deepEqual(ch.map((c) => c.item.manuscriptId), ['C']);
  assert.equal(mem.items['scholarone:tii:D'].unseen, undefined);
});

test('Elsevier 审稿人数变化也算变化', async () => {
  const e = (n) => ({ key: 'elsevier:1', platform: 'elsevier', status: 'Under Review', extra: { reviewSummary: { ReviewsCompleted: n } } });
  await applyResults('elsevier', [e(0)], { firstRun: true });
  const ch = await applyResults('elsevier', [e(1)], { firstRun: false });
  assert.equal(ch.length, 1);
});
