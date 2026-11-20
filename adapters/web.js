// 其他期刊和会议：你在稿件列表页点扩展图标添加的网站（Editorial Manager、eJournalPress 等），通用识别，未逐一实测。
// 后台带着浏览器里的登录状态重新打开这些页面并识别稿件；不保存这些网站的密码，登录过期时等你再打开一次。
// 需要你允许扩展访问该网站，否则只在你打开页面、点扩展图标时更新。

import { request, sleep } from '../lib/http.js';
import { parseDate } from '../lib/normalize.js';
import { originPattern } from '../lib/scan.js';
import { B, prefixB } from '../lib/i18n.js';

export { originPattern };


const hash = (s) => {
  let h = 5381;
  for (const c of s.toLowerCase().replace(/\W+/g, '')) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
};

/** 页面上识别出的行 → 稿件。同一网站多个页面里的同一篇稿件，键相同。 */
export function toItems(page, rows) {
  return rows.map((r) => ({
    key: `web:${page.site}:${r.id || `t${hash(r.title)}`}`,
    platform: 'web',
    site: page.site,
    venue: r.journal || page.journal,
    manuscriptId: r.id || '',
    title: r.title,
    status: r.status,
    submittedAt: parseDate(r.submitted),
    updatedAt: parseDate(r.updated),
    url: page.url,
  }));
}

/** 打开一个页面并识别；是文件夹菜单页时，再打开里面的稿件文件夹。done：本轮已经打开过的网址。 */
async function scan(ctx, url, done) {
  done.add(url);
  const r = await request(url);
  const p = await ctx.extract('webPage', r.text, r.url);
  const rows = [...p.rows];
  let tables = p.tables;
  for (const f of p.folders.filter((x) => !done.has(x.url))) {
    done.add(f.url);
    await sleep(500);
    const sub = await ctx.extract('webPage', (await request(f.url)).text, f.url);
    rows.push(...sub.rows);
    tables += sub.tables;
  }
  return { rows, tables, login: p.login };
}

export default {
  id: 'web',
  label: B('其他投稿网站', 'Other sites'),
  credIds: [],
  openUrl: null,

  async enabled(ctx) {
    return Object.keys((await ctx.getState()).pages || {}).length > 0;
  },

  async run(ctx) {
    const pages = Object.values((await ctx.getState()).pages || {});
    const items = [];
    const warnings = [];
    const status = {};
    for (const page of pages) {
      if (!(await chrome.permissions.contains({ origins: [originPattern(page.url)] }))) {
        status[page.site] = { status: 'no-permission' };
        continue;
      }
      try {
        const rows = [];
        let tables = 0;
        let login = false;
        const done = new Set();
        for (const url of [page.url, ...(page.more || [])].slice(0, 6)) {
          if (done.has(url)) continue;
          const r = await scan(ctx, url, done);
          rows.push(...r.rows);
          tables += r.tables;
          login ||= r.login;
          await sleep(600);
        }
        if (!tables) {
          // 打开的是登录页或别的页面：多半是登录过期了
          status[page.site] = { status: 'expired' };
          ctx.log(`${page.journal}：${login ? '登录已过期' : '没有识别到稿件列表'}，等你再打开一次`);
          continue;
        }
        items.push(...toItems(page, rows));
        status[page.site] = { status: 'ok', lastOkAt: Date.now(), count: new Set(rows.map((r) => r.id || r.title)).size };
        ctx.log(`${page.journal}：${status[page.site].count} 篇`);
      } catch (e) {
        status[page.site] = { status: 'error', message: e.message };
        warnings.push(prefixB(page.journal, e.message));
        ctx.log(prefixB(page.journal, e.message), 'error');
      }
    }
    // 查询期间你可能添加或移除了网站：只更新还在的
    await ctx.updateState((st) => {
      const next = { ...(st.pages || {}) };
      for (const [site, s] of Object.entries(status)) if (next[site]) next[site] = { ...next[site], message: null, ...s };
      return { ...st, pages: next };
    });
    return { items, warnings, note: pages.length ? B(`${pages.length} 个网站`, `${pages.length} site${pages.length > 1 ? 's' : ''}`) : B('还没有添加网站', 'No sites added yet') };
  },
};
