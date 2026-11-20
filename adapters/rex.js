// IEEE Author Portal（ReX）。一次返回全部 IEEE 稿件的粗粒度状态，并用来自动发现 ScholarOne 站点。
// 会话靠 Cookie（"记住我" 30 天）；失效时在最小化窗口里走 ieee.org 统一登录（有 AWS WAF，只能用真实页面）。

import { needCredential, authRejected } from '../lib/errors.js';
import { request } from '../lib/http.js';
import { openWorker, waitWorker, closeWorker, fetchViaTab, isWorkerTab } from '../lib/worker.js';
import { parseDate } from '../lib/normalize.js';

const ORIGIN = 'https://ieee.submission.researchexchange.com';
const SEARCH =
  `${ORIGIN}/api/dashboard/2/submissions/_search?` +
  [
    'fields=journal.id',
    'fields=journal.name',
    'fields=journal.productCode',
    'fields=actualStage.data',
    'fields=actualStage.data.substate',
    'fields=archivalStages.data.id',
    'fields=archivalStages.data.dateSubmitted',
    'fields=archivalStages.data.decisionDate',
    'fields=code',
    'size=100',
    'page=0',
    'role=author',
    'sort=actualStage.data.modified%2Cdesc',
  ].join('&');
const FINAL = /reject|accept|withdraw|transfer|delete|declin|archiv/i;

async function search(fetcher) {
  const r = await fetcher(SEARCH, { headers: { Accept: 'application/json' } });
  if (r.status === 401 || r.status === 403) return null;
  // 服务器出错或维护时不是"没登录"，不要因此打开登录窗口
  if (r.status >= 500 || r.status === 429) throw new Error(`IEEE Author Portal 暂时不可用（HTTP ${r.status}），稍后自动重试`);
  if (!/json/i.test(r.contentType || '')) return null; // 被重定向到登录页
  try {
    const j = JSON.parse(r.text);
    return Array.isArray(j.hits) ? j : null;
  } catch {
    return null;
  }
}

async function loginWindow(ctx) {
  const cred = await ctx.getCred('ieee');
  if (!cred) {
    await ctx.setState({ noSession: true });
    throw needCredential('IEEE Author Portal 未登录，且还没有填写 IEEE 账号');
  }
  const st = await ctx.getState();
  if (!ctx.force && st.rejected === cred.savedAt) throw authRejected('IEEE 账号上次被拒绝，请在追踪面板的账号页更新密码');
  ctx.log('会话已失效，在最小化窗口里自动登录 IEEE 账号');
  const w = await openWorker({ platform: 'rex', credId: 'ieee', url: `${ORIGIN}/submission/dashboard`, label: 'IEEE 账号' });
  try {
    return await waitWorker(
      w,
      async (_w, tab) => {
        // 登录完成后不一定回到看板：ReX 的 Keycloak 会跳回"最后一次未登录时请求的地址"，
        // 实测常常是我们探测会话用的 /api/...?_search（一页 JSON）。所以回到 ReX 域名下就检查会话。
        if (!tab.url?.startsWith(`${ORIGIN}/`)) return null;
        return (await search(request).catch(() => null)) || (await search((u, o) => fetchViaTab(w.tabId, u, o)).catch(() => null));
      },
      150000,
    );
  } catch (e) {
    if (e.code === 'auth-rejected') await ctx.setState({ rejected: cred.savedAt });
    throw e;
  } finally {
    if (isWorkerTab(w.tabId)) await closeWorker(w);
  }
}

export default {
  id: 'rex',
  label: 'IEEE Author Portal',
  credIds: ['ieee'],
  openUrl: `${ORIGIN}/submission/dashboard`,

  async enabled(ctx) {
    if (await ctx.getCred('ieee')) return true;
    return !(await ctx.getState()).noSession; // 没填账号时，也先试试浏览器里现成的会话
  },

  async run(ctx) {
    let data = await search(request);
    if (!data) data = await loginWindow(ctx);
    await ctx.setState({ noSession: false });

    const items = [];
    for (const h of data.hits) {
      const d = h.actualStage?.data || {};
      if (!d.editorialReferenceCode) continue;
      items.push({
        key: `rex:${d.editorialReferenceCode}`,
        platform: 'rex',
        venue: h.journal?.name,
        manuscriptId: d.editorialReferenceCode,
        title: d.name,
        status: d.workflowState || d.state,
        submittedAt: parseDate(d.dateSubmitted),
        decidedAt: parseDate(d.decisionDate),
        updatedAt: parseDate(d.modified),
        extra: { productCode: h.journal?.productCode, eeoSystem: d.eeoSystem, journalId: h.journal?.id },
        url: `${ORIGIN}/submission/dashboard`,
      });
    }

    // 自动发现：在审稿件对应的 ScholarOne 站点
    const st = await ctx.getState();
    const siteOf = { ...(st.siteOf || {}) };
    const active = data.hits.filter((h) => h.actualStage?.data?.eeoSystem === 'S1M' && !FINAL.test(h.actualStage?.data?.workflowState || ''));
    for (const h of active) {
      const jid = h.journal?.id;
      if (!jid || siteOf[jid]) continue;
      const r = await request(`${ORIGIN}/api/rex/v2/journals/tenant/2/journal/${jid}`, { headers: { Accept: 'application/json' } }).catch(() => null);
      try {
        const j = JSON.parse(r?.text || '');
        if (j.siteName) siteOf[jid] = { site: j.siteName, name: h.journal.name };
      } catch {}
    }
    const sites = [...new Set(active.map((h) => siteOf[h.journal?.id]?.site).filter(Boolean))];
    const siteNames = Object.fromEntries(Object.values(siteOf).map((x) => [x.site, x.name]));
    await ctx.setState({ siteOf, sites, siteNames });
    ctx.log(`${items.length} 篇，在审 ${active.length} 篇，ScholarOne 站点：${sites.join('、') || '无'}`);
    return { items };
  },
};
