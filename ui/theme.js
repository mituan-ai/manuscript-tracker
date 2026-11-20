// 在页面绘制前应用主题和语言，避免闪烁（扩展页面不允许内联脚本，所以单独一个文件，放在 <head> 里同步加载）。官网也用这个文件。
// 主题与 mituan 控制台共用 mt-theme：system / dark / light。
// 语言存在 mt-lang：auto（默认，跟随系统）/ zh / en。结果写到 <html data-lang="zh|en">，
// 静态的双语文字（data-l="zh" / data-l="en"）由 CSS 只显示其中一种。
try {
  const t = localStorage.getItem('mt-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {}
(() => {
  let pref = 'auto';
  try {
    pref = localStorage.getItem('mt-lang') || 'auto';
  } catch {}
  // 系统语言：扩展里用浏览器界面语言（默认随系统）；网页里用 Intl 的默认区域，取不到再用浏览器语言。不是中文就用英文。
  const sys = [globalThis.chrome?.i18n?.getUILanguage?.(), Intl.DateTimeFormat().resolvedOptions().locale, navigator.language].find(Boolean) || 'en';
  const lang = pref === 'zh' || pref === 'en' ? pref : /^zh/i.test(sys) ? 'zh' : 'en';
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
})();
