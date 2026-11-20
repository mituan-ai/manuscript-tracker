// 运行日志：保存在本机，最多 300 条。不要把账号、密码、令牌写进日志。

const MAX = 300;
let chain = Promise.resolve();

export function log(source, msg, level = 'info') {
  const entry = { at: Date.now(), source, level, msg: String(msg).slice(0, 500) };
  (level === 'error' ? console.warn : console.log)(`[${source}] ${entry.msg}`);
  chain = chain
    .then(async () => {
      const { logs = [] } = await chrome.storage.local.get('logs');
      logs.push(entry);
      if (logs.length > MAX) logs.splice(0, logs.length - MAX);
      await chrome.storage.local.set({ logs });
    })
    .catch(() => {});
  return chain;
}
