// mituan 投稿追踪 · 通用识别的页面脚本
// 只注册在你添加过、并允许扩展访问的投稿网站上。页面里出现表格时交给扩展识别，顺手更新这个期刊的稿件状态。
// 不读取、不保存任何密码。

(() => {
  if (window.top !== window || window.__mituanCapture) return;
  window.__mituanCapture = true;
  const HINT = /status|stage|decision|状态|进度/i;
  let last = '';
  let sent = 0;

  function check() {
    if (sent >= 5) return;
    const grids = [...document.querySelectorAll('table, [role=table], [role=grid]')];
    if (!grids.some((g) => HINT.test(g.textContent))) return;
    // 内容没变就不重复发送（单页应用会反复改动页面）
    const sig = grids.map((g) => g.textContent.length).join(',');
    if (sig === last) return;
    last = sig;
    sent++;
    chrome.runtime.sendMessage({ type: 'tracker:webpage', html: document.documentElement.outerHTML }).catch(() => {});
  }

  let timer;
  const mo = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(check, 1500);
  });
  check();
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 60000);
})();
