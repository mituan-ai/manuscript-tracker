// 用本机抓取的真实页面样本（test/fixtures.local，不入库）测试解析器。没有样本时跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { s1Page, ppPage, tcctAuthor, tcctConfids } from '../lib/extract.js';

const DIR = new URL('./fixtures.local/', import.meta.url);
const has = (f) => fs.existsSync(new URL(f, DIR));
const load = (f) => parseHTML(fs.readFileSync(new URL(f, DIR), 'utf8')).document;
const opt = (f) => ({ skip: (!has(f) || !has('expect.json')) && `缺少样本 ${f}` });
// 样本里的真实稿件号、日期、标题只放在本地的 expect.json，不进仓库
const E = has('expect.json') ? JSON.parse(fs.readFileSync(new URL('expect.json', DIR), 'utf8')) : {};
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('ScholarOne 看板：T-ASE', opt('scholarone-t-ase-dashboard.html'), () => {
  const p = s1Page(load('scholarone-t-ase-dashboard.html'), 'https://mc.manuscriptcentral.com/t-ase');
  assert.equal(p.kind, 'dashboard');
  assert.ok(p.roleId);
  assert.equal(p.journal, 'IEEE Transactions on Automation Science and Engineering');
  const r = p.rows.find((x) => x.id === E.tase_id);
  assert.ok(r, JSON.stringify(p.rows));
  assert.equal(r.status, 'Under Review');
  assert.match(r.title, new RegExp(`${esc(E.tase_title_end)}$`));
  assert.deepEqual(r.people.map((x) => x.role), ['ED', 'EIC', 'EA']);
  assert.equal(r.submitted, E.tase_submitted);
  assert.ok(p.queues.some((q) => /Decisions/.test(q.name)), JSON.stringify(p.queues));
});

test('ScholarOne 看板：TII（含决定队列）', opt('scholarone-tii-dashboard.html'), () => {
  const p = s1Page(load('scholarone-tii-dashboard.html'), 'https://mc.manuscriptcentral.com/tii');
  assert.equal(p.kind, 'dashboard');
  const r = p.rows.find((x) => x.id === E.tii_id);
  assert.match(r.status, new RegExp(`^Accept \\(${esc(E.tii_decision)}\\)`));
  assert.equal(r.decisioned, E.tii_decision);
  assert.ok(p.rows.length >= 5);
});

test('ScholarOne 登录页', opt('scholarone-login.html'), () => {
  const p = s1Page(load('scholarone-login.html'), 'https://mc.manuscriptcentral.com/t-ase');
  assert.equal(p.kind, 'login');
  assert.match(p.loginAction, /^xik_/);
  assert.equal(p.homePage, 'HOME');
  const names = p.pairs.map(([k]) => k);
  for (const k of ['USERID', 'PASSWORD', 'NEXT_PAGE', 'XIK_TAGACT']) assert.ok(names.includes(k), k);
  assert.equal(p.action, 'https://mc.manuscriptcentral.com/t-ase');
});

test('PaperPlaza 工作区', opt('paperplaza-workspace-http.html'), () => {
  const p = ppPage(load('paperplaza-workspace-http.html'), 'https://ifac-sms.org/journals/automatica/scripts/login.pl');
  assert.deepEqual(p.rows.map((r) => [r.id, r.status, r.received]), [E.pp_row]);
  assert.match(p.rows[0].title, new RegExp(`^${esc(E.pp_title_start)}`));
});

test('PaperPlaza 期刊首页与会议登录页的命令格式不同', opt('paperplaza-login.html'), () => {
  const home = ppPage(load('paperplaza-automatica-home.html'), 'https://ifac-sms.org/journals/automatica/scripts/login.pl');
  assert.equal(home.commandSuffix, '');
  assert.ok(home.commands.includes('AccessAuthorspace'));
  const login = ppPage(load('paperplaza-login.html'), 'https://ifac-sms.org/conferences/scripts/start.pl');
  assert.equal(login.commandSuffix, '.x');
  assert.ok(login.hasPassword);
  assert.equal(login.action, 'https://ifac-sms.org/conferences/scripts/login.pl');
  assert.ok(login.pairs.some(([k]) => k === 'LoginId'));
});

test('TCCT 作者工作区', opt('tcct-author.raw'), () => {
  const p = tcctAuthor(load('tcct-author.raw'), 'https://cms.amss.ac.cn/author.php?confid=171');
  assert.equal(p.loggedIn, true);
  assert.equal(p.confShort, 'CCDC 2027');
  assert.match(p.confName, /中国控制与决策会议/);
  assert.deepEqual(p.rows.map((r) => [r.id, r.status]).sort(), E.tcct_rows);
  assert.match(p.rows.find((r) => r.id === E.tcct_title_id).title, new RegExp(`^${esc(E.tcct_title_start)}`));
});

test('TCCT 会议列表', opt('tcct-default.html'), () => {
  const ids = tcctConfids(load('tcct-default.html'));
  assert.ok(ids.includes(171) && ids.length > 5);
});
