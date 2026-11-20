// IEEE ScholarOne Manuscripts（mc.manuscriptcentral.com/<站点>）。
//
// 查询：用保存的表单令牌 POST NEXT_PAGE=AUTHOR_VIEW_MANUSCRIPTS，拿到作者看板。
//       令牌来自上一轮登录，或你自己打开的 ScholarOne 页面。
// 自动登录（实测）：所有站点共用一个 SESSION Cookie，打开任何一个登录页都会让全部站点掉线；
//       但先把要登录的站点的登录页都打开、再逐个提交账号，各站点可以同时保持登录。所以每轮：
//   1. 先用令牌查所有站点；
//   2. 有站点需要登录、且有能用的账号时，批量登录（已查完的站点也顺带登录，下一轮就都能用令牌）；
//      没有能用的账号时什么都不做，免得把你已登录的站点登出；
//   3. 后台请求被 Cloudflare 拦下时，在最小化窗口里由页面脚本填表登录，之后的请求也交给窗口代发。
// 安全：只允许 LOGIN、HOME、AUTHOR_VIEW_MANUSCRIPTS 三种页面。
// 各站点的账号相互独立：某个站点拒绝了密码，只停这个站点，直到你更新它的密码。

import { needCredential, authRejected, needHuman, parseError } from '../lib/errors.js';
import { B, prefixB } from '../lib/i18n.js';
import { request, formWith, assertCredentialOrigin, sleep } from '../lib/http.js';
import { openWorker, navigateWorker, waitWorker, closeWorker, fetchViaTab, isWorkerTab } from '../lib/worker.js';
import { parseDate } from '../lib/normalize.js';

const ORIGIN = 'https://mc.manuscriptcentral.com';
const ALLOWED_NEXT = new Set(['LOGIN', 'HOME', 'AUTHOR_VIEW_MANUSCRIPTS']);
const DASH = { XIK_TAGACT: '', NEXT_PAGE: 'AUTHOR_VIEW_MANUSCRIPTS', DATATABLE_CURRENT_PAGE_AUTHOR_CENTER: 0, DATATABLE_PAGE_LENGTH_AUTHOR_CENTER: 100 };

/** 要查询的站点：设置里手动填的 + IEEE Author Portal 自动发现的 + 你自己打开过作者中心的（记下了令牌）。 */
export async function scholaroneSites(ctx) {
  const rex = await ctx.getState('rex');
  const own = await ctx.getState('scholarone');
  return [...new Set([...(ctx.settings.scholaroneSites || []), ...(rex.sites || []), ...Object.keys(own.tokens || {})])].filter(Boolean);
}

class Session {
  constructor(ctx) {
    this.ctx = ctx;
    this.worker = null; // 第 2 层的最小化窗口
    this.tabMode = false;
  }

  async page(url, form) {
    if (form) {
      const next = new URLSearchParams(form).get('NEXT_PAGE');
      if (next && !ALLOWED_NEXT.has(next)) throw new Error(`拒绝访问非查看类页面 ${next}`);
    }
    const r = this.tabMode ? await fetchViaTab(this.worker.tabId, url, { form }) : await request(url, { form });
    return this.ctx.extract('s1Page', r.text, r.url);
  }

  async close() {
    if (this.worker && isWorkerTab(this.worker.tabId)) await closeWorker(this.worker);
    this.worker = null;
  }
}

const credStamp = (cred) => `${cred.id}@${cred.savedAt}`;

async function credFor(ctx, site) {
  const cred = await ctx.getCred(`scholarone:${site}`);
  if (!cred) throw needCredential(B('还没有填写 ScholarOne 账号', 'No ScholarOne account has been added'));
  const st = await ctx.getState();
  if (!ctx.force && st.rejected?.[site] === credStamp(cred))
    throw authRejected(B('该账号上次登录被拒绝，请在追踪面板的账号页更新密码，或为该期刊单独填写账号', 'This account was rejected last time; update the password on the Accounts tab, or add a separate account for this journal'));
  return cred;
}

/** 打开登录页。注意：这一步会让同一浏览器里所有 ScholarOne 站点的会话失效。 */
async function openLoginPage(s, site) {
  const url = `${ORIGIN}/${site}`;
  let p = await s.page(url);
  if (p.kind !== 'login') p = await s.page(p.action || url, formWith(p.pairs, { JAVASCRIPT_ENABLED: 'Y', NEXT_PAGE: 'LOGIN' }));
  if (p.kind !== 'login') throw parseError(B(`没有打开登录页（${p.kind}：${p.title}）`, `The sign-in page did not open (${p.kind}: ${p.title})`));
  if (!p.loginAction) throw parseError(B('登录页缺少 loginAction', 'The sign-in page has no loginAction'));
  assertCredentialOrigin('scholarone', p.action);
  return p;
}

