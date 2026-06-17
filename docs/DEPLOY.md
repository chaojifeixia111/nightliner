# 部署手册 · 家用常驻 Windows 主机 + Tailscale 私网

> 目标：把 Nightliner 从「localhost 手动开三个进程」变成「家里一台旧笔记本 7×24 挂着，你在外面用手机经私网随时听」。
> 适用场景：**单一用户（你自己）远程访问**，不对外公开。

---

## 0. 为什么是这套方案（而不是 Vercel + Railway）

三条硬约束决定了必须**自托管在国内住宅 IP**，不能上海外云：

1. **网易云 region-lock**：直链解析按 IP 区域鉴权。Railway/Vercel 在海外机房，从海外机房 IP 解析会大概率拿到 cover-only / 解析失败（你的 memory 里也记了 region 是真实失败模式）。**住宅 IP 最稳。**
2. **凭证隐私**：`data/netease-cookie.txt` 是你的网易云 VIP 登录态，`data/` 还有播放历史和收藏。公网部署 = 凭证落到第三方主机、任何人都能驱动你的 DJ。本项目没有登录层。
3. **后端形态**：长驻 Express + WebSocket + 原生模块（better-sqlite3 / sqlite-vec）+ 进程内 ONNX embedder（BGE-M3），需要常驻进程和持久磁盘——不是 serverless 形态，Vercel 跑不了。

### 音频是怎么出来的（决定了家里上行不是瓶颈）

两步、两个不同网络：

- **解析**（在主机上，用你的 cookie）：后端 + NCM API 选歌、跑 DJ、向网易云要一条 CDN 直链。走**主机 IP**。
- **下载音频**（在手机上，直连 CDN）：后端把直链塞进歌曲对象发给前端，手机 `<audio>` **直接从网易云 CDN 拉音频**，走**手机自己的 4G/5G**。

> 音频字节**不经过你家的笔记本中转**。主机只处理很轻的控制/解析流量，所以哪怕是台弱机也扛得住。

---

## 1. 工具清单

| 工具 | 作用 | 装在哪 |
|---|---|---|
| **Node.js 20+** | 跑后端 + 重建原生模块 | 笔记本 |
| **Git** | 拉代码 | 笔记本 |
| **NeteaseCloudMusicApi** | 网易云 API 网关（:3000） | 笔记本（建议装成项目本地依赖） |
| **PM2** | 进程管理：开机自启 + 崩溃自重启 + 统一日志 | 笔记本（全局） |
| **pm2-installer** | 把 PM2 注册成 Windows 服务（重启后自恢复） | 笔记本 |
| **Tailscale** | 私网 + HTTPS 暴露，PWA 才能装 | 笔记本 **和** 手机 |
| **DeepSeek API key** | LLM（已有） | `.env` |

---

## 2. 主机准备（电源 / 网络）

旧笔记本第一件事是**别让它睡**，否则你出门它一休眠就连不上：

- 控制面板 → 电源选项 → 选定计划「更改计划设置」→ **关闭显示器：从不**、**使计算机进入睡眠状态：从不**（接通电源时）。
- 控制面板 → 电源选项 → **选择关闭笔记本盖的功能 → 接通电源时：不采取任何操作**（合盖继续跑）。
- 建议接着电源常亮；放在通风处。
- （可选）把 Windows 自动更新的「活动时间」设宽，避免半夜重启——重启没关系（PM2 服务会自恢复），但更新卡在「请勿关机」会断服务。

---

## 3. 一次性安装（在笔记本上，PowerShell）

### 3.1 装 Node 20 + Git
官网装 Node 20 LTS 和 Git。验证：

```powershell
node -v   # 应 >= v20
git --version
```

### 3.2 拉代码
```powershell
cd C:\
git clone https://github.com/chaojifeixia111/nightliner.git
cd nightliner
```

### 3.3 装依赖（会重建原生模块）
```powershell
npm install
npm install NeteaseCloudMusicApi   # 装成本地依赖，给 PM2 包装脚本用（见 4.3）
```

> 若 better-sqlite3 / onnxruntime 编译报错：装一遍 VS Build Tools（C++）后重试 `npm install`。

### 3.4 配 `.env`
项目根目录新建 `.env`（**不进版本控制**）：

```dotenv
DEEPSEEK_API_KEY=sk-你的key
# BGE-M3 模型缓存目录（首次会下载约几百 MB，放空间够的盘）
HF_CACHE_DIR=C:\nightliner-models
# 国内下载走镜像，更快
HF_ENDPOINT=https://hf-mirror.com
```

