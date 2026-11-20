// 在页面绘制前应用主题，避免闪烁（扩展页面不允许内联脚本，所以单独一个文件，放在 <head> 里同步加载）。
// 与 mituan 控制台共用 mt-theme 这个键：system / dark / light。
try {
  const t = localStorage.getItem('mt-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {}
