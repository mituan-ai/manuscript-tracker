// 隐私政策页：顶栏的主题和语言切换在 controls.js（与首页共用），这里只按语言换页面标题。
(() => {
  const TITLE = { zh: '隐私政策 · mituan 投稿追踪', en: 'Privacy Policy · mituan Manuscript Tracker' };
  const apply = () => { document.title = TITLE[document.documentElement.dataset.lang] || TITLE.en; };
  document.addEventListener('langchange', apply);
  apply();
})();
