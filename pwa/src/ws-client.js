// pwa/src/ws-client.js
// 简单 WS 客户端
let socket = null;

export function connectWs(onMessage) {
  const url = `ws://${location.host}/stream`;
  socket = new WebSocket(url);
  socket.onopen = () => onMessage({ type: 'connected' });
  socket.onmessage = (ev) => {
    try { onMessage(JSON.parse(ev.data)); }
    catch (e) { console.error('WS parse error', e, ev.data); }
  };
  socket.onclose = () => console.log('WS closed');
  return socket;
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
