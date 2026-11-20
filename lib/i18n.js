// 界面语言：zh / en。偏好 auto（默认，跟随浏览器界面语言，它默认随系统）/ zh / en，
// 存在 settings.lang（后台用）和扩展页面的 localStorage mt-lang（ui/theme.js 在绘制前读取）。
//   L(中文, English)  按当前语言取一个，用于马上显示的文字
//   B(中文, English)  两种都存成一个字符串，用于存下来以后再显示的消息（平台状态、错误）
//   loc(s)            显示 B() 存的消息时取当前语言；普通字符串原样返回
//   pair(s) / mapB(s, fn)  拆开或分别加工 B() 的两半（给已有消息加前缀、拼接多条消息）
const SEP = '␞';
let lang = 'en';

export function systemLang() {
  const c = globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en';
  return /^zh/i.test(c) ? 'zh' : 'en';
}
export const resolveLang = (pref) => (pref === 'zh' || pref === 'en' ? pref : systemLang());
export const setLang = (l) => {
  lang = l === 'zh' ? 'zh' : 'en';
};
export const getLang = () => lang;
export const L = (zh, en) => (lang === 'zh' ? zh : en);
export const B = (zh, en) => `${zh}${SEP}${en}`;
export function loc(s) {
  if (typeof s !== 'string' || !s.includes(SEP)) return s;
  const [zh, en] = s.split(SEP);
  return lang === 'zh' ? zh : en;
}
/** B() 字符串的两半 [中文, English]；普通字符串两种语言相同。 */
export function pair(s) {
  const t = String(s ?? '');
  const i = t.indexOf(SEP);
  return i < 0 ? [t, t] : [t.slice(0, i), t.slice(i + SEP.length)];
}
/** 给（可能是 B() 的）消息加前缀等加工，结果仍是 B()：mapB(msg, (text, lang) => …)。避免 B() 套 B()。 */
export const mapB = (s, fn) => {
  const [zh, en] = pair(s);
  return B(fn(zh, 'zh'), fn(en, 'en'));
};
/** 「前缀：消息」，两种语言各用各的冒号。 */
export const prefixB = (prefix, s) => mapB(s, (t, l) => `${prefix}${l === 'zh' ? '：' : ': '}${t}`);

// 扩展页面：与 theme.js 在绘制前算好的语言保持一致
const pre = globalThis.document?.documentElement?.dataset?.lang;
if (pre) setLang(pre);
else setLang(systemLang());
