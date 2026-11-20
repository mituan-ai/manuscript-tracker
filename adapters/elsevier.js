// Elsevier Track your submission：公开 JSON 接口，不需要登录，凭投稿确认邮件里的 UUID 查询。
// 只覆盖审稿阶段；状态码映射取自 track.authorhub.elsevier.com 的前端代码。

import { request } from '../lib/http.js';
import { getElsevierIds } from '../lib/vault.js';

const API = 'https://tnlkuelk67.execute-api.us-east-1.amazonaws.com/tracker/';
const STATUS = { 3: 'Under Review', 4: 'Required Reviews Complete', 23: 'Under Review' };

/** 从链接或纯文本里取出 UUID。 */
export function parseTrackId(s) {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(s || '')?.[0]?.toLowerCase() || null;
}

export default {
  id: 'elsevier',
  label: 'Elsevier',
  credIds: [],
  openUrl: 'https://track.authorhub.elsevier.com/',

  async enabled() {
    return (await getElsevierIds()).length > 0;
  },

  async run(ctx) {
    const items = [];
    const errors = [];
    for (const id of await getElsevierIds()) {
      const r = await request(API + id, { headers: { Accept: 'application/json' } });
      let d = null;
      try {
        d = JSON.parse(r.text);
      } catch {}
      if (!r.ok || !d?.PubdNumber) {
        errors.push(`${id.slice(0, 8)}…：查不到（HTTP ${r.status}），可能已结束审稿或链接有误`);
        continue;
      }
      items.push({
        key: `elsevier:${d.PubdNumber}`,
        platform: 'elsevier',
        venue: d.JournalName || d.JournalAcronym,
        manuscriptId: d.PubdNumber,
        title: d.ManuscriptTitle,
        status: STATUS[d.Status] || 'Review Complete',
        submittedAt: d.SubmissionDate ? d.SubmissionDate * 1000 : null,
        updatedAt: d.LastUpdated ? d.LastUpdated * 1000 : null,
        extra: { statusCode: d.Status, revision: d.LatestRevisionNumber, reviewSummary: d.ReviewSummary || null },
        url: `https://track.authorhub.elsevier.com/?uuid=${id}`,
      });
    }
    for (const e of errors) ctx.log(e, 'error');
    return { items, warnings: errors };
  },
};