async function submitLogin(s, site, p, cred) {
  const r = await s.page(
    p.action,
    formWith(p.pairs, {
      USERID: cred.username,
      PASSWORD: cred.password,
      XIK_TAGACT: p.loginAction,
      NEXT_PAGE: p.homePage || 'HOME',
      USER_S1M_LOGIN: 'Y',
      IS_ORCID_TOKEN_IN_SESSION: 'Y',
    }),
  );
  if (r.kind === 'login') throw authRejected(r.loginError || B('ScholarOne 拒绝了账号或密码', 'ScholarOne rejected the account or password'));
  if (!r.roleId && r.kind !== 'dashboard') throw needHuman(B(`登录后出现了需要处理的页面（${r.title || r.kind}），请手动打开 ${site} 查看`, `A page that needs your attention appeared after sign-in (${r.title || r.kind}); open ${site} to check`));
  return r;
}

async function loginWindow(ctx, s, site, cred) {
  const url = `${ORIGIN}/${site}`;
  const label = `ScholarOne ${site}`;
  if (s.worker && isWorkerTab(s.worker.tabId)) await navigateWorker(s.worker, url, { site, credId: cred.id, label });
  else s.worker = await openWorker({ platform: 'scholarone', credId: cred.id, site, url, label });
  s.tabMode = true;
  const page = await waitWorker(s.worker, async (w) => (w.page && /^(menu|dashboard)$/.test(w.page.kind) ? w.page : null));
  return ctx.extract('s1Page', page.html, page.url);
}

async function saveTokens(ctx, site, page) {
  if (!page?.pairs?.length || !page.roleId) return;
  const st = await ctx.getState();
  await ctx.setState({ tokens: { ...(st.tokens || {}), [site]: { pairs: page.pairs, roleId: page.roleId, at: Date.now() } } });
}

/** 用保存的令牌打开作者看板；会话已失效时返回 null。 */
async function tryTokens(ctx, s, site) {
  const tok = (await ctx.getState()).tokens?.[site];
  if (!tok?.pairs || !tok.roleId) return null;
  const dash = await s.page(`${ORIGIN}/${site}`, formWith(tok.pairs, { ...DASH, XIK_CUR_ROLE_ID: tok.roleId }));
  return dash.kind === 'dashboard' ? dash : null;
}

/** 从作者看板（或登录后的首页）出发，读完所有队列：有决定的、修改中的、合著的……跳过草稿和邮件。 */
async function collect(ctx, s, site, venue, start) {
  const url = `${ORIGIN}/${site}`;
  let dash = start;
  if (dash.kind !== 'dashboard') dash = await s.page(start.action || url, formWith(start.pairs, { ...DASH, XIK_CUR_ROLE_ID: start.roleId }));
  if (dash.kind !== 'dashboard') throw parseError(B(`没有打开作者看板（${dash.kind}：${dash.title}）`, `The author dashboard did not open (${dash.kind}: ${dash.title})`));
  // 期刊名：优先用 IEEE Author Portal 给的，没有时用页面顶部的
  if (venue === site) venue = dash.journal || start.journal || site;
  const rows = dash.rows.map((r) => ({ ...r, queue: null }));
  let last = dash;
  for (const q of dash.queues.filter((x) => !x.skip)) {
    await sleep(600);
    const p = await s.page(last.action || url, formWith(last.pairs, { ...DASH, MS_LIST_TO_DISPLAY: q.value }));
    if (p.kind !== 'dashboard') {
      ctx.log(`${site}：队列「${q.name}」没有打开（${p.kind}）`, 'error');
      continue;
    }
    rows.push(...p.rows.map((r) => ({ ...r, queue: q.name })));
    last = p;
  }
  await saveTokens(ctx, site, { pairs: last.pairs, roleId: last.roleId || dash.roleId });

  const seen = new Set();
  return rows
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({
      key: `scholarone:${site}:${r.id}`,
      platform: 'scholarone',
      site,
      venue,
      manuscriptId: r.id,
      title: r.title,
      status: r.status,
      people: r.people,
      submittedAt: parseDate(r.submitted),
      decidedAt: parseDate(r.decisioned),
      extra: { queue: r.queue, action: r.action },
      url,
    }));
}

/** 你最近用过 ScholarOne 标签页时跳过，免得打断你（例如正在提交修改稿）。 */
async function userActive(ctx) {
  const mins = ctx.settings.pauseWhenActiveMinutes;
  if (!mins || ctx.force) return false;
  const tabs = (await chrome.tabs.query({ url: `${ORIGIN}/*` })).filter((t) => !isWorkerTab(t.id));
  if (!tabs.length) return false;
  if (tabs.some((t) => t.lastAccessed && Date.now() - t.lastAccessed < mins * 60000)) return true;
  // 一直停在同一个标签页上时 lastAccessed 不会更新：你正在看的那个也算
  const win = await chrome.windows.getLastFocused().catch(() => null);
  return !!win?.focused && tabs.some((t) => t.active && t.windowId === win.id);
}

