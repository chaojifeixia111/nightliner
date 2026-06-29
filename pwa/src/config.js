// pwa/src/config.js
// 拆开部署 + 访问鉴权的集中处:
// - VITE_API_BASE 设了(Vercel 拆开 build)→ /api 与 ws 改指向外部后端;没设 → 同源相对路径。
// - 本地存的访问口令(密码门)自动带到每个 /api 请求和 ws 连接上;后端设了 AUTH_TOKEN
//   才校验,没设则放行(本地开发零摩擦)。401 时派发事件,由 App 弹出密码门。
// /api 用一个 fetch 垫片统一处理(改写地址 + 带口令 + 401 派发),避免去改散落在
// 各组件里的 ~20 处 fetch 调用。只动以 /api 开头的字符串 URL,其它请求原样放行。

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
const TOKEN_KEY = 'nl_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(v) {
  try { localStorage.setItem(TOKEN_KEY, v); } catch { /* 隐私模式等:存不了就算了 */ }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  if (typeof input !== 'string' || !input.startsWith('/api')) {
    return nativeFetch(input, init);
  }
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return nativeFetch(API_BASE + input, { ...init, headers }).then((resp) => {
    if (resp.status === 401) window.dispatchEvent(new Event('nl-auth-required'));
    return resp;
  });
};

// ws 地址:同源 / 外部后端二选一,带上访问口令(后端在 connection 时校验)。
export function wsUrl() {
  const base = API_BASE
    ? API_BASE.replace(/^http/, 'ws') + '/stream'
    : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream`;
  const token = getToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
