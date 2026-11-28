// 顶栏的小下拉菜单（主题、语言共用同一种）：一个按钮显示当前值，点开是单选菜单。
// 扩展页面和官网共用（官网构建时复制）。普通脚本，挂在 globalThis.mtMenu 上，扩展的模块脚本和官网的普通脚本都能用。
// mtMenu(slot, o)：
//   o.items  [{ v, text: () => 文字, icon?: svg 字符串 }]
//   o.get()  当前值；o.btn(v) 按钮里的 HTML；o.title(v) 按钮提示；o.label() 菜单名；o.pick(v) 选了新值
// 返回 { paint }，语言切换后调用 paint() 刷新文字。
globalThis.mtMenu = (slot, o) => {
  slot.innerHTML = '<span class="dd"><button type="button" class="dd-btn" aria-haspopup="menu" aria-expanded="false"></button><span class="menu" role="menu" hidden></span></span>';
  const wrap = slot.firstChild;
  const btn = wrap.firstChild;
  const menu = wrap.lastChild;
  menu.innerHTML = o.items.map((it) => `<button type="button" role="menuitemradio" data-v="${it.v}">${it.icon || ''}<span></span></button>`).join('');
  const items = [...menu.children];
  const paint = () => {
    const cur = o.get();
    btn.innerHTML = o.btn(cur);
    btn.title = o.title(cur);
    btn.setAttribute('aria-label', btn.title);
    menu.setAttribute('aria-label', o.label());
    items.forEach((el, i) => {
      el.lastChild.textContent = o.items[i].text();
      el.setAttribute('aria-checked', el.dataset.v === cur);
    });
  };
  const open = (yes, focus) => {
    menu.hidden = !yes;
    btn.setAttribute('aria-expanded', yes);
    if (yes && focus) (items.find((el) => el.getAttribute('aria-checked') === 'true') || items[0]).focus();
  };
  btn.addEventListener('click', () => open(menu.hidden, true));
  items.forEach((el, i) => {
    el.addEventListener('click', () => {
      open(false);
      btn.focus();
      if (el.dataset.v !== o.get()) o.pick(el.dataset.v);
      paint();
    });
    el.addEventListener('keydown', (e) => {
      const k = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (k) {
        e.preventDefault();
        items[(i + k + items.length) % items.length].focus();
      }
    });
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) open(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      open(false);
      btn.focus();
    }
  });
  paint();
  return { paint };
};
