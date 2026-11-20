import test from 'node:test';
import assert from 'node:assert/strict';
import { abbrOf, journalKey, groupByJournal, prepareItems, problems, FILTERS, isRecentResult } from '../lib/view.js';

const D = 86400000;
const now = Date.now();

test('从稿件号取期刊缩写', () => {
  assert.equal(abbrOf('TII-26-0412'), 'TII');
  assert.equal(abbrOf('T-ASE-2026-0931'), 'T-ASE');
  assert.equal(abbrOf('TMM-2026-01234.R1'), 'TMM');
  assert.equal(abbrOf('MM-2026-01234'), 'TMM');
  assert.equal(abbrOf('CYB-E-2026-01-0123'), 'TCYB');
  assert.equal(abbrOf('JPROCONT-D-26-00123'), 'JPROCONT');
  assert.equal(abbrOf('26-0001'), null);
  assert.equal(abbrOf('0786'), null);
  assert.equal(abbrOf(''), null);
});

test('期刊名归一：大小写、标点、& 与 and', () => {
  assert.equal(
    journalKey('IEEE Transactions on Systems, Man, and Cybernetics: Systems'),
    journalKey('IEEE Transactions on Systems, Man & Cybernetics: Systems'),
  );
  assert.equal(journalKey('Automatica'), journalKey(' automatica '));
});

test('按期刊分组：同一篇稿件在两个渠道只算一次，进行中的期刊排在前面', () => {
  const items = prepareItems({
    'scholarone:tii:TII-26-0412': { platform: 'scholarone', venue: 'IEEE Transactions on Industrial Informatics', manuscriptId: 'TII-26-0412', status: 'Under Review', submittedAt: now - 30 * D },
    'rex:TII-26-0412': { platform: 'rex', venue: 'IEEE Transactions on Industrial Informatics', manuscriptId: 'TII-26-0412', status: 'Under Review', submittedAt: now - 30 * D },
    'rex:TII-25-0001': { platform: 'rex', venue: 'IEEE TRANSACTIONS ON INDUSTRIAL INFORMATICS', manuscriptId: 'TII-25-0001', status: 'Reject', decidedAt: now - 200 * D, submittedAt: now - 300 * D },
    'paperplaza:automatica:25-1': { platform: 'paperplaza', venue: 'Automatica', manuscriptId: '25-1', status: 'Accepted', decidedAt: now - 5 * D, submittedAt: now - 100 * D },
  });
  const groups = groupByJournal(items);
  assert.deepEqual(groups.map((g) => g.name), ['IEEE Transactions on Industrial Informatics', 'Automatica']);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].abbr, 'TII');
  assert.equal(groups[0].active, 1);
  assert.equal(groups[0].items[0].manuscriptId, 'TII-26-0412'); // 进行中的在前
  assert.equal(groups[1].abbr, null);
});

test('筛选：需修改、近 30 天有结果', () => {
  const items = prepareItems({
    a: { platform: 'scholarone', venue: 'X', status: 'Major Revision', decidedAt: now - 3 * D },
    b: { platform: 'scholarone', venue: 'X', status: 'Accept', decidedAt: now - 3 * D },
    c: { platform: 'scholarone', venue: 'X', status: 'Reject', decidedAt: now - 90 * D },
    d: { platform: 'scholarone', venue: 'X', status: 'Under Review' },
  });
  const pick = (f) => items.filter(FILTERS[f].test).map((i) => i.key).sort();
  assert.deepEqual(pick('active'), ['a', 'd']);
  assert.deepEqual(pick('revision'), ['a']);
  assert.deepEqual(pick('results'), ['b']);
  assert.equal(isRecentResult(items.find((i) => i.key === 'c')), false);
});

test('问题提示按账号描述，不出现投稿系统内部名称', () => {
  const state = {
    adapters: ['rex', 'scholarone', 'paperplaza', 'tcct', 'elsevier'].map((id) => ({ id })),
    running: ['elsevier'],
    platforms: {
      rex: { status: 'ok' },
      scholarone: { status: 'auth-rejected' },
      paperplaza: { status: 'need-human', windowId: 7 },
      tcct: { status: 'error', message: 'x' },
      elsevier: { status: 'error' },
    },
  };
  const p = problems(state);
  assert.deepEqual(p.map((x) => [x.id, x.level]), [['scholarone', 'action'], ['paperplaza', 'action'], ['tcct', 'warn']]);
  assert.equal(p[0].title, 'IEEE 投稿账号的密码被拒绝了');
  assert.equal(p[1].windowId, 7);
  for (const x of p) assert.doesNotMatch(x.title, /ScholarOne|Author Portal|PaperPlaza CMS/);
});
