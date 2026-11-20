// 官网交互：主题切换（与扩展共用 mt-theme）、按访问者的浏览器选好安装说明、复制扩展页地址。
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

  // 图标来自 Lucide（ISC 许可）
  const ICONS = {
    system: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    list: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7M14 9h7M14 15h7M14 20h7"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  };
  for (const k of ['list', 'bell', 'moon', 'clock']) $$(`.fi-${k}`).forEach((el) => (el.innerHTML = svg(ICONS[k])));
  $$('.lk').forEach((el) => (el.innerHTML = svg(ICONS.lock)));

  // 主题
  const TITLE = { system: '跟随系统', dark: '暗色', light: '亮色' };
  const current = () => {
    try { return localStorage.getItem('mt-theme') || 'system'; } catch { return 'system'; }
  };
  const setTheme = (t) => {
    try { t === 'system' ? localStorage.removeItem('mt-theme') : localStorage.setItem('mt-theme', t); } catch {}
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    $$('.theme button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  };
  $('#themeSlot').innerHTML = `<span class="theme" role="group" aria-label="主题">${['system', 'dark', 'light']
    .map((t) => `<button type="button" data-t="${t}" title="${TITLE[t]}" aria-label="${TITLE[t]}" class="${t === current() ? 'on' : ''}">${svg(ICONS[t])}</button>`)
    .join('')}</span>`;
  $$('.theme button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.t)));

  // 安装：各浏览器的按钮名称、位置和截图不同。文字取自 Edge 157 和 Chromium 的中文界面；
  // ring 是截图（1280×760）上要圈出的位置，单位为百分比：[左, 上, 宽, 高]，依次对应第 2、3 步和完成。
  const CHROME = {
    url: 'chrome://extensions', dev: '开发者模式', devwhere: '右上角', load: '加载未打包的扩展程序', loadwhere: '左上方',
    err: '清单文件缺失或不可读取', pin: '图钉图标', reload: ' ↻ 图标', shots: 'chrome',
    ring: [[89.8, 1.1, 9.8, 5.3], [1.4, 7.9, 13.8, 6.3], [26.4, 25.9, 32.2, 28.9]],
  };
  const B = {
    edge: {
      name: 'Microsoft Edge', url: 'edge://extensions', dev: '开发人员模式', devwhere: '左下角', load: '加载解压缩的扩展', loadwhere: '右上方',
      err: '清单文件丢失或不可读取', pin: '眼睛图标', reload: '「重新加载」', shots: 'edge',
      ring: [[3.1, 90.0, 20.3, 5.3], [66.1, 13.3, 12.5, 5.5], [29.7, 57.0, 63.4, 21.1]],
    },
    chrome: { ...CHROME, name: 'Google Chrome' },
    chromium: { ...CHROME, name: 'Chrome（示意，你的浏览器可能不同）' },
    firefox: { name: 'Firefox' },
    safari: { name: 'Safari' },
  };
  const ALT = { 1: '扩展页面上的开发者模式开关', 2: '打开开关后出现的加载扩展按钮', 3: '扩展页面上出现 mituan 投稿追踪' };
  const pick = (id) => {
    const b = B[id];
    $$('.browsers button').forEach((el) => {
      el.classList.toggle('on', el.dataset.b === id);
      el.setAttribute('aria-selected', el.dataset.b === id);
    });
    $$('.panel').forEach((p) => (p.hidden = !p.dataset.for.split(' ').includes(id)));
    $$('[data-only]').forEach((el) => (el.hidden = !el.dataset.only.split(' ').includes(id)));
    if (!b.url) return;
    for (const k of ['name', 'dev', 'devwhere', 'load', 'loadwhere', 'err', 'pin', 'reload', 'url']) {
      $$(`[data-${k}]`).forEach((el) => (el.textContent = b[k]));
    }
    $$('img[data-shot]').forEach((img) => {
      const n = +img.dataset.shot;
      img.src = `img/install/${b.shots}-${n}.webp`;
      img.alt = `${b.name}：${ALT[n]}`;
      const [x, y, w, h] = b.ring[n - 1];
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
  pick(detected);
  $('#mobileNote').hidden = !mobile;
  const cta = $('#heroCta');
  if (!mobile && (detected === 'edge' || detected === 'chrome')) cta.textContent = `免费安装到 ${detected === 'edge' ? 'Edge' : 'Chrome'}`;
  else if (detected === 'firefox' || detected === 'safari') cta.textContent = '查看安装方式';

  // 网页不能直接打开 edge:// 地址，只能复制后让用户粘贴
  $('#copyUrl').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const code = $('#extUrl');
    try {
      await navigator.clipboard.writeText(code.textContent);
      btn.textContent = '已复制，去地址栏粘贴';
    } catch {
      getSelection().selectAllChildren(code);
      btn.textContent = '请按 Ctrl+C 复制';
    }
    setTimeout(() => (btn.textContent = '复制地址'), 3000);
  });
})();
