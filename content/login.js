// mituan 投稿追踪 · 页面脚本（运行在各平台的网页里）
// 1. 工作窗口（扩展自己打开的最小化窗口）：自动填表登录，上报页面，代发同源请求。
// 2. 你自己的标签页：你手动登录时记下账号（可在追踪面板的设置页关闭）；ScholarOne 页面上顺手记下表单令牌。
// 账号密码只有在后台确认"这是扩展开的工作窗口、域名匹配"之后才会下发到这里。

(() => {
  // 安装或更新扩展时会补注入到已打开的标签页：已有一份还活着就不重复运行。
  // 扩展重新加载后旧的那份失效（chrome.runtime.id 变成 undefined），这时要让新的接手。
  const prev = window.__submissionTracker;
  if (window.top !== window || (typeof prev === 'function' && prev())) return;
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  alive.startedAt = Date.now();
  window.__submissionTracker = alive;
  const host = location.hostname;
  const platform =
    host === 'mc.manuscriptcentral.com' ? 'scholarone'
    : host === 'www.ieee.org' || host === 'services10.ieee.org' ? 'ieee'
    : host === 'ieee.submission.researchexchange.com' ? 'rex'
    : host === 'ifac-sms.org' ? 'paperplaza'
    : host === 'cms.amss.ac.cn' ? 'tcct'
    : null;
  if (!platform) return;

  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
  const $ = (sel) => document.querySelector(sel);
  const textOf = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  let role = 'normal';

  // ───────── 代发同源请求（仅工作窗口） ─────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'tracker:fetch' || sender.id !== chrome.runtime.id || role !== 'worker') return false;
    const url = new URL(msg.url, location.href);
    if (url.origin !== location.origin) {
      sendResponse({ ok: false, error: '只代发同源请求' });
      return false;
    }
    const headers = { ...(msg.headers || {}) };
    if (msg.body) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    fetch(url.href, { method: msg.method || 'GET', body: msg.body, headers, credentials: 'include', cache: 'no-store' })
      .then(async (r) => sendResponse({ ok: true, res: { url: r.url, status: r.status, ok: r.ok, contentType: r.headers.get('content-type') || '', text: await r.text() } }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });

  // ───────── 工具 ─────────
  function setValue(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function formPairs(form) {
    const pairs = [];
    for (const el of form?.elements || []) {
      const name = el.getAttribute('name');
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (!name || ['button', 'submit', 'image', 'reset', 'file'].includes(type) || el.tagName === 'BUTTON') continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      if (type === 'password') continue;
      pairs.push([name, el.value ?? '']);
    }
    return pairs;
  }

  function s1Info() {
    const authorHref = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href') || '').find((h) => /AUTHOR_VIEW_MANUSCRIPTS/.test(h));
    const roleId = authorHref ? /'XIK_CUR_ROLE_ID'\s*,\s*'([^']+)'/.exec(authorHref)?.[1] : null;
    const kind = $('input[name=USERID]') && $('input[type=password]') ? 'login' : $('#authorDashboardQueue') ? 'dashboard' : roleId ? 'menu' : 'other';
    return { kind, roleId, site: location.pathname.split('/')[1] || '' };
  }

  // ───────── 工作窗口：自动登录 ─────────
  async function workerScholarOne(info) {
    const s1 = s1Info();
    if (s1.kind === 'menu' || s1.kind === 'dashboard') {
      await send({ type: 'tracker:page', page: { kind: s1.kind, url: location.href, html: document.documentElement.outerHTML } });
      return;
    }
    await send({ type: 'tracker:page', page: { kind: s1.kind, url: location.href } });
    if (s1.kind !== 'login' || !info.username) return;
    const err = textOf($('#notificationDiv .alert-error, #notificationDiv .alert-danger'));
    const ok = await send({ type: 'tracker:attempt', error: err || undefined });
    if (!ok?.ok) return;
    setValue($('input[name=USERID]'), info.username);
    setValue($('input[name=PASSWORD]'), info.password);
    setTimeout(() => $('#logInButton')?.click(), 400);
  }

  async function workerIeee(info) {
    await send({ type: 'tracker:page', page: { kind: 'other', url: location.href } });
    // ieee.org 的注册页：先切到登录
    const signinLink = $('a.ca-signin-link');
    if (signinLink && !sessionStorage.getItem('tracker-signin-clicked')) {
      sessionStorage.setItem('tracker-signin-clicked', '1');
      signinLink.click();
      return;
    }
    const user = $('input[name="pf.username"], #username');
    const pass = $('input[name="pf.pass"], #password');
    if (!user || !pass || !info.username) return;
    const errEl = [...document.querySelectorAll('.error, .alert, [class*=error], [id*=error]')].find((e) => e.offsetParent && /incorrect|invalid|failed|not recogni|locked/i.test(textOf(e)));
    const ok = await send({ type: 'tracker:attempt', error: errEl ? textOf(errEl).slice(0, 160) : undefined });
    if (!ok?.ok) return;
    setValue(user, info.username);
    setValue(pass, info.password);
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      const label = textOf(cb.closest('label') || cb.parentElement) + cb.name + cb.id;
      if (/remember|keep me|stay signed/i.test(label) && !cb.checked) cb.click();
    }
    setTimeout(() => {
      const btn = $('#modalWindowRegisterSignInBtn, #sign_in_submit [type=submit], form [type=submit]');
      if (btn) btn.click();
      else (user.form || $('form'))?.submit();
    }, 400);
  }

  // ───────── 你自己的标签页：记下手动登录的账号 ─────────
  function captureOn(getValues, { clickSelector, formSelector, keySelector }) {
    let sent = false;
    const fire = () => {
      if (sent) return;
      const v = getValues();
      if (!v || !v.username || !v.password) return;
      sent = true;
      send({ type: 'tracker:capture', platform: v.platform || platform, site: v.site, username: v.username, password: v.password });
      setTimeout(() => (sent = false), 3000);
    };
    if (clickSelector)
      document.addEventListener('click', (e) => {
        if (e.target.closest?.(clickSelector)) fire();
      }, true);
    if (formSelector)
      document.addEventListener('submit', (e) => {
        if (e.target.matches?.(formSelector)) fire();
      }, true);
    if (keySelector)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches?.(keySelector)) fire();
      }, true);
  }

  function setupCapture() {
    if (platform === 'scholarone') {
      captureOn(() => ({ username: $('input[name=USERID]')?.value.trim(), password: $('input[name=PASSWORD]')?.value, site: location.pathname.split('/')[1] }), {
        clickSelector: '#logInButton',
        keySelector: 'input[name=USERID], input[name=PASSWORD]',
      });
    } else if (platform === 'paperplaza') {
      captureOn(() => ({ username: $('input[name=LoginId]')?.value.trim(), password: $('input[name=Password]')?.value }), {
        clickSelector: 'a[href*="command(\'Login\')"], input[name=Submit]',
        formSelector: 'form[name=login]',
        keySelector: 'input[name=LoginId], input[name=Password]',
      });
    } else if (platform === 'tcct') {
      captureOn(() => ({ username: $('#input_user')?.value, password: $('#input_pswd')?.value }), {
        clickSelector: '#login',
        keySelector: '#input_user, #input_pswd, #input_captcha',
      });
    } else if (platform === 'ieee') {
      captureOn(() => ({ username: $('input[name="pf.username"]')?.value.trim(), password: $('input[name="pf.pass"]')?.value }), {
        clickSelector: '#modalWindowRegisterSignInBtn',
        formSelector: '#sign_in_submit',
        keySelector: 'input[name="pf.username"], input[name="pf.pass"]',
      });
    }
  }

  // ───────── 启动 ─────────
  const loginForm = [...document.querySelectorAll('input[type=password]')].some((el) => el.offsetParent || el.getClientRects().length);
  // 登录失败后的错误页（PaperPlaza 是一个没有密码框的 "Error message" 页），不能当成登录成功
  const loginError =
    /^\s*error/i.test(document.title) ||
    /login information is incorrect|incorrect (user|password|pin)|invalid (user ?id|password|login)|密码错误|用户名或密码/i.test((document.body?.textContent || '').slice(0, 20000));
  send({ type: 'tracker:hello', url: location.href, loginForm, loginError }).then((info) => {
    if (!info) return;
    role = info.role;
    if (role === 'worker') {
      if (platform === 'scholarone') workerScholarOne(info);
      else if (platform === 'ieee' || platform === 'rex') workerIeee(info);
      return;
    }
    if (info.capture) setupCapture();
    if (platform === 'scholarone') {
      const s1 = s1Info();
      if ((s1.kind === 'menu' || s1.kind === 'dashboard') && s1.roleId && s1.site) {
        send({ type: 'tracker:s1tokens', site: s1.site, roleId: s1.roleId, pairs: formPairs(document.forms[0]) });
      }
    }
  });
})();
