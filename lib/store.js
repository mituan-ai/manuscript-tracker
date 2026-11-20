// 本地状态：稿件、平台运行状态、设置。全部在 chrome.storage.local。

export const DEFAULT_SETTINGS = {
  captureLogins: true, // 你在网页上手动登录时，记下账号用于自动查询
  notify: true,
  pauseWhenActiveMinutes: 10, // 你最近 N 分钟用过 ScholarOne 标签页时，本轮跳过 ScholarOne
  scholaroneSites: [], // 手动指定的 ScholarOne 站点；另外会从 IEEE Author Portal 自动发现
  tcctConfids: [], // 手动指定的 TCCT 会议编号；另外会自动发现
  intervals: { scholarone: 120, rex: 360, paperplaza: 360, tcct: 360, elsevier: 360, web: 360 },
};

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings, intervals: { ...DEFAULT_SETTINGS.intervals, ...(settings.intervals || {}) } };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch, intervals: { ...cur.intervals, ...(patch.intervals || {}) } };
  await chrome.storage.local.set({ settings: next });
  return next;
}

let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn);
  chain = next.catch(() => {});
  return next;
}

export function getPlatformState(id) {
  return chrome.storage.local.get(`state:${id}`).then((r) => r[`state:${id}`] || {});
}

export function patchPlatformState(id, patch) {
  return serial(async () => {
    const cur = await getPlatformState(id);
    const next = { ...cur, ...patch };
    await chrome.storage.local.set({ [`state:${id}`]: next });
    return next;
  });
}

/** 读-改-写平台状态（和其他写入排队，不会互相覆盖）。 */
export function updatePlatformState(id, fn) {
  return serial(async () => {
    const next = fn(await getPlatformState(id));
    await chrome.storage.local.set({ [`state:${id}`]: next });
    return next;
  });
}

export function setPlatformStatus(id, status) {
  return serial(async () => {
    const { platforms = {} } = await chrome.storage.local.get('platforms');
    platforms[id] = { ...(platforms[id] || {}), ...status };
    await chrome.storage.local.set({ platforms });
    return platforms[id];
  });
}

const sameReview = (a, b) => JSON.stringify(a?.reviewSummary || null) === JSON.stringify(b?.reviewSummary || null);

/**
 * 合并一次查询的结果，返回变化列表。
 * firstRun 为 true 时（该平台第一次查询成功）只入库，不算"新稿件"。
 */
export function applyResults(platform, items, { firstRun }) {
  return serial(async () => {
    const { items: all = {} } = await chrome.storage.local.get('items');
    const now = Date.now();
    const changes = [];
    for (const it of items) {
      const prev = all[it.key];
      if (!prev) {
        // 首次见到：最近变化时间尽量用平台给的真实日期；很久以前的稿件只算补录，不提醒
        const known = it.updatedAt || it.decidedAt || it.submittedAt;
        const backfill = firstRun || (known && now - known > 30 * 86400000);
        all[it.key] = { ...it, firstSeenAt: now, lastSeenAt: now, lastChangedAt: Math.min(known || now, now), history: [{ at: now, status: it.status, initial: true }] };
        if (!backfill) {
          all[it.key].unseen = true;
          changes.push({ type: 'new', item: all[it.key] });
        }
        continue;
      }
      const merged = { ...prev, ...it, firstSeenAt: prev.firstSeenAt, lastSeenAt: now, history: prev.history || [], unseen: prev.unseen };
      if (prev.status !== it.status || !sameReview(prev.extra, it.extra)) {
        merged.history = [...merged.history, { at: now, status: it.status, from: prev.status }].slice(-60);
        merged.lastChangedAt = now;
        merged.unseen = true;
        changes.push({ type: 'status', item: merged, from: prev.status });
      } else merged.lastChangedAt = prev.lastChangedAt;
      all[it.key] = merged;
    }
    await chrome.storage.local.set({ items: all });
    return changes;
  });
}

export function markAllSeen() {
  return serial(async () => {
    const { items: all = {} } = await chrome.storage.local.get('items');
    for (const it of Object.values(all)) delete it.unseen;
    await chrome.storage.local.set({ items: all });
  });
}

export function deleteItem(key) {
  return serial(async () => {
    const { items: all = {} } = await chrome.storage.local.get('items');
    delete all[key];
    await chrome.storage.local.set({ items: all });
  });
}