export default {
  id: 'scholarone',
  label: 'IEEE ScholarOne',
  credIds: ['scholarone'],
  openUrl: ORIGIN,

  async enabled(ctx) {
    if (!(await scholaroneSites(ctx)).length) return false;
    // 有账号，或者有从你已登录页面记下的会话令牌
    return !!(await ctx.getCred('scholarone')) || Object.keys((await ctx.getState()).tokens || {}).length > 0;
  },

  async run(ctx) {
    const sites = await scholaroneSites(ctx);
    if (!sites.length) return { items: [], note: B('还没有要查询的期刊站点：填写 IEEE 账号可自动发现，或在账号页手动添加', 'No journal sites to check yet: add an IEEE account to discover them, or add them on the Accounts tab') };
    if (await userActive(ctx)) return { skipped: true, note: B('你最近使用过 ScholarOne，本轮跳过', 'Skipped this round because you used ScholarOne recently') };
    const names = (await ctx.getState('rex')).siteNames || {};
    const venue = (site) => names[site] || site;
    const s = new Session(ctx);
    const items = [];
    const warnings = [];
    const done = new Set();
    let firstError = null;
    let attention = null; // 留给你处理的窗口
    const fail = (site, e) => {
      ctx.log(prefixB(site, e.message), 'error');
      warnings.push(prefixB(site, e.message));
      firstError ||= e;
    };
    const markRejected = async (site, cred) => {
      const st = await ctx.getState();
      await ctx.setState({ rejected: { ...(st.rejected || {}), [site]: credStamp(cred) } });
    };

    try {
      // 1. 先用令牌。打开任何一个登录页都会让所有站点掉线，所以令牌必须在登录之前用掉
      const needLogin = [];
      for (const site of sites) {
        try {
          const dash = await tryTokens(ctx, s, site);
          if (dash) {
            const rows = await collect(ctx, s, site, venue(site), dash);
            ctx.log(`${site}：${rows.length} 篇`);
            items.push(...rows);
            done.add(site);
          } else needLogin.push(site);
        } catch (e) {
          if (e.code === 'blocked') needLogin.push(site);
          else fail(site, e);
        }
      }

      // 2. 需要登录的站点里，有能用的账号的
      const batch = [];
      for (const site of needLogin) {
        try {
          batch.push({ site, cred: await credFor(ctx, site) });
        } catch (e) {
          fail(site, e);
        }
      }
      if (batch.length) {
        // 打开任何登录页，已经查完的站点也会被登出：有账号的话一起重新登录，下一轮就都能直接用令牌。
        // 实测先把所有登录页都打开、再逐个提交账号，多个站点可以同时保持登录。
        ctx.log(`会话已失效，自动登录：${batch.map((b) => b.site).join('、')}`);
        for (const site of done) {
          const cred = await credFor(ctx, site).catch(() => null);
          if (cred) batch.push({ site, cred });
        }
        const viaWindow = [];
        for (const b of batch) {
          try {
            b.login = await openLoginPage(s, b.site);
          } catch (e) {
            if (e.code !== 'blocked') fail(b.site, e);
            else if (!done.has(b.site)) viaWindow.push(b);
          }
          await sleep(500);
        }
        for (const b of batch.filter((x) => x.login)) {
          try {
            const home = await submitLogin(s, b.site, b.login, b.cred);
            ctx.log(`${b.site}：登录成功`);
            if (done.has(b.site)) await saveTokens(ctx, b.site, home);
            else {
              const rows = await collect(ctx, s, b.site, venue(b.site), home);
              ctx.log(`${b.site}：${rows.length} 篇`);
              items.push(...rows);
              done.add(b.site);
            }
          } catch (e) {
            if (e.code === 'auth-rejected') await markRejected(b.site, b.cred);
            fail(b.site, e);
          }
          await sleep(800);
        }

        // 3. 后台请求被 Cloudflare 拦下的站点：在最小化窗口里由页面脚本登录
        for (const b of viaWindow) {
          try {
            ctx.log(`${b.site}：后台登录被 Cloudflare 拦截，改用最小化窗口`);
            const home = await loginWindow(ctx, s, b.site, b.cred);
            const rows = await collect(ctx, s, b.site, venue(b.site), home);
            ctx.log(`${b.site}：${rows.length} 篇（窗口）`);
            items.push(...rows);
          } catch (e) {
            if (e.code === 'auth-rejected') await markRejected(b.site, b.cred);
            fail(b.site, e);
            if (e.code === 'need-human') {
              s.worker = null; // 窗口留给你处理
              attention = e;
              break;
            }
          }
        }
      }
    } finally {
      await s.close();
    }
    if (!items.length && firstError) throw attention || firstError;
    return { items, warnings, attention };
  },
};
