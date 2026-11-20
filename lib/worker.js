// 第 2 层：在最小化窗口里打开真实页面。
// 页面脚本（content/login.js）负责自动填表；之后同源请求也可以交给它代发，
// 用来绕开只拦截后台请求的 Cloudflare / AWS WAF。

import { needHuman, authRejected, blocked } from './errors.js';
import { B } from './i18n.js';
import { sleep, isChallenge } from './http.js';

/** tabId → 窗口任务 */
const workers = new Map();

export const getWorker = (tabId) => workers.get(tabId);
export const isWorkerTab = (tabId) => workers.has(tabId);

/** 打开最小化窗口并登记为工作窗口。site/credId 告诉页面脚本该用哪个账号。 */
export async function openWorker({ platform, credId, site, url, label }) {
  const win = await chrome.windows.create({ url, state: 'minimized', focused: false, type: 'normal' });
  const w = { platform, credId, site, label, windowId: win.id, tabId: win.tabs[0].id, attempts: 0, page: null, error: null };
  workers.set(w.tabId, w);
  return w;
}

/** 让工作窗口跳到新地址（例如下一个 ScholarOne 站点），并重置登录尝试次数。 */
export async function navigateWorker(w, url, patch = {}) {
  Object.assign(w, patch, { page: null, attempts: 0, error: null });
  await chrome.tabs.update(w.tabId, { url });
}

export async function closeWorker(w) {
  if (!w) return;
  workers.delete(w.tabId);
  await chrome.windows.remove(w.windowId).catch(() => {});
}

/** 全部清除时关掉所有自动登录窗口。 */
export async function closeAllWorkers() {
  for (const w of [...workers.values()]) await closeWorker(w);
}

/**
 * 轮询直到 check() 返回非空值。
 * 超时：保留窗口交给用户（多半是需要人工的验证），抛出 need-human。
 */
export async function waitWorker(w, check, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    // 调用扩展 API 也能让 service worker 保持运行
    const tab = await chrome.tabs.get(w.tabId).catch(() => null);
    if (!tab) {
      workers.delete(w.tabId);
      throw needHuman(B(`${w.label}：自动登录窗口被关闭`, `${w.label}: the sign-in window was closed`));
    }
    if (w.error) {
      await closeWorker(w);
      throw w.error;
    }
    const result = await check(w, tab);
    if (result) return result;
  }
  workers.delete(w.tabId);
  throw needHuman(B(`${w.label}：自动登录超时，可能需要你完成人机验证或两步验证`, `${w.label}: automatic sign-in timed out; a CAPTCHA or two-step verification may be needed`), { windowId: w.windowId });
}

/** 页面脚本上报当前页面。 */
export function onWorkerPage(tabId, page) {
  const w = workers.get(tabId);
  if (w) w.page = { ...page, at: Date.now() };
}

/** 页面脚本准备提交登录表单前询问。页面上已经有登录错误提示时，不再重试。 */
export function onWorkerAttempt(tabId, { error } = {}) {
  const w = workers.get(tabId);
  if (!w) return false;
  if (error && w.attempts > 0) {
    w.error = authRejected(B(`${w.label}：${error}`, `${w.label}: ${error}`));
    return false;
  }
  if (w.attempts >= 2) {
    w.error = authRejected(B(`${w.label}：自动登录两次都没有成功`, `${w.label}: automatic sign-in failed twice`));
    return false;
  }
  w.attempts++;
  return true;
}

/** 让窗口里的页面脚本代发同源请求，返回与 request() 相同的结构。 */
export async function fetchViaTab(tabId, url, { form, method, headers } = {}) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const res = await chrome.tabs.sendMessage(tabId, { type: 'tracker:fetch', url, method: method || (form ? 'POST' : 'GET'), body, headers });
  if (!res?.ok) throw new Error(B(`窗口内请求失败：${res?.error || '无响应'}`, `Request in the sign-in window failed: ${res?.error || 'no response'}`));
  if (isChallenge(res.res)) throw blocked(B(`${new URL(url).hostname} 在窗口内也返回了人机验证页`, `${new URL(url).hostname} returned a CAPTCHA page in the sign-in window as well`));
  return res.res;
}
