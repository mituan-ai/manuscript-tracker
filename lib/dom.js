// service worker 侧的解析入口：把 HTML 交给 offscreen 文档解析。

let creating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  creating ||= chrome.offscreen
    .createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: '解析投稿平台返回的 HTML 页面' })
    .catch((e) => {
      if (!/single offscreen/i.test(String(e?.message))) throw e;
    })
    .finally(() => (creating = null));
  await creating;
}

/** @param {'s1Page'|'ppPage'|'tcctAuthor'|'tcctConfids'|'webPage'} name */
export async function extract(name, html, url) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', name, html, url });
  if (!res?.ok) throw new Error(`解析失败（${name}）：${res?.error || '无响应'}`);
  return res.data;
}