### 3.5 验证 NeteaseCloudMusicApi 能起
```powershell
$env:HOST="127.0.0.1"; $env:PORT="3000"; npx NeteaseCloudMusicApi
```
浏览器开 `http://127.0.0.1:3000` 看到欢迎页即可。Ctrl+C 停掉（后面交给 PM2）。

### 3.6 扫码登录，生成 cookie
```powershell
npm run ncm:login
```
按提示用网易云手机 App 扫 `data/netease-qr.png`，终端显示「登录成功」后 `data/netease-cookie.txt` 出现。

### 3.7 预热 BGE-M3（首次下载模型）
```powershell
npm run test:embed
```
首次会从 hf-mirror 下载模型到 `HF_CACHE_DIR`，之后启动只需约 3 秒预热。

### 3.8 构建前端
```powershell
npm --prefix pwa run build   # → pwa/dist，由后端静态托管
```

### 3.9 本机自测一轮
先临时手动起两个进程各开一个窗口：
```powershell
# 窗口 A
$env:HOST="127.0.0.1"; $env:PORT="3000"; npx NeteaseCloudMusicApi
# 窗口 B
npm start
```
浏览器开 `http://127.0.0.1:8080`，跟 DJ 说句话，确认**能出歌、能播放**。通了再往下做常驻。两个窗口 Ctrl+C 停掉。

---

## 4. 迁移前要合入仓库的代码改动（3 处）

这三处是「从 localhost 走向 https 私网」必须的代码层改动。**建议在你的开发机上改好、commit、push，再到笔记本 `git pull`**，这样笔记本 clone 下来就是 deploy-ready 的。（也可以让 Claude 直接帮你落这三个文件。）

### 4.1 前端 WebSocket 改 `wss`（必须）
`pwa/src/ws-client.js` 第 14 行，页面走 https 时浏览器会拦掉明文 `ws://`（混合内容），改成按协议自适应：

