// 隐私政策页的主题和语言切换，与官网首页（site.js）共用 mt-theme、mt-lang，样式也相同。
// 首页的 site.js 绑定了很多只在首页存在的元素，所以这里单独写一份精简版。
(() => {
  const $$ = (s) => [...document.querySelectorAll(s)];
  const html = document.documentElement;
  const store = (key, v) => {
    try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch {}
  };
  const read = (key, dflt) => {
    try { return localStorage.getItem(key) || dflt; } catch { return dflt; }
  };
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  // 图标来自 Lucide（ISC 许可）
  const ICONS = {
    system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  };
  const TITLE = { zh: '隐私政策 · mituan 投稿追踪', en: 'Privacy Policy · mituan Manuscript Tracker' };

  const theme = read('mt-theme', 'system');
  document.getElementById('themeSlot').innerHTML = `<span class="theme" role="group">${['system', 'dark', 'light']
    .map((t) => `<button type="button" data-t="${t}" class="${t === theme ? 'on' : ''}">${svg(ICONS[t])}</button>`).join('')}</span>`;
  $$('.theme button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t;
    store('mt-theme', t === 'system' ? null : t);
    if (t === 'system') delete html.dataset.theme;
    else html.dataset.theme = t;
    $$('.theme button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  let langPref = read('mt-lang', 'auto');
  const resolve = (pref) => {
    if (pref === 'zh' || pref === 'en') return pref;
    const sys = [Intl.DateTimeFormat().resolvedOptions().locale, navigator.language].find(Boolean) || 'en';
    return /^zh/i.test(sys) ? 'zh' : 'en';
  };
  document.getElementById('langSlot').innerHTML = '<span class="langsw" role="group">'
    + `<button type="button" data-lg="auto">${svg(ICONS.globe)}</button>`
    + '<button type="button" data-lg="zh" title="中文" aria-label="中文" lang="zh-CN"><span class="glyph">中</span></button>'
    + '<button type="button" data-lg="en" title="English" aria-label="English" lang="en"><span class="glyph">EN</span></button></span>';
  const apply = () => {
    const lang = resolve(langPref);
    const zh = lang === 'zh';
    html.dataset.lang = lang;
    html.lang = zh ? 'zh-CN' : 'en';
    document.title = TITLE[lang];
    const tt = { system: ['跟随系统', 'Follow system'], dark: ['暗色', 'Dark'], light: ['亮色', 'Light'] };
    $$('.theme button').forEach((b) => b.setAttribute('aria-label', (b.title = tt[b.dataset.t][zh ? 0 : 1])));
    const auto = document.querySelector('.langsw [data-lg="auto"]');
    auto.setAttribute('aria-label', (auto.title = zh ? '跟随系统语言' : 'Follow system language'));
    $$('.langsw button').forEach((b) => b.classList.toggle('on', b.dataset.lg === langPref));
  };
  $$('.langsw button').forEach((b) => b.addEventListener('click', () => {
    langPref = b.dataset.lg;
    store('mt-lang', langPref === 'auto' ? null : langPref);
    apply();
  }));
  apply();
})();
