// IFAC PaperPlaza（Automatica 及使用 PaperCept 的 IFAC 会议）。纯 HTTP，无验证码，不用 Cookie。
// 流程：start.pl → Login 命令打开登录表单 → POST login.pl → Access 页里的各期刊/会议入口
//      → 进入入口 → AccessAuthorspace 命令 → 作者工作区表格。

import { needCredential, authRejected, parseError } from '../lib/errors.js';
import { request, formWith, assertCredentialOrigin, sleep } from '../lib/http.js';
import { parseDate } from '../lib/normalize.js';

const START = 'https://ifac-sms.org/conferences/scripts/start.pl';

// 登录后的期刊/会议入口是 http:// 链接（实测 Automatica），扩展只有 https 权限，http 请求会直接 Failed to fetch
const https = (url) => url.replace(/^http:\/\//i, 'https://');

async function page(ctx, url, form) {
  let r = await request(https(url), { form });
  // 跟随 <meta http-equiv="refresh">
  const refresh = /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+\s*;\s*url=([^"'>]+)/i.exec(r.text);
  if (refresh) r = await request(https(new URL(refresh[1], r.url).href));
  return ctx.extract('ppPage', r.text, r.url);
}

const command = (p, name) => formWith(p.pairs, { Command: name + p.commandSuffix });

/** 每个期刊/会议只保留一个入口，按路径去重（/journals/automatica/、/conferences/xxx/）。 */
function uniqueEvents(links) {
  const seen = new Map();
  for (const l of links) {
    const key = new URL(l.href).pathname.replace(/scripts\/login\.pl$/, '');
    if (!seen.has(key)) seen.set(key, { ...l, key });
  }
  return [...seen.values()];
}

export default {
  id: 'paperplaza',
  label: 'IFAC PaperPlaza',
  credIds: ['paperplaza'],
  openUrl: START,

  async enabled(ctx) {
    return !!(await ctx.getCred('paperplaza'));
  },

  async run(ctx) {
    const cred = await ctx.getCred('paperplaza');
    if (!cred) throw needCredential();

    const start = await page(ctx, START);
    const form = start.hasPassword ? start : await page(ctx, start.action, command(start, 'Login'));
    if (!form.hasPassword) throw parseError('没有找到 PaperPlaza 登录表单');
    assertCredentialOrigin('paperplaza', form.action);

    const access = await page(
      ctx,
      form.action,
      formWith(form.pairs, { LoginId: cred.username, Password: cred.password, Command: 'Login' + form.commandSuffix }),
    );
    // 密码错误时返回标题为 "Error message" 的错误页（实测："The login information is incorrect"）
    if (access.hasPassword || access.loginError || /^error/i.test(access.title || '')) {
      const msg = access.loginError || 'PaperPlaza 拒绝了账号或密码';
      if (access.hasPassword || /login|password|incorrect|invalid|PIN/i.test(msg)) throw authRejected(msg);
      throw parseError(`登录时出错：${msg}`);
    }
    ctx.log('登录成功');

    const events = uniqueEvents(access.enterLinks);
    if (!events.length) throw parseError('登录后没有找到期刊或会议入口');

    const items = [];
    for (const ev of events.slice(0, 8)) {
      const home = await page(ctx, ev.href);
      if (!home.commands.includes('AccessAuthorspace')) continue;
      const ws = await page(ctx, home.action, command(home, 'AccessAuthorspace'));
      if (ws.securityViolation) throw parseError('PaperPlaza 返回 Security violation（命令格式不对）');
      if (!ws.rows) throw parseError('没有找到作者工作区表格');
      const venue = home.title.replace(/\s*Access Page\s*$/i, '').trim() || ev.key;
      const slug = ev.key.split('/').filter(Boolean).pop();
      for (const r of ws.rows) {
        items.push({
          key: `paperplaza:${slug}:${r.id}`,
          platform: 'paperplaza',
          venue,
          manuscriptId: r.id,
          title: r.title,
          status: r.status,
          submittedAt: parseDate(r.received),
          updatedAt: parseDate(r.latest),
          extra: { version: r.version, type: r.type, action: r.action },
          url: START,
        });
      }
      ctx.log(`${venue}：${ws.rows.length} 篇`);
      await sleep(800);
    }
    return { items };
  },
};