```diff
- socket = new WebSocket(`ws://${location.host}/stream`);
+ const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws';
+ socket = new WebSocket(`${wsScheme}://${location.host}/stream`);
```
改完记得重新 `npm --prefix pwa run build`。

### 4.2 PM2 进程配置 `ecosystem.config.cjs`（新增，放项目根）
```js
// ecosystem.config.cjs — PM2 同时托管 NCM API 和后端
module.exports = {
  apps: [
    {
      name: 'ncm-api',
      script: 'scripts/ncm-api.cjs',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'nightliner',
      script: 'server/index.js',
      cwd: __dirname,
      node_args: '--env-file=.env',   // 复刻 `npm start` 的 --env-file
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
```

### 4.3 NCM API 的 PM2 入口 `scripts/ncm-api.cjs`（新增）
PM2 需要一个 JS 入口来拉起 NeteaseCloudMusicApi（用它的编程式 API）：
```js
// scripts/ncm-api.cjs — 给 PM2 用的 NCM API 启动入口
const { serveNcmApi } = require('NeteaseCloudMusicApi');
serveNcmApi({ host: '127.0.0.1', port: 3000 });
```
> 若该版本导出名不是 `serveNcmApi`，看 `node_modules/NeteaseCloudMusicApi/README.md` 的「调用 / programmatic」一节确认导出名再改这一行。

---

## 5. 进程常驻（PM2 + Windows 服务）

### 5.1 全局装 PM2
```powershell
npm install -g pm2
```

### 5.2 起服务并保存进程表
```powershell
cd C:\nightliner
pm2 start ecosystem.config.cjs
pm2 status        # 两个都应是 online
pm2 logs          # 看日志，确认 BGE-M3 预热完成、NCM API 起来
pm2 save          # 固化当前进程表，重启后由服务恢复
```

### 5.3 注册成 Windows 服务（开机自启）
PM2 原生 `pm2 startup` 在 Windows 上不可靠，用 **pm2-installer**（把 PM2 跑成 Windows 服务，开机执行 `pm2 resurrect` 恢复 5.2 保存的进程表）：

1. 下载 https://github.com/jessety/pm2-installer （Code → Download ZIP，解压）。
2. 在解压目录按其 README 当前版本执行（典型为）：
   ```powershell
   npm run setup        # 安装为服务并配置开机自启
   npm run configure    # 配置环境（按提示）
   ```
3. 重启笔记本验证：开机后**不登录、不开任何窗口**，等一两分钟，从开发机 `pm2 status`（或本机）应看到两个进程自动 online。

> 备选方案：若 pm2-installer 不顺，用 **NSSM** 把「`pm2 resurrect`」包成一个开机自启服务，效果相同。

---

## 6. Tailscale 私网 + HTTPS

### 6.1 装 + 登录（笔记本和手机用同一账号）
- 笔记本：装 Tailscale Windows 客户端，登录，`tailscale up`。
- 手机：装 Tailscale App，**登录同一账号**。
- 在 Tailscale 管理后台（login.tailscale.com）确认 **MagicDNS** 已开、**HTTPS Certificates** 已开（Settings → 打开开关）。

记下笔记本的 MagicDNS 名，形如 `your-laptop.tailXXXX.ts.net`。

### 6.2 用 `tailscale serve` 反代后端并上 HTTPS
在笔记本上（管理员 PowerShell）：
```powershell
tailscale serve --bg 8080
tailscale serve status   # 看到 https://your-laptop.tailXXXX.ts.net -> http://127.0.0.1:8080
```
> `tailscale serve` 语法随版本略有差异；若上面不认，试 `tailscale serve --bg http://127.0.0.1:8080`，或 `tailscale serve --help` 看当前语法。它会自带合法证书并代理 WebSocket（`/stream` 的 wss 因此能通）。
> **不要用 `tailscale funnel`**——那是把服务暴露到公网，破坏私网边界。

### 6.3 手机安装 PWA
手机连着 Tailscale，浏览器开 `https://your-laptop.tailXXXX.ts.net`：
- iOS Safari：分享 → 添加到主屏幕。
- Android Chrome：菜单 → 安装应用 / 添加到主屏幕。

装好后从主屏图标进入，就是全屏 App 体验。

---

## 7. 上线后必测清单（手机实测）

- [ ] 经 ts.net 域名能打开、能跟 DJ 对话、**能出歌并播放**
- [ ] WebSocket 连上（队列/DJ 消息实时更新，不报混合内容错误）
- [ ] **锁屏 / 切后台音频是否继续**（见 §9 已知风险）
- [ ] 连续播放 20+ 分钟，跨直链过期点不断（`/api/resolve` 续播是否生效）
- [ ] 切到 4G（关 WiFi）仍能听

---

## 8. 日常运维

| 操作 | 命令 |
|---|---|
| 看状态 / 日志 | `pm2 status` / `pm2 logs` |
| 重启服务 | `pm2 restart all` |
| 更新代码 | `git pull` → `npm install` → `npm --prefix pwa run build` → `pm2 restart all` |
| cookie 过期重登 | `npm run ncm:login` 扫码（**目前需回家在主机上做**，见 §9） |
| 重建 RAG 索引 | `npm run index:all` |

---

## 9. 已知风险与边界（诚实标注，别假装已解决）

- ⚠️ **手机锁屏 / 后台音频**：PWA 在 iOS/Android 锁屏或切后台时可能暂停，需要 MediaSession 等支撑。**这是上线后第一件要在手机上实测的事**；若不行，是一个独立的前端任务。
- ⚠️ **cookie 过期的远程重登**：人在外面时若 cookie 失效，没法远程扫码。v1 先接受「回家在主机上 `npm run ncm:login`」；以后可加一个 Tailscale 私网内的管理页显示二维码。
- ⚠️ **笔记本断电 / 断网 / 系统更新重启**：PM2 服务会在开机后自恢复，但断网期间不可用。Tailscale 会自动重连。
- 🔒 **边界**：后端只听 `127.0.0.1`（[server/index.js:745](../server/index.js#L745)），仅本机的 `tailscale serve` 能转发；不开任何公网端口、不开 funnel。凭证和数据不出这台笔记本。

---

## 附：故障排查

| 现象 | 排查 |
|---|---|
| 页面打开但 WS 连不上 / 控制台报 mixed content | §4.1 的 `wss` 改动没生效，或前端没重新 `build` |
| 能聊但出不了歌 | NCM API 没起（`pm2 logs ncm-api`）/ cookie 过期（重登）/ 该歌 region 或下架（换歌验证） |
| 手机加不了主屏 / PWA 不可装 | 必须是 **https**——确认走的是 ts.net 域名而非 IP，且 Tailscale HTTPS Certificates 已开 |
| 重启后服务没自动起 | §5.2 漏了 `pm2 save`，或 §5.3 服务没装成功 |
| 启动慢/卡在预热 | 首次下模型，看 `pm2 logs nightliner`；确认 `HF_CACHE_DIR` 有模型文件 |
