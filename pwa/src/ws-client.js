// pwa/src/ws-client.js
// WS 客户端:断线自动重连(指数退避),并把连接/断开如实汇报给上层,
// 避免后端重启或网络抖动后 socket 静默死掉、app 卡在"已连接"却收不到任何更新。
let socket = null;
let reconnectTimer = null;
let backoff = 1000;
const MAX_BACKOFF = 15000;
let manualClose = false;

export function connectWs(onMessage) {
  manualClose = false;

  const open = () => {
    socket = new WebSocket(`ws://${location.host}/stream`);

    socket.onopen = () => {
      backoff = 1000;                       // 连上即重置退避
      onMessage({ type: 'connected' });
    };
    socket.onmessage = (ev) => {
      try { onMessage(JSON.parse(ev.data)); }
      catch (e) { console.error('WS parse error', e, ev.data); }
    };
    socket.onclose = () => {
      onMessage({ type: 'disconnected' });  // 让上层把 connected 置 false(masthead 报 OFFLINE)
      if (manualClose) return;              // 组件卸载导致的关闭:不再重连
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 1.5, MAX_BACKOFF);
    };
    socket.onerror = () => {
      try { socket.close(); } catch {}      // 触发 onclose → 走重连
    };
  };

  open();

  // 返回带 close() 的句柄(App.vue onUnmounted 调用):停止重连并关闭
  return {
    close() {
      manualClose = true;
      clearTimeout(reconnectTimer);
      try { socket && socket.close(); } catch {}
    },
  };
}

export function sendChat(text) {
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  });
}

export function sendFeedback(fb) {
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fb),
  });
}
