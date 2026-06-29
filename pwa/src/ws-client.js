// pwa/src/ws-client.js
// WS 客户端:断线自动重连(指数退避),并把连接/断开如实汇报给上层,
// 避免后端重启或网络抖动后 socket 静默死掉、app 卡在"已连接"却收不到任何更新。
import { wsUrl } from './config.js';

let socket = null;
let reconnectTimer = null;
let backoff = 1000;
const MAX_BACKOFF = 15000;
let manualClose = false;

export function connectWs(onMessage) {
  manualClose = false;

  const open = () => {
    socket = new WebSocket(wsUrl());

    socket.onopen = () => {
      backoff = 1000;                       // 连上即重置退避
      onMessage({ type: 'connected' });
    };
    socket.onmessage = (ev) => {
      try { onMessage(JSON.parse(ev.data)); }
      catch (e) { console.error('WS parse error', e, ev.data); }
    };
    socket.onclose = (ev) => {
      onMessage({ type: 'disconnected' });  // 让上层把 connected 置 false(masthead 报 OFFLINE)
      if (manualClose) return;              // 组件卸载导致的关闭:不再重连
      if (ev.code === 4001) {               // 后端拒绝:口令缺失/错误 → 弹密码门,别再重连风暴
        window.dispatchEvent(new Event('nl-auth-required'));
        return;
      }
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

// 手动点播/排队(DAILY / SEARCH 整版页);mode: 'now' | 'queue'。返回 { ok, song?, reason? }。
export function playSong(song, mode) {
  return fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: song.name, artist: song.artist, ncm_id: song.ncm_id, mode }),
  }).then(r => r.json());
}
