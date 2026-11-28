// 官网首页交互：按访问者的浏览器选好扩展商店、首屏示意的状态变化。顶栏的主题和语言切换在 controls.js。
// 静态的双语文字写在 index.html 里（data-l="zh" / data-l="en"），这里只处理标题、按钮、图片等需要脚本填写的部分。
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const html = document.documentElement;
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  // 图标来自 Lucide（ISC 许可）
  const ICONS = {
    out: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', // 商店按钮上的“在新页面打开”
    // 浏览器工具栏上的按钮，与扩展 ui/common.js 里的相同：扩展（拼图）、Edge 的眼睛、Chrome 的图钉
    puzzle: '<path d="M5 7h3V5.25a2.25 2.25 0 0 1 4.5 0V7h3a2 2 0 0 1 2 2v2.75h1.75a2.25 2.25 0 0 1 0 4.5H17.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  };

  // 语言由 theme.js 设好，切换时 controls.js 派发 langchange
  let lang = html.dataset.lang === 'zh' ? 'zh' : 'en';
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

  // ===== 安装：只从扩展商店装 =====
  // 商店地址由 build-site.sh 写进按钮的 href，还没上架的留空。
  // Edge 页签最上面始终是 Edge 加载项。它还没上架时，下面接着放 Chrome 应用商店（Edge 可以直接安装那里的扩展）；
  // 上架后 Chrome 应用商店退成底部的一行链接。
  const storeUrl = (id) => $(`a[data-store="${id}"]`)?.getAttribute('href') || '';
  const edgeLive = !!storeUrl('edge');
  const chromeLive = !!storeUrl('chrome');
  if (edgeLive || !chromeLive) $('[data-via="chrome"]').dataset.only = 'chrome chromium';
  if (!edgeLive || !chromeLive) $('.alt').remove();
  if (!chromeLive) $$('[data-needs="chrome"]').forEach((el) => el.remove());
  // 已上架的按钮加上“新页面打开”的箭头；还没上架的换成同样高度的虚线“审核中”占位，安装步骤和相关提示一并去掉
  const STORE_NAME = { edge: ['Edge 加载项', 'Edge Add-ons'], chrome: ['Chrome 应用商店', 'Chrome Web Store'] };
  $$('a.btn[data-store]').forEach((a) => {
    if (a.getAttribute('href')) {
      a.insertAdjacentHTML('beforeend', svg(ICONS.out).replace('<svg ', '<svg aria-hidden="true" '));
      return;
    }
    const block = a.closest('[data-via]');
    block.dataset.pending = '';
    block.querySelectorAll('.do, .cn-note, .or').forEach((el) => el.remove());
    const [zh, en] = STORE_NAME[a.dataset.store];
    const ph = document.createElement('span');
    ph.className = 'btn off';
    ph.innerHTML = `<span data-l="zh">${zh}</span><span data-l="en">${en}</span><small><span data-l="zh">审核中</span><span data-l="en">In review</span></small>`;
    a.replaceWith(ph);
  });
  const ALT = {
    zh: '装好后自动打开的安装成功页面，下面是选择期刊类型、连接账号',
    en: 'Welcome page that opens after installing, with journal type selection and account connection below',
  };
  // 固定到工具栏的按钮：Edge 的扩展菜单里是眼睛「在工具栏中显示」，Chrome 是图钉「固定」
  const KI = {
    puzzle: () => [ICONS.puzzle, L('扩展', 'Extensions')],
    toolbar: (b) => (b === 'edge' ? [ICONS.eye, L('在工具栏中显示', 'Show in toolbar')] : [ICONS.pin, L('固定', 'Pin')]),
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
    // 当前页签里的商店都还在审核时，不显示固定到工具栏的提示
    const pin = $('.tip.pin');
    if (!$$('[data-via]').some((b) => !b.hidden && !('pending' in b.dataset))) pin.hidden = true;
    $$('.ki', pin).forEach((el) => {
      const [icon, label] = KI[el.dataset.ki](id);
      el.innerHTML = svg(icon);
      el.title = label;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', label);
    });
    // 示意图里的安装成功提示同样按浏览器画眼睛或图钉
    const shot = $('#welcomeShot');
    const src = `img/install/${lang === 'en' ? 'en/' : ''}welcome${id === 'edge' ? '-edge' : ''}.webp`;
    if (shot.getAttribute('src') !== src) shot.src = src;
    shot.alt = ALT[lang];
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
  // 中国大陆一般打不开 Chrome 应用商店：按时区判断（港澳台时区不同），只给大陆用户看提示，也不再列出 Chrome 应用商店这条备选
  const mainland = /^(Asia\/(Shanghai|Chongqing|Chungking|Harbin|Urumqi|Kashgar)|PRC)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  $$('.cn-note').forEach((el) => (el.dataset.edge === (edgeLive ? 'live' : 'pending') ? (el.hidden = !mainland) : el.remove()));
  if (mainland) $('.alt')?.remove();
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
    $('#heroCta').textContent = ctaText();
    pick(browser);
  }
  browser = detected;
  applyLang();

  document.addEventListener('langchange', () => {
    lang = html.dataset.lang === 'zh' ? 'zh' : 'en';
    applyLang();
  });

  // 首屏示意：先显示变化前（TPAMI 稿件审稿中），稍后切到变化后并弹出桌面通知。要求减少动效时直接显示变化后的样子
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const shot = $('.shot');
    shot.classList.add('playing');
    setTimeout(() => shot.classList.add('changed'), 1400);
  }
})();
