// 官网交互：主题和语言切换（与扩展共用 mt-theme、mt-lang）、按访问者的浏览器选好安装说明、复制扩展页地址、滚动浮现。
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

  // ===== 安装截图与圈的位置：按（语言，浏览器）分开，换截图时只改这里 =====
  // 文件都在 img/install/ 下：第 n 张截图是 `${file}-${n}.webp`（1280×760），welcome 是装好后自动打开的页面（1040×520）。
  // ring 是截图上要圈出的位置，单位为百分比 [左, 上, 宽, 高]，依次对应第 2 步、第 3 步和完成。
  // 「其他 Chromium」用 chrome 的截图和坐标。
  const SHOTS = {
    zh: {
      welcome: 'welcome.webp',
      edge: { file: 'edge', ring: [[3.1, 90.0, 20.3, 5.3], [66.1, 13.3, 12.5, 5.5], [29.7, 57.0, 63.4, 21.1]] },
      chrome: { file: 'chrome', ring: [[89.8, 1.1, 9.8, 5.3], [1.4, 7.9, 13.8, 6.3], [26.4, 25.9, 32.2, 28.9]] },
    },
    en: {
      welcome: 'en/welcome.webp',
      edge: { file: 'en/edge', ring: [[3.3, 90.0, 19.9, 5.3], [63.8, 13.3, 11.3, 5.5], [29.7, 23.8, 63.4, 21.6]] },
      chrome: { file: 'en/chrome', ring: [[87.3, 1.2, 12.4, 5.0], [1.4, 7.9, 10.5, 6.3], [26.4, 25.9, 32.2, 28.9]] },
    },
  };

  // 安装说明里各浏览器的按钮名称和位置，取自 Edge 157 与 Chromium 的中、英文界面
  const EXT_URL = { edge: 'edge://extensions', chrome: 'chrome://extensions', chromium: 'chrome://extensions' };
  const CHROME_TXT = {
    zh: { dev: '开发者模式', devwhere: '右上角', load: '加载未打包的扩展程序', loadwhere: '左上方', err: '清单文件缺失或不可读取', pin: '图钉图标', reload: ' ↻ 图标' },
    en: { dev: 'Developer mode', devwhere: 'top right', load: 'Load unpacked', loadwhere: 'top left', err: 'Manifest file is missing or unreadable', pin: 'pin icon', reload: 'the ↻ icon' },
  };
  const TXT = {
    zh: {
      edge: { name: 'Microsoft Edge', dev: '开发人员模式', devwhere: '左下角', load: '加载解压缩的扩展', loadwhere: '右上方', err: '清单文件丢失或不可读取', pin: '眼睛图标', reload: '「重新加载」' },
      chrome: { ...CHROME_TXT.zh, name: 'Google Chrome' },
      chromium: { ...CHROME_TXT.zh, name: 'Chrome（示意，你的浏览器可能不同）' },
    },
    en: {
      edge: { name: 'Microsoft Edge', dev: 'Developer mode', devwhere: 'bottom left', load: 'Load unpacked', loadwhere: 'top right', err: 'Manifest file is missing or unreadable', pin: 'eye icon', reload: '“Reload”' },
      chrome: { ...CHROME_TXT.en, name: 'Google Chrome' },
      chromium: { ...CHROME_TXT.en, name: 'Chrome (for reference; your browser may differ)' },
    },
  };
  const ALT = {
    zh: { 1: '扩展页面上的开发者模式开关', 2: '打开开关后出现的加载扩展按钮', 3: '扩展页面上出现 mituan 投稿追踪', welcome: '装好后自动打开的安装成功页面，下面是选择期刊类型、连接账号' },
    en: { 1: 'Developer mode switch on the extensions page', 2: 'Load unpacked button that appears after turning on the switch', 3: 'mituan Manuscript Tracker listed on the extensions page', welcome: 'Welcome page that opens after installing, with journal type selection and account connection below' },
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
    if (!EXT_URL[id]) return;
    $$('[data-url]').forEach((el) => (el.textContent = EXT_URL[id]));
    // 两种语言的文字各填各的，切换语言时不用再填
    for (const k of ['name', 'dev', 'devwhere', 'load', 'loadwhere', 'err', 'pin', 'reload']) {
      $$(`[data-${k}]`).forEach((el) => (el.textContent = TXT[el.closest('[data-l]')?.dataset.l || lang][id][k]));
    }
    const shots = SHOTS[lang][id === 'edge' ? 'edge' : 'chrome'];
    $$('img[data-shot]').forEach((img) => {
      const n = +img.dataset.shot;
      const src = `img/install/${shots.file}-${n}.webp`;
      if (img.getAttribute('src') !== src) img.src = src;
      img.alt = `${TXT[lang][id].name}${L('：', ': ')}${ALT[lang][n]}`;
      const [x, y, w, h] = shots.ring[n - 1];
      const fig = img.parentElement.style;
      fig.setProperty('--x', `${x}%`);
      fig.setProperty('--y', `${y}%`);
      fig.setProperty('--w', `${w}%`);
      fig.setProperty('--h', `${h}%`);
    });
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
  const ctaText = () => {
    if (!mobile && (detected === 'edge' || detected === 'chrome')) {
      const name = detected === 'edge' ? 'Edge' : 'Chrome';
      return L(`安装到 ${name}`, `Install for ${name}`);
    }
    if (detected === 'firefox' || detected === 'safari') return L('查看浏览器支持', 'See browser support');
    return L('安装扩展', 'Install extension');
  };

  // 网页不能直接打开 edge:// 地址，只能复制后让用户粘贴
  const COPY = { idle: ['复制地址', 'Copy address'], ok: ['已复制，去地址栏粘贴', 'Copied. Paste it into the address bar'], manual: ['请按 Ctrl+C 复制', 'Press Ctrl+C to copy'] };
  let copyState = 'idle';
  let copyTimer;
  const showCopy = (state) => {
    copyState = state;
    $('#copyUrl').textContent = L(...COPY[state]);
  };
  $('#copyUrl').addEventListener('click', async () => {
    const code = $('#extUrl');
    try {
      await navigator.clipboard.writeText(code.textContent);
      showCopy('ok');
    } catch {
      getSelection().selectAllChildren(code);
      showCopy('manual');
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => showCopy('idle'), 3000);
  });

  // 切换语言：静态文字由 CSS 按 <html data-lang> 显示，其余在这里刷新
  const ARIA = [
    ['a.brand', 'mituan 投稿追踪', 'mituan Manuscript Tracker'],
    ['.theme', '主题', 'Theme'],
    ['.langsw', '语言', 'Language'],
    ['.browsers', '选择浏览器', 'Choose your browser'],
    ['.stepper', '安装步骤', 'Installation steps'],
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
    showCopy(copyState);
    const welcome = $('#welcomeShot');
    const src = `img/install/${SHOTS[lang].welcome}`;
    if (welcome.getAttribute('src') !== src) welcome.src = src;
    welcome.alt = ALT[lang].welcome;
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
