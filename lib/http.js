// 网络请求：带上浏览器里的 Cookie，按页面声明的编码解码。

import { blocked } from './errors.js';

/** 每个凭证只允许发往这些域名。 */
export const CREDENTIAL_ORIGINS = {
  scholarone: ['https://mc.manuscriptcentral.com'],
  ieee: ['https://www.ieee.org', 'https://services10.ieee.org'],
  paperplaza: ['https://ifac-sms.org', 'https://ifac.papercept.net'],
  tcct: ['https://cms.amss.ac.cn'],
};

export function assertCredentialOrigin(credId, url) {
  const allowed = CREDENTIAL_ORIGINS[credId.split(':')[0]] || [];
  if (!allowed.includes(new URL(url).origin)) throw new Error(`拒绝把 ${credId} 的凭证发往 ${new URL(url).origin}`);
}

export function toParams(input) {
  if (input instanceof URLSearchParams) return input;
  const p = new URLSearchParams();
  const entries = Array.isArray(input) ? input : Object.entries(input);
  for (const [k, v] of entries) if (v != null) p.append(k, String(v));
  return p;
}

/** 从表单字段对出发，用 overrides 覆盖（同名字段全部替换）。 */
export function formWith(pairs, overrides = {}) {
  const p = toParams(pairs);
  for (const [k, v] of Object.entries(overrides)) p.set(k, String(v));
  return p;
}

function decode(buf, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/**
 * @param {string} url
 * @param {{method?: string, form?: any, headers?: object, timeoutMs?: number}} opts
 */
// 扩展的 service worker 里，fetch 超过 30 秒没有响应时整个 worker 会被浏览器终止，所以限时 25 秒（含读取正文）
export async function request(url, { method, form, headers = {}, timeoutMs = 25000 } = {}) {
  const init = { method: method || (form ? 'POST' : 'GET'), credentials: 'include', cache: 'no-store', headers: { ...headers } };
  if (form) init.body = toParams(form);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  init.signal = ctrl.signal;
  let resp, buf;
  try {
    resp = await fetch(url, init);
    buf = await resp.arrayBuffer();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${new URL(url).hostname} 超过 ${timeoutMs / 1000} 秒没有响应`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = decode(buf, resp.headers.get('content-type'));
  const res = { url: resp.url, status: resp.status, ok: resp.ok, contentType: resp.headers.get('content-type') || '', text };
  if (isChallenge(res)) throw blocked(`${new URL(url).hostname} 返回了人机验证页（HTTP ${res.status}）`);
  return res;
}

/** Cloudflare 的 "Just a moment" 页，或 AWS WAF 的 202 挑战。 */
export function isChallenge(res) {
  if (res.status === 202 && res.text.length < 2000 && /awswaf|challenge|^\s*$/i.test(res.text)) return true;
  if (res.status !== 403 && res.status !== 503 && res.status !== 429) return false;
  return /Just a moment|challenge-platform|cf_chl_opt|cf-browser-verification|AwsWafIntegration/i.test(res.text);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
