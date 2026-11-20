// TCCT CMS（CCDC、CCC 等）。纯 HTTP。
// 登录：用页面里的 RSA 公钥加密 PIN 和密码，POST index.php（request=ajax），返回 JSON。
// 验证码只在登录失败过的会话里出现，所以默认不需要。

import { needCredential, authRejected, needHuman, parseError } from '../lib/errors.js';
import { request, assertCredentialOrigin, sleep } from '../lib/http.js';
import { rsaEncrypt } from '../lib/rsa.js';

const BASE = 'https://cms.amss.ac.cn/';
const DEFAULT_CONFID = 171; // CCDC 2027；其余会议会自动发现
const DISCOVER_EVERY = 7 * 24 * 3600 * 1000;

async function authorPage(ctx, confid) {
  const r = await request(`${BASE}author.php?confid=${confid}`);
  return ctx.extract('tcctAuthor', r.text, r.url);
}

async function loginPage(confid) {
  const r = await request(`${BASE}index.php?confid=${confid}`);
  return {
    key: /setPublicKey\('([^']+)'\)/.exec(r.text)?.[1] || null,
    captcha: /var enable_captcha\s*=\s*true/.test(r.text),
  };
}

async function login(ctx, cred, confid) {
  let lp = await loginPage(confid);
  if (lp.captcha) {
    // 这个会话之前登录失败过，换一个新会话
    await chrome.cookies.remove({ url: BASE, name: 'CMS_SESSID' }).catch(() => {});
    lp = await loginPage(confid);
    if (lp.captcha) throw needHuman('TCCT 要求输入验证码，请在网页上手动登录一次');
  }
  if (!lp.key) throw parseError('TCCT 登录页里没有找到公钥');
  const url = `${BASE}index.php?confid=${confid}`;
  assertCredentialOrigin('tcct', url);
  const res = await request(url, {
    form: { request: 'ajax', user: rsaEncrypt(lp.key, cred.username), pswd: rsaEncrypt(lp.key, cred.password) },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' },
  });
  let data;
  try {
    data = JSON.parse(res.text.trim());
  } catch {
    throw parseError(`TCCT 登录接口没有返回 JSON（HTTP ${res.status}）`);
  }
  if (String(data.errno) !== '0') {
    if (/验证码|captcha/i.test(data.errmsg || '')) throw needHuman('TCCT 要求输入验证码，请在网页上手动登录一次');
    throw authRejected(data.errmsg || 'TCCT 拒绝了账号或密码');
  }
  ctx.log('登录成功');
}

export default {
  id: 'tcct',
  label: 'TCCT CMS',
  credIds: ['tcct'],
  openUrl: `${BASE}index.php?confid=${DEFAULT_CONFID}`,

  async enabled(ctx) {
    if (await ctx.getCred('tcct')) return true;
    return !(await ctx.getState()).noSession; // 没填账号时，先试试浏览器里现成的会话
  },

  async run(ctx) {
    const cred = await ctx.getCred('tcct');
    const state = await ctx.getState();
    let confids = [...new Set([...(ctx.settings.tcctConfids || []), ...(state.confids?.length ? state.confids : [DEFAULT_CONFID])])];

    const pages = new Map();
    let first = await authorPage(ctx, confids[0]);
    if (!first.loggedIn) {
      if (!cred) {
        await ctx.setState({ noSession: true });
        throw needCredential('TCCT 未登录，且还没有填写 TCCT 账号');
      }
      ctx.log('会话已失效，自动登录');
      await login(ctx, cred, confids[0]);
      first = await authorPage(ctx, confids[0]);
      if (!first.loggedIn) throw parseError('登录后仍然打不开作者工作区');
    }
    pages.set(confids[0], first);
    if (state.noSession) await ctx.setState({ noSession: false });

    // 每周自动发现一次：哪些 TCCT 会议里有你的投稿
    if (!state.discoveredAt || Date.now() - state.discoveredAt > DISCOVER_EVERY) {
      const r = await request(`${BASE}default.php?confid=${confids[0]}`);
      const all = await ctx.extract('tcctConfids', r.text, r.url);
      const found = [];
      for (const id of all) {
        const p = pages.get(id) || (await authorPage(ctx, id));
        pages.set(id, p);
        if (p.rows?.length) found.push(id);
        await sleep(300);
      }
      ctx.log(`自动发现：${found.length} 个会议有投稿（共检查 ${all.length} 个）`);
      confids = [...new Set([...(ctx.settings.tcctConfids || []), ...(found.length ? found : confids)])];
      await ctx.setState({ confids, discoveredAt: Date.now() });
    }

    const items = [];
    for (const confid of confids) {
      const p = pages.get(confid) || (await authorPage(ctx, confid));
      if (!p.rows) continue;
      const venue = p.confShort || p.confName || `TCCT ${confid}`;
      for (const r of p.rows) {
        items.push({
          key: `tcct:${confid}:${r.id}`,
          platform: 'tcct',
          venue,
          manuscriptId: r.id,
          title: r.title,
          status: r.status,
          extra: { type: r.type, track: r.track, fee: r.fee, confName: p.confName },
          url: `${BASE}author.php?confid=${confid}`,
        });
      }
    }
    return { items };
  },
};
