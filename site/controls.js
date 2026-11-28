// 官网两个页面共用的顶栏控件：主题菜单、语言菜单、滚动后顶栏的细底线。
// 主题与扩展共用 mt-theme（不存 = 跟随系统 / dark / light），语言共用 mt-lang（不存 = 跟随系统 / zh / en），初始值由 theme.js 在绘制前设好。
// 切换语言后在 document 上派发 langchange 事件，页面脚本据此刷新需要脚本填写的文字。
(() => {
  const html = document.documentElement;
  const store = (key, v) => {
    try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch {}
  };
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  // 图标来自 Lucide（ISC 许可）
  const ICONS = {
    system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  };
  const zh = () => html.dataset.lang === 'zh';

  // 主题和语言：各一个按钮加小菜单（ui/dropdown.js，与扩展相同）。都有“跟随系统”：选它就删掉保存的偏好
  const THEMES = { system: ['跟随系统', 'System'], light: ['亮色', 'Light'], dark: ['暗色', 'Dark'] };
  const t = (pair) => pair[zh() ? 0 : 1];
  const themePref = () => (html.dataset.theme === 'light' || html.dataset.theme === 'dark' ? html.dataset.theme : 'system');
  const themeMenu = mtMenu(document.getElementById('themeSlot'), {
    items: Object.keys(THEMES).map((v) => ({ v, text: () => t(THEMES[v]), icon: svg(ICONS[v]) })),
    get: themePref,
    btn: (v) => svg(ICONS[v]),
    title: (v) => `${zh() ? '主题' : 'Theme'}: ${t(THEMES[v])}`,
    label: () => (zh() ? '主题' : 'Theme'),
    pick: (v) => {
      if (v === 'system') delete html.dataset.theme;
      else html.dataset.theme = v;
      store('mt-theme', v === 'system' ? null : v);
    },
  });

  const LANGS = { auto: ['跟随系统', 'System'], zh: ['中文', '中文'], en: ['English', 'English'] };
  const langPref = () => {
    try {
      const v = localStorage.getItem('mt-lang');
      return v === 'zh' || v === 'en' ? v : 'auto';
    } catch {
      return 'auto';
    }
  };
  // 系统语言的判断与 theme.js 相同：不是中文就用英文
  const sysLang = () => (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale || navigator.language || '') ? 'zh' : 'en');
  mtMenu(document.getElementById('langSlot'), {
    items: Object.keys(LANGS).map((v) => ({ v, text: () => t(LANGS[v]) })),
    get: langPref,
    btn: () => `<span class="glyph">${zh() ? '中' : 'EN'}</span>`,
    title: (v) => `${zh() ? '语言' : 'Language'}: ${t(LANGS[v])}`,
    label: () => (zh() ? '语言' : 'Language'),
    pick: (v) => {
      store('mt-lang', v === 'auto' ? null : v);
      const lang = v === 'auto' ? sysLang() : v;
      html.dataset.lang = lang;
      html.lang = lang === 'zh' ? 'zh-CN' : 'en';
      themeMenu.paint();
      document.dispatchEvent(new Event('langchange'));
    },
  });

  // 顶栏停在页面顶部时没有底线，滚动后出现
  const nav = document.querySelector('.nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
