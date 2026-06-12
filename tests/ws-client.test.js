import { test } from 'node:test';
import assert from 'node:assert/strict';

// 最小浏览器环境替身:可控的 WebSocket + location
class MockWS {
  constructor(url) { this.url = url; MockWS.instances.push(this); this.readyState = 0; }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  _open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  static reset() { MockWS.instances = []; }
}
MockWS.instances = [];
globalThis.location = { host: 'test.local' };
globalThis.WebSocket = MockWS;

const { connectWs } = await import('../pwa/src/ws-client.js');

test('断线后自动重连(新建 socket),并向上层汇报 disconnected', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  MockWS.reset();
  const events = [];
  connectWs((m) => events.push(m.type));
  assert.equal(MockWS.instances.length, 1);

  MockWS.instances[0]._open();
  assert.ok(events.includes('connected'), '连上应汇报 connected');

  MockWS.instances[0].onclose();                 // 模拟掉线
  assert.ok(events.includes('disconnected'), '掉线应汇报 disconnected');

  t.mock.timers.tick(1000);                       // 推进退避计时器
  assert.equal(MockWS.instances.length, 2, '应自动重连、新建 socket');
});

test('手动 close() 后不再重连', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  MockWS.reset();
  const handle = connectWs(() => {});
  MockWS.instances[0]._open();
  handle.close();                                 // 组件卸载式关闭
  t.mock.timers.tick(20000);
  assert.equal(MockWS.instances.length, 1, '手动关闭不应触发重连');
});
