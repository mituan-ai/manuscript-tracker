// 官网交互：主题和语言切换（与扩展共用 mt-theme、mt-lang）、按访问者的浏览器选好扩展商店、滚动浮现。
// 静态的双语文字写在 index.html 里（data-l="zh" / data-l="en"），这里只处理标题、按钮、图片等需要脚本填写的部分。
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const html = document.documentElement;
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const store = (key, v) => {
    try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch {}
  };
  const read = (key, dflt) => {
    try { return localStorage.getItem(key) || dflt; } catch { return dflt; }
  };

  // 图标来自 Lucide（ISC 许可）
  const ICONS = {
    system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    list: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7M14 9h7M14 15h7M14 20h7"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  };
  for (const k of ['list', 'bell', 'moon', 'clock']) $$(`.fi-${k}`).forEach((el) => (el.innerHTML = svg(ICONS[k])));
  $$('.lk').forEach((el) => (el.innerHTML = svg(ICONS.lock)));

  // 语言：偏好 auto（默认，不存）/ zh / en 存在 mt-lang；auto 时的判断与 theme.js 相同
  let langPref = read('mt-lang', 'auto');
  const resolveLang = (pref) => {
    if (pref === 'zh' || pref === 'en') return pref;
    const sys = [globalThis.chrome?.i18n?.getUILanguage?.(), Intl.DateTimeFormat().resolvedOptions().locale, navigator.language].find(Boolean) || 'en';
    return /^zh/i.test(sys) ? 'zh' : 'en';
  };
  let lang = html.dataset.lang === 'zh' || html.dataset.lang === 'en' ? html.dataset.lang : resolveLang(langPref);
  const L = (zh, en) => (lang === 'zh' ? zh : en);

  // 页面标题和分享信息：英文就是 index.html 里写的，中文在这里
  const META = {
    en: {
      title: document.title,
      desc: $('meta[name="description"]').content,
      ogTitle: $('meta[property="og:title"]').content,
      ogDesc: $('meta[property="og:description"]').content,
    },
    zh: {
      title: 'mituan 投稿追踪 · 自动查询期刊投稿状态的浏览器扩展',
      desc: 'Edge / Chrome 浏览器扩展：后台定时查询 IEEE、Elsevier 等投稿系统，按期刊汇总稿件状态，状态变化时发送桌面通知。无需注册，账号加密保存在本机，源码公开。',
      ogTitle: 'mituan 投稿追踪 · 自动查询期刊投稿状态',
      ogDesc: '后台定时查询 IEEE、Elsevier 等投稿系统，按期刊汇总稿件状态，状态变化时通知。无需注册，账号只保存在本机。',
    },
  };

  // 主题
  const THEME_TITLE = { system: ['跟随系统', 'Follow system'], dark: ['暗色', 'Dark'], light: ['亮色', 'Light'] };
  const setTheme = (t) => {
    store('mt-theme', t === 'system' ? null : t);
    if (t === 'system') delete html.dataset.theme;
    else html.dataset.theme = t;
    $$('.theme button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  };
  const theme = read('mt-theme', 'system');
  $('#themeSlot').innerHTML = `<span class="theme" role="group">${['system', 'dark', 'light']
    .map((t) => `<button type="button" data-t="${t}" class="${t === theme ? 'on' : ''}">${svg(ICONS[t])}</button>`)
    .join('')}</span>`;
  $$('.theme button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.t)));

  // 语言切换：跟随系统 / 中 / EN，点击后就地切换，不刷新页面
  $('#langSlot').innerHTML = `<span class="langsw" role="group">`
    + `<button type="button" data-lg="auto">${svg(ICONS.globe)}</button>`
    + `<button type="button" data-lg="zh" title="中文" aria-label="中文" lang="zh-CN"><span class="glyph">中</span></button>`
    + `<button type="button" data-lg="en" title="English" aria-label="English" lang="en"><span class="glyph">EN</span></button></span>`;
  $$('.langsw button').forEach((b) => b.addEventListener('click', () => {
    langPref = b.dataset.lg;
    store('mt-lang', langPref === 'auto' ? null : langPref);
    lang = resolveLang(langPref);
    applyLang();
  }));

  // ===== 安装：只从扩展商店装。Edge 用 Edge 加载项，Chrome 和其他 Chromium 浏览器用 Chrome 应用商店 =====
  // 商店地址由 build-site.sh 写进按钮的 href；还没上架的商店留空，按钮换成“审核中”的说明，安装步骤和提示一并去掉。
  const storeUrl = (id) => $(`a[data-store="${id}"]`)?.getAttribute('href') || '';
  $$('a[data-store]').forEach((a) => {
    if (a.getAttribute('href')) return;
    a.parentElement.querySelectorAll('.do, .tip, .cn-note').forEach((el) => el.remove());
    const p = document.createElement('p');
    p.className = 'tip pending';
    p.innerHTML = a.dataset.store === 'edge'
      ? '<span data-l="zh">Edge 加载项正在审核，上线后就能在这里安装。</span><span data-l="en">The Edge Add-ons listing is under review. You can install it here once it is live.</span>'
      : '<span data-l="zh">Chrome 应用商店正在审核，上线后就能在这里安装。</span><span data-l="en">The Chrome Web Store listing is under review. You can install it here once it is live.</span>';
    a.replaceWith(p);
  });
  const ALT = {
    zh: '装好后自动打开的安装成功页面，下面是选择期刊类型、连接账号',
    en: 'Welcome page that opens after installing, with journal type selection and account connection below',
  };

  let browser = 'edge';
  const pick = (id) => {
    browser = id;
    $$('.browsers button').forEach((el) => {
      el.classList.toggle('on', el.dataset.b === id);
      el.setAttribute('aria-selected', el.dataset.b === id);
    });
    $$('.panel').forEach((p) => (p.hidden = !p.dataset.for.split(' ').includes(id)));
    $$('[data-only]').forEach((el) => (el.hidden = !el.dataset.only.split(' ').includes(id)));
  };
  $$('.browsers button').forEach((el) => el.addEventListener('click', () => pick(el.dataset.b)));

  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua);
  const detected = /Edg\//.test(ua) ? 'edge'
    : /Firefox\//.test(ua) ? 'firefox'
    : /(QIHU|360SE|360EE|QQBrowser|MetaSr|SE 2\.X|Brave|OPR\/|YaBrowser|Vivaldi)/.test(ua) ? 'chromium'
    : /Chrome\//.test(ua) ? 'chrome'
    : /Safari\//.test(ua) ? 'safari' : 'edge';
  $('#mobileNote').hidden = !mobile;
  // 中国大陆一般打不开 Chrome 应用商店：按时区判断（港澳台时区不同），只给大陆用户看改用 Edge 的提示
  const mainland = /^(Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar)|PRC)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const cnNote = $('.cn-note');
  if (cnNote) cnNote.hidden = !mainland;
  // 首屏按钮：在 Edge / Chrome 里直接打开对应的商店页面（一键安装）；其他情况，以及大陆的 Chrome 用户，跳到安装区
  const heroStore = !mobile && (detected === 'edge' || (detected === 'chrome' && !mainland)) && storeUrl(detected) ? detected : null;
  if (heroStore) {
    const cta = $('#heroCta');
    cta.href = storeUrl(heroStore);
    cta.target = '_blank';
    cta.rel = 'noopener';
  }
  const ctaText = () => {
    if (heroStore) return L(`安装到 ${heroStore === 'edge' ? 'Edge' : 'Chrome'}`, `Add to ${heroStore === 'edge' ? 'Edge' : 'Chrome'}`);
    if (detected === 'firefox' || detected === 'safari') return L('查看浏览器支持', 'See browser support');
    return L('安装扩展', 'Install extension');
  };

  // 切换语言：静态文字由 CSS 按 <html data-lang> 显示，其余在这里刷新
  const ARIA = [
    ['a.brand', 'mituan 投稿追踪', 'mituan Manuscript Tracker'],
    ['.theme', '主题', 'Theme'],
    ['.langsw', '语言', 'Language'],
    ['.browsers', '选择浏览器', 'Choose your browser'],
  ];
  function applyLang() {
    html.dataset.lang = lang;
    html.lang = L('zh-CN', 'en');
    const m = META[lang];
    document.title = m.title;
    $('meta[name="description"]').content = m.desc;
    $('meta[property="og:title"]').content = m.ogTitle;
    $('meta[property="og:description"]').content = m.ogDesc;
    for (const [sel, zh, en] of ARIA) $$(sel).forEach((el) => el.setAttribute('aria-label', L(zh, en)));
    $$('.theme button').forEach((b) => {
      b.title = L(...THEME_TITLE[b.dataset.t]);
      b.setAttribute('aria-label', b.title);
    });
    const auto = $('.langsw [data-lg="auto"]');
    auto.title = L('跟随系统语言', 'Follow system language');
    auto.setAttribute('aria-label', auto.title);
    $$('.langsw button').forEach((b) => b.classList.toggle('on', b.dataset.lg === langPref));
    $('#heroCta').textContent = ctaText();
    const welcome = $('#welcomeShot');
    const src = `img/install/${lang === 'en' ? 'en/' : ''}welcome.webp`;
    if (welcome.getAttribute('src') !== src) welcome.src = src;
    welcome.alt = ALT[lang];
    pick(browser);
  }
  browser = detected;
  applyLang();

  // 滚动到时浮现：章节标题、卡片依次淡入上移。不支持 IntersectionObserver 或要求减少动效时什么都不做，内容直接显示
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    html.classList.add('js-reveal');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    $$('.head, .feat, .pub, .systab-wrap, .legend, .secure, .browsers, .panel, .faq').forEach((el) => {
      // 同一行的卡片错开一点出现
      if (el.matches('.feat, .pub')) el.style.setProperty('--i', [...el.parentElement.children].indexOf(el));
      el.classList.add('reveal');
      io.observe(el);
    });
  }
})();
