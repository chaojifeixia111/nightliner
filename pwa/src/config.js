// pwa/src/config.js
// 拆开部署支持:前端在 Vercel、后端在别处(家里隧道)时,用 VITE_API_BASE 指向后端。
//
// 设了 VITE_API_BASE(仅 Vercel 拆开部署的 build 才设)→ 所有 /api 请求和 ws 连接
// 改指向那个后端地址;没设(本地 dev / 后端自托管前端)→ 一切走同源相对路径,行为不变。
//
// /api 用一个 fetch 垫片统一改写,避免去改散落在各组件里的 ~20 处 fetch 调用。
// 垫片只在 VITE_API_BASE 存在时安装,且只动以 /api 开头的字符串 URL,其它请求原样放行。

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

if (API_BASE) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return nativeFetch(API_BASE + input, init);
    }
    return nativeFetch(input, init);
  };
}

// ws 地址:有 API_BASE 就把它的 http(s) 换成 ws(s) 再接 /stream;
// 否则按当前页面协议同源连接(https 页面必须用 wss,否则浏览器拦混合内容)。
export function wsUrl() {
  if (API_BASE) {
    return API_BASE.replace(/^http/, 'ws') + '/stream';
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/stream`;
}
