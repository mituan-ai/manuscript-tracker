// 通用识别：用按各类投稿系统常见结构写的示例页面（虚构数据）测试。真实系统没有逐一实测。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { scanPage, siteOf, NATIVE_HOSTS } from '../lib/scan.js';
import { stageOf } from '../lib/normalize.js';
import { toItems } from '../adapters/web.js';

const doc = (body, head = '') => parseHTML(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`).document;
const EM = 'https://www.editorialmanager.com/demoj/AuthorSubmissions.aspx';

test('Editorial Manager 风格：表头在 th，标题单元格里有操作链接，"Status Date" 是日期', () => {
  const d = doc(
    `<h2>Submissions Being Processed for Author Jane Doe</h2>
    <table><tr><th>Action</th><th>Manuscript Number</th><th>Title</th><th>Initial Date Submitted</th><th>Status Date</th><th>Current Status</th></tr>
      <tr><td><a href="#">View Submission</a><a href="#">Send E-mail</a></td><td>DEMOJ-D-26-00012</td>
          <td>A Synthetic Study of Things <a href="#">Details</a></td><td>Jan 05, 2026</td><td>Feb 10, 2026</td><td>Under Review</td></tr>
      <tr><td></td><td>DEMOJ-D-26-00034R1</td><td>Another Example Manuscript Title</td><td>Mar 01, 2026</td><td>Mar 02, 2026</td><td>With Editor</td></tr>
    </table>`,
    '<title>Demo Journal of Examples - Editorial Manager®</title>',
  );
  const p = scanPage(d, EM);
  assert.equal(p.tables, 1);
  assert.deepEqual(
    p.rows.map((r) => [r.id, r.title, r.status, r.submitted, r.updated]),
    [
      ['DEMOJ-D-26-00012', 'A Synthetic Study of Things', 'Under Review', 'Jan 05, 2026', 'Feb 10, 2026'],
      ['DEMOJ-D-26-00034R1', 'Another Example Manuscript Title', 'With Editor', 'Mar 01, 2026', 'Mar 02, 2026'],
    ],
  );
  assert.equal(p.journal, 'Demo Journal of Examples');
  assert.equal(p.login, false);
  assert.deepEqual(p.rows.map((r) => stageOf(r.status)), ['reviewing', 'editor']);
});

test('菜单页：没有表格时找出稿件文件夹链接（跳过草稿、数量为 0 的）', () => {
  const d = doc(`<a href="Folder.aspx?f=processing">Submissions Being Processed (2)</a>
    <a href="Folder.aspx?f=incomplete">Incomplete Submissions (1)</a>
    <a href="Folder.aspx?f=decision">Submissions with a Decision (3)</a>
    <a href="Folder.aspx?f=revise">Submissions Needing Revision (0)</a>
    <a href="https://elsewhere.example.org/x">Submissions elsewhere (5)</a>
    <a href="javascript:void(0)">Revisions Being Processed (1)</a>`);
  const p = scanPage(d, EM);
  assert.equal(p.rows.length, 0);
  assert.deepEqual(p.folders.map((f) => [f.name, f.count]), [['Submissions Being Processed', 2], ['Submissions with a Decision', 3]]);
  assert.match(p.folders[0].url, /^https:\/\/www\.editorialmanager\.com\/demoj\/Folder\.aspx\?f=processing$/);
});

test('eJournalPress 风格："Manuscript #"、"Current Stage"，嵌套表格里的行不算', () => {
  const d = doc(`<table><thead><tr><th>Manuscript #</th><th>Current Revision #</th><th>Submission Date</th><th>Current Stage</th><th>Title</th></tr></thead>
    <tbody><tr><td>NMED-A12345</td><td>0</td><td>2026-02-03</td><td>Manuscript under consideration</td>
      <td>Example clinical trial of a made-up drug<table><tr><td>Status</td><td>x</td></tr></table></td></tr></tbody></table>`);
  const p = scanPage(d, 'https://mts-demo.example.com/cgi-bin/main.plex');
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].id, 'NMED-A12345');
  assert.equal(p.rows[0].submitted, '2026-02-03');
  assert.equal(stageOf(p.rows[0].status), 'editor');
});

test('ARIA 表格（单页应用常见）和中文投稿系统', () => {
  const aria = doc(`<div role="table"><div role="row"><span role="columnheader">Paper ID</span><span role="columnheader">Title</span><span role="columnheader">Status</span></div>
    <div role="row"><span role="cell">1234</span><span role="cell">An Imaginary Conference Paper</span><span role="cell">Accept</span></div></div>`);
  assert.deepEqual(scanPage(aria, 'https://conf.example.org/').rows.map((r) => [r.id, r.status]), [['1234', 'Accept']]);

  const zh = doc(`<table><tr><td>稿件编号</td><td>论文题目</td><td>投稿日期</td><td>当前状态</td></tr>
    <tr><td>2026-0101</td><td>一种虚构的控制方法研究</td><td>2026-01-02</td><td>外审中</td></tr>
    <tr><td>2026-0102</td><td>另一篇虚构的稿件</td><td>2026-01-03</td><td>退修</td></tr></table>`);
  const p = scanPage(zh, 'http://journal.example.cn/author/list');
  assert.deepEqual(p.rows.map((r) => [r.id, stageOf(r.status)]), [['2026-0101', 'reviewing'], ['2026-0102', 'revision']]);
});

test('不是稿件列表时不猜：没有状态列、没有编号也没有像样的标题、登录页', () => {
  const noStatus = doc('<table><tr><th>ID</th><th>Title</th></tr><tr><td>1</td><td>Something long enough</td></tr></table>');
  assert.equal(scanPage(noStatus, 'https://a.example/').tables, 0);
  const noId = doc('<table><tr><th>Name</th><th>Status</th></tr><tr><td>x</td><td>Active</td></tr></table>');
  assert.equal(scanPage(noId, 'https://a.example/').rows.length, 0);
  const login = doc('<form><input name="username"><input type="password" name="password"></form>', '<title>Login</title>');
  const p = scanPage(login, 'https://www.editorialmanager.com/demoj/default.aspx');
  assert.equal(p.login, true);
  assert.equal(p.tables, 0);
  assert.equal(p.journal, 'DEMOJ');
});

test('网站标识与已有专门支持的网站', () => {
  assert.equal(siteOf('https://www.editorialmanager.com/DemoJ/AuthorMainMenu.aspx'), 'editorialmanager.com/demoj');
  assert.equal(siteOf('https://mts-demo.example.com/cgi-bin/main.plex?x=1'), 'mts-demo.example.com');
  assert.ok(NATIVE_HOSTS.test('mc.manuscriptcentral.com'));
  assert.ok(NATIVE_HOSTS.test('track.authorhub.elsevier.com'));
  assert.ok(!NATIVE_HOSTS.test('www.editorialmanager.com'));
});

test('识别结果转成稿件：同一网站同一稿件号键相同；没有稿件号时用标题', () => {
  const page = { site: 'editorialmanager.com/demoj', journal: 'Demo Journal', url: EM };
  const [a, b] = toItems(page, [
    { id: 'DEMOJ-D-26-00012', title: 'T', status: 'Under Review', submitted: 'Jan 05, 2026', updated: null, journal: null },
    { id: '', title: 'Only A Title Here', status: 'Submitted', submitted: null, updated: null, journal: 'Other Journal' },
  ]);
  assert.equal(a.key, 'web:editorialmanager.com/demoj:DEMOJ-D-26-00012');
  assert.equal(a.venue, 'Demo Journal');
  assert.equal(a.submittedAt, new Date(2026, 0, 5).getTime());
  assert.match(b.key, /^web:editorialmanager\.com\/demoj:t[0-9a-z]+$/);
  assert.equal(b.venue, 'Other Journal');
});

test('状态归类：其他投稿系统的常见说法', () => {
  const cases = {
    'Submitted to Journal': 'submitted',
    'Editor Assigned': 'editor',
    'Reviewers Assigned': 'reviewing',
    'Required Reviews Completed': 'deciding',
    'Reviews completed': 'deciding',
    'Under Review (3 reviews completed)': 'reviewing',
    'Pending Editor Decision': 'deciding',
    Revise: 'revision',
    'Pending major revisions': 'revision',
    'Revised Manuscript Submitted to Journal': 'submitted',
    'Completed - Accept': 'accepted',
    'Completed Reject': 'rejected',
    Declined: 'rejected',
    'In Production': 'accepted',
    Published: 'accepted',
    Unpublished: 'unknown',
    初审: 'editor',
    外审中: 'reviewing',
    退修: 'revision',
    退稿: 'rejected',
    已发表: 'accepted',
  };
  for (const [s, want] of Object.entries(cases)) assert.equal(stageOf(s), want, s);
});
