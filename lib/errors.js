// 适配器抛出的错误类型。code 会写进平台状态，界面据此显示提示。

export class TrackerError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/** 还没有该平台的账号。 */
export const needCredential = (msg = '还没有填写账号') => new TrackerError('need-credential', msg);

/** 平台明确拒绝了账号或密码。之后不再自动重试，避免锁号或触发验证码。 */
export const authRejected = (msg = '账号或密码被拒绝') => new TrackerError('auth-rejected', msg);

/** 需要人处理（验证码、两步验证、需要点击的人机验证）。 */
export const needHuman = (msg, extra) => new TrackerError('need-human', msg, extra);

/** 后台请求被 Cloudflare / WAF 拦下，需要改用真实页面。 */
export const blocked = (msg = '后台请求被拦截') => new TrackerError('blocked', msg);

/** 页面结构和预期不符，多半是平台改版。 */
export const parseError = (msg) => new TrackerError('parse-error', msg);
