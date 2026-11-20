// offscreen 文档：service worker 里没有 DOMParser，HTML 解析放在这里做。
import { EXTRACTORS } from './lib/extract.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  try {
    const fn = EXTRACTORS[msg.name];
    if (!fn) throw new Error(`未知的解析器 ${msg.name}`);
    const doc = new DOMParser().parseFromString(msg.html, 'text/html');
    sendResponse({ ok: true, data: fn(doc, msg.url) });
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
  return false;
});
