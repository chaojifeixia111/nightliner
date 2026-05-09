// scripts/ncm-login-qr.js
// 命令行扫码登录:生成二维码图片文件,用户扫码后保存 cookie
import fs from 'fs/promises';
import { loginQrKey, loginQrCreate, loginQrCheck, saveCookie } from '../server/ncm-client.js';

async function main() {
  console.log('1. 申请 unikey...');
  const keyResp = await loginQrKey();
  const unikey = keyResp.data.unikey;
  console.log('   unikey:', unikey);

  console.log('2. 生成二维码...');
  const qrResp = await loginQrCreate(unikey);
  const qrBase64 = qrResp.data.qrimg;  // data:image/png;base64,...

  // 把二维码写到本地图片文件,用户扫码
  const base64Data = qrBase64.replace(/^data:image\/png;base64,/, '');
  await fs.writeFile('data/netease-qr.png', Buffer.from(base64Data, 'base64'));
  console.log('   二维码已保存到: data/netease-qr.png');
  console.log('   请用网易云手机 App 扫码(右上角"我的" → 扫一扫)');

  console.log('3. 轮询登录状态...');
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    const check = await loginQrCheck(unikey);
    // code: 800 过期 / 801 等待 / 802 已扫 / 803 成功
    if (check.code === 800) {
      console.log('   ❌ 二维码过期,请重跑脚本');
      process.exit(1);
    }
    if (check.code === 801) {
      process.stdout.write('.');
      continue;
    }
    if (check.code === 802) {
      console.log('\n   ✓ 已扫码,等待手机端确认...');
      continue;
    }
    if (check.code === 803) {
      console.log('\n   ✓ 登录成功');
      const cookie = check.cookie;
      await saveCookie(cookie);
      console.log('   cookie 已写入 data/netease-cookie.txt');
      // 删二维码图,留 cookie
      await fs.unlink('data/netease-qr.png').catch(() => {});
      return;
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
