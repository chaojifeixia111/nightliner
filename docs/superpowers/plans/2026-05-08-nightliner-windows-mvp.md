# Nightliner Windows MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 上 5-7 个工作日,从零搭建一个能在浏览器聊天 + 听网易云直链的私人音乐 Agent PWA(Nightliner v0.4),所有代码 100% 可迁移到 Mac。

**Architecture:** 四层简化版(UI / Node 后端 / 协调器 + 信号 / 数据源)。主播放器 = PWA 内嵌 `<audio>` + 网易云直链。Claude 通过 `claude -p` 子进程调用(Max 订阅免 API key)。SQLite 存状态,JSONL 存 LLM 调用日志。

**Tech Stack:** Node.js 20+ / Express / ws / better-sqlite3 / yaml / Vue 3 / Vite / NeteaseCloudMusicApi(社区项目,Docker 部署)/ claude CLI / PowerShell(HTML 解析脚本)

**测试方针**:v0.3 §11.5 明确不写测试,**本 plan 不使用 TDD**。每个 task 末尾用"运行命令 + 期望输出"做手动验证。

**用户语料状态(M1 大部分已就绪)**:
- ✅ `user/dj-persona.md`(Elliot + companion + 草稿口播)
- ✅ `user/mood-rules.md`(空模板)
- ✅ `user/playlists.json`(3 个种子歌单)
- ✅ `user/apple-music-favorites-2024-2026.md`(完整 100 首)
- ⏳ `user/taste.md`(M-init 生成)
- ⏳ `user/life-stages.md`(M-init 生成)

---

## 文件结构(实施完成后)

```
nightliner/                              (即当前工作目录)
├── server/
│   ├── index.js                         # Express + WS 主入口
│   ├── router.js                        # 意图分流
│   ├── context-builder.js               # 6 片 prompt 拼装
│   ├── claude-adapter.js                # claude -p 子进程
│   ├── queue-manager.js                 # queue 状态
│   ├── playback-coordinator.js          # 直链获取
│   ├── ncm-client.js                    # 网易云 API 客户端
│   ├── state-db.js                      # SQLite 封装
│   └── llm-logger.js                    # JSONL 落盘
├── pwa/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.js
│       ├── App.vue
│       ├── ws-client.js
│       └── components/
│           ├── Player.vue
│           ├── SubtitleBar.vue
│           ├── FeedbackButtons.vue
│           ├── QueuePreview.vue
│           └── ChatInput.vue
├── prompts/
│   ├── chat-mode.md
│   └── cold-start-taste.md
├── scripts/
│   ├── parse-apple-html.ps1             # HTML → 100 首(已存在脚本逻辑)
│   ├── ncm-login-qr.js                  # 命令行扫码登录
│   ├── ncm-fetch-playlists.js           # 拉两个网易云歌单
│   └── cold-start.js                    # 跑 Opus 分析
├── user/                                # 已就绪(部分)
├── data/
│   ├── state.db
│   ├── llm-calls.jsonl
│   ├── netease-cookie.txt               # 扫码后的登录 cookie
│   └── netease-snapshot.json            # 网易云歌单原始数据
├── docs/superpowers/{specs,plans}/      # 已就绪
├── nightliner-design-v0.3.md            # 已就绪
├── config.yaml
└── package.json
```

---

## Section A · Bootstrap(M0 + 收尾 M1)

### Task A1:初始化 git 仓库 + Node 项目骨架

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `config.yaml`

- [ ] **Step A1.1:** 初始化 git 仓库

```powershell
git init
git config core.autocrlf false
git config core.quotepath false
```

- [ ] **Step A1.2:** 写 `.gitignore`

```gitignore
node_modules/
data/state.db
data/state.db-journal
data/llm-calls.jsonl
data/netease-cookie.txt
data/netease-snapshot.json
pwa/dist/
.env
.DS_Store
Thumbs.db
```

- [ ] **Step A1.3:** 写 `package.json`

```json
{
  "name": "nightliner",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node server/index.js",
    "ncm:login": "node scripts/ncm-login-qr.js",
    "ncm:fetch": "node scripts/ncm-fetch-playlists.js",
    "cold-start": "node scripts/cold-start.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ws": "^8.18.0",
    "better-sqlite3": "^11.3.0",
    "yaml": "^2.6.0",
    "node-fetch": "^3.3.2"
  }
}
```

- [ ] **Step A1.4:** 写 `config.yaml`(参考 v0.3 附录 E,Windows 化)

```yaml
# Nightliner v0.4 Windows MVP config

models:
  light_command: null
  radio_mode: claude-sonnet-4-6
  chat_mode: claude-opus-4-7
  consolidation: claude-opus-4-7
  cold_start: claude-opus-4-7

take_song:
  library_prefer_pct: 70
  recommend_channel_pct: 20
  wildcard_pct: 10
  archeology_mode_must_be_library_bound: true

queue:
  default_length: 10
  min_length: 5
  max_length: 30
  segment_size: 5

playback:
  primary_source: netease            # v0.4 改动:Apple Music 不参与
  fallback_to_netease: false         # 主源已是网易云,无 fallback

ncm:
  api_base: http://localhost:3000    # NeteaseCloudMusicApi 默认端口
  song_url_level: standard           # standard / higher / exhigh / lossless

consolidation:
  enabled: false                     # v0.4 不做

signal_thresholds:
  strong_skip_sec: 30
  weak_skip_pct: 0.5
  near_complete_pct: 0.9
  cooldown_after_too_familiar_days: 90

server:
  port: 8080
  host: 127.0.0.1
```

- [ ] **Step A1.5:** 创建数据/日志目录

```powershell
New-Item -ItemType Directory -Force -Path data, prompts, scripts, server, pwa
```

- [ ] **Step A1.6:** 安装依赖

```powershell
npm install
```

期望输出:`added N packages` 无错误。

- [ ] **Step A1.7:** 提交 bootstrap commit

```powershell
git add package.json package-lock.json .gitignore config.yaml nightliner-design-v0.3.md user/ docs/
git commit -m "chore: bootstrap nightliner v0.4 Windows MVP

- Node 20 + ESM project skeleton
- config.yaml with v0.4 routing (no Apple Music, netease primary)
- .gitignore for state/llm-calls/cookie data
- Includes pre-existing v0.3 design + v0.4 spec + user soul files"
```

---

### Task A2:落地 PowerShell HTML 解析脚本

之前临时用过 PowerShell 提取 100 首 Apple Music 歌单。现在固化成可复用脚本。

**Files:**
- Create: `scripts/parse-apple-html.ps1`

- [ ] **Step A2.1:** 写脚本

```powershell
# scripts/parse-apple-html.ps1
# Usage: .\scripts\parse-apple-html.ps1 -InputHtml "C:\path\to\playlist.html" -OutputMd "user\apple-music-favorites-2024-2026.md"

param(
    [Parameter(Mandatory=$true)][string]$InputHtml,
    [Parameter(Mandatory=$true)][string]$OutputMd
)

if (-not (Test-Path $InputHtml)) {
    Write-Error "Input HTML not found: $InputHtml"
    exit 1
}

$html = Get-Content $InputHtml -Raw -Encoding UTF8

# 1. Extract JSON-LD metadata
$jsonPattern = '<script id="schema:music-playlist" type="application/ld\+json">(.+?)</script>'
$jsonMatch = [regex]::Match($html, $jsonPattern)
if (-not $jsonMatch.Success) {
    Write-Error "JSON-LD playlist schema not found"
    exit 1
}
$meta = $jsonMatch.Groups[1].Value | ConvertFrom-Json
$numTracks = $meta.numTracks
$datePublished = $meta.datePublished
$playlistName = $meta.name

# 2. Extract song-artist pairs from aria-labels
$pattern = 'aria-label="播放(.+?)的《(.+?)》"'
$allMatches = [regex]::Matches($html, $pattern)

$tracks = @()
$seen = @{}
foreach ($m in $allMatches) {
    $artist = $m.Groups[1].Value -replace '&amp;', '&' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&lt;', '<' -replace '&gt;', '>'
    $title = $m.Groups[2].Value -replace '&amp;', '&' -replace '&quot;', '"' -replace '&#39;', "'" -replace '&lt;', '<' -replace '&gt;', '>'
    $key = "$title|$artist"
    if (-not $seen.ContainsKey($key)) {
        $tracks += [PSCustomObject]@{ Title = $title; Artist = $artist }
        $seen[$key] = $true
        if ($tracks.Count -ge $numTracks) { break }
    }
}

if ($tracks.Count -ne $numTracks) {
    Write-Warning "Extracted $($tracks.Count) tracks but expected $numTracks. Output anyway."
}

# 3. Build markdown
$md = "# Apple Music · $playlistName`n`n"
$md += "> **来源**: HTML 导出 + parse-apple-html.ps1`n"
$md += "> **导出日期**: $datePublished`n"
$md += "> **总歌数**: $numTracks 首`n"
$md += "> **解析得**: $($tracks.Count) 首`n`n"
$md += "---`n`n## 完整歌曲列表(按歌单顺序)`n`n"

for ($i = 0; $i -lt $tracks.Count; $i++) {
    $md += "{0,3}. {1} / {2}`n" -f ($i + 1), $tracks[$i].Title, $tracks[$i].Artist
}

$md | Out-File -FilePath $OutputMd -Encoding utf8 -NoNewline
"Wrote $($tracks.Count) tracks to $OutputMd"
```

- [ ] **Step A2.2:** 验证脚本(用现有 HTML 重跑一次)

```powershell
.\scripts\parse-apple-html.ps1 -InputHtml "C:\Users\Aaron\Desktop\_喜爱歌曲 - 歌单 - Apple Music.html" -OutputMd "user\apple-music-favorites-2024-2026.md"
```

期望输出:`Wrote 100 tracks to user\apple-music-favorites-2024-2026.md`(注意现有文件还包含手写的"给 Opus 的 taste 分析提示"段落,脚本会覆盖丢失,Step A2.3 修复)。

- [ ] **Step A2.3:** 把"给 Opus 的 taste 分析提示"段落加回到脚本输出末尾

修改脚本,在 `$md += "{0,3}. ...` 循环结束后追加:

```powershell
$md += "`n---`n`n"
$md += "## 给 Opus 的 taste 分析提示(M-init 阶段使用)`n`n"
$md += "> 这 $numTracks 首是用户在 2024-2026 期间累积进 Apple Music ``$playlistName`` 歌单的歌。`n"
$md += "> 分析时:`n"
$md += "> 1. 识别**主轴口味**(出现频次最高的艺人/类型)`n"
$md += "> 2. 识别**怀旧维度**(歌单里大量 2003-2010 千禧华语 + 2014-2016 K-pop → 即使近期收藏的也含强怀旧成分)`n"
$md += "> 3. 识别**情绪光谱**:upbeat/dancing vs 抒情共鸣`n"
$md += "> 4. **明显排除项**:几乎没有 jazz / classical / metal / underground / 实验电子 / 后摇`n"
$md += "> 5. **跨语种共同点**:节奏感强 + 旋律记忆点高 + 副歌可哼唱`n"
$md += "> 6. 与网易云 945616754(2017-2023 主流偏好)的重叠/差异 → 推断当前听歌的连续性 vs 新探索方向`n"
```

重跑验证文件内容完整。

- [ ] **Step A2.4:** Commit

```powershell
git add scripts/parse-apple-html.ps1 user/apple-music-favorites-2024-2026.md
git commit -m "feat(scripts): add reusable Apple Music HTML parser

Extracts complete playlist (with metadata cross-check against JSON-LD numTracks)
to markdown. Replaces ad-hoc inline parsing."
```

---

## Section B · M-data:NeteaseCloudMusicApi 客户端

NCM client 是 M-init 和 M7-mini 的共同依赖。先做完。

### Task B1:部署 NeteaseCloudMusicApi(本地 npm 起,不用 Docker)

NeteaseCloudMusicApi 项目地址:https://github.com/Binaryify/NeteaseCloudMusicApi (npm 包名 `NeteaseCloudMusicApi`)。这是逆向工程的网易云 HTTP 接口包装。

**Files:**
- Create: `scripts/start-ncm-api.ps1`

- [ ] **Step B1.1:** 全局安装 NeteaseCloudMusicApi

```powershell
npm install -g NeteaseCloudMusicApi
```

期望输出:`added N packages, ... NeteaseCloudMusicApi@4.x.x`

- [ ] **Step B1.2:** 写启动脚本(便于以后启动)

```powershell
# scripts/start-ncm-api.ps1
# 启动网易云 API 服务,默认端口 3000
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
NeteaseCloudMusicApi
```

- [ ] **Step B1.3:** 启动并验证

```powershell
.\scripts\start-ncm-api.ps1
```

新开一个 PowerShell 窗口测试:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/search?keywords=遇见&limit=1
```

期望输出:返回包含 `result.songs[0].name` 等字段的 JSON,song name 含"遇见"。

- [ ] **Step B1.4:** 把启动脚本加进 .gitignore 备注 + commit

```powershell
git add scripts/start-ncm-api.ps1
git commit -m "chore(ncm): local NCM API launcher script"
```

---

### Task B2:写 ncm-client.js 客户端封装

只封装本月用得到的端点,不预留扩展。

**Files:**
- Create: `server/ncm-client.js`

- [ ] **Step B2.1:** 写 `server/ncm-client.js`

```javascript
// server/ncm-client.js
// NeteaseCloudMusicApi 客户端封装(只封本月需要的端点)
import fs from 'fs/promises';
import path from 'path';

const API_BASE = 'http://127.0.0.1:3000';
const COOKIE_PATH = 'data/netease-cookie.txt';

async function loadCookie() {
  try {
    return (await fs.readFile(COOKIE_PATH, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function ncmRequest(endpoint, params = {}) {
  const cookie = await loadCookie();
  const url = new URL(API_BASE + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  if (cookie) url.searchParams.set('cookie', cookie);
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error(`NCM ${endpoint} HTTP ${r.status}`);
  return r.json();
}

export async function loginQrKey() {
  return ncmRequest('/login/qr/key', { timestamp: Date.now() });
}

export async function loginQrCreate(key) {
  return ncmRequest('/login/qr/create', { key, qrimg: true, timestamp: Date.now() });
}

export async function loginQrCheck(key) {
  return ncmRequest('/login/qr/check', { key, timestamp: Date.now() });
}

export async function saveCookie(cookieStr) {
  await fs.mkdir(path.dirname(COOKIE_PATH), { recursive: true });
  await fs.writeFile(COOKIE_PATH, cookieStr, 'utf8');
}

export async function search(keywords, { limit = 5 } = {}) {
  return ncmRequest('/search', { keywords, limit, type: 1 });
}

export async function songUrl(id, level = 'standard') {
  return ncmRequest('/song/url/v1', { id, level });
}

export async function playlistDetail(id) {
  return ncmRequest('/playlist/detail', { id });
}

export async function playlistTrackAll(id, { limit = 1000, offset = 0 } = {}) {
  return ncmRequest('/playlist/track/all', { id, limit, offset });
}

export async function userPlaylist(uid) {
  return ncmRequest('/user/playlist', { uid });
}
```

- [ ] **Step B2.2:** 手动验证(无 cookie 也能搜索)

新建 `scripts/_smoke-ncm.js`(临时,验证后删):

```javascript
// scripts/_smoke-ncm.js
import { search } from '../server/ncm-client.js';
const r = await search('飞机场的10:30', { limit: 1 });
console.log(JSON.stringify(r.result.songs[0], null, 2));
```

运行:

```powershell
node scripts/_smoke-ncm.js
```

期望输出:JSON 含 `name: "飞机场的10:30"`、`ar: [{ name: "陶喆" }]`、`id: <数字>`。

- [ ] **Step B2.3:** 删除 smoke 文件 + commit

```powershell
Remove-Item scripts/_smoke-ncm.js
git add server/ncm-client.js
git commit -m "feat(ncm): client wrapper for login/search/song-url/playlist endpoints"
```

---

### Task B3:命令行扫码登录脚本

网易云需要登录 cookie 才能拉用户私有歌单(160249544 / 945616754 都是用户自创/收藏的,需要登录)。扫码登录是最稳定的方式。

**Files:**
- Create: `scripts/ncm-login-qr.js`

- [ ] **Step B3.1:** 写脚本

```javascript
// scripts/ncm-login-qr.js
// 命令行扫码登录:打印二维码 base64 图片到本地文件,用户扫码后回 cookie
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
```

- [ ] **Step B3.2:** 运行扫码登录

```powershell
npm run ncm:login
```

期望:终端显示"二维码已保存到 data/netease-qr.png" → 用户在文件资源管理器打开此 png 用网易云手机 App 扫码 → 终端显示"登录成功",`data/netease-cookie.txt` 文件出现。

**手动验证 cookie 生效**:新增临时验证(扫码完成后才能跑):

```powershell
node -e "import('./server/ncm-client.js').then(m => m.userPlaylist('127926555').then(r => console.log('用户歌单数量:', r.playlist.length)))"
```

期望输出:`用户歌单数量: <一个 > 0 的数字>`(因为登录了,能拿到完整歌单列表)。

- [ ] **Step B3.3:** Commit

```powershell
git add scripts/ncm-login-qr.js
git commit -m "feat(ncm): CLI QR login flow

Saves session cookie to data/netease-cookie.txt for authenticated playlist access."
```

---

### Task B4:拉两个网易云种子歌单的脚本

**Files:**
- Create: `scripts/ncm-fetch-playlists.js`

- [ ] **Step B4.1:** 写脚本

```javascript
// scripts/ncm-fetch-playlists.js
// 从 user/playlists.json 读出 netease 类种子歌单 ID,拉每个歌单的全部歌曲到 data/netease-snapshot.json
import fs from 'fs/promises';
import { playlistDetail, playlistTrackAll } from '../server/ncm-client.js';

async function main() {
  const playlistsRaw = await fs.readFile('user/playlists.json', 'utf8');
  const { seed_playlists } = JSON.parse(playlistsRaw);
  const neteaseLists = seed_playlists.filter(p => p.source === 'netease');

  const snapshot = { fetched_at: new Date().toISOString(), playlists: [] };

  for (const p of neteaseLists) {
    console.log(`拉歌单 ${p.id} (${p.label})...`);

    const detailResp = await playlistDetail(p.id);
    const playlistName = detailResp.playlist.name;
    const trackCount = detailResp.playlist.trackCount;
    console.log(`   名称: ${playlistName}, 共 ${trackCount} 首`);

    const tracksResp = await playlistTrackAll(p.id, { limit: trackCount });
    const songs = tracksResp.songs.map((s, idx) => ({
      idx,
      id: s.id,
      name: s.name,
      artists: s.ar.map(a => a.name).join(' / '),
      album: s.al?.name || '',
      duration_ms: s.dt,
    }));

    snapshot.playlists.push({
      id: p.id,
      label: p.label,
      time_range: p.time_range,
      weight: p.weight,
      note: p.note,
      playlist_name_on_netease: playlistName,
      track_count_on_netease: trackCount,
      track_count_fetched: songs.length,
      songs,
    });

    console.log(`   ✓ 已拉 ${songs.length} 首`);
  }

  await fs.writeFile('data/netease-snapshot.json', JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`\n快照已写入 data/netease-snapshot.json (${snapshot.playlists.length} 个歌单)`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step B4.2:** 运行(B1 的 NCM API 还得开着)

```powershell
npm run ncm:fetch
```

期望输出:终端依次打印两个歌单名 + 数量,最终 `快照已写入 data/netease-snapshot.json`。

**手动验证**:

```powershell
$snap = Get-Content data/netease-snapshot.json -Raw | ConvertFrom-Json
"$($snap.playlists.Count) playlists, $($snap.playlists[0].songs.Count) + $($snap.playlists[1].songs.Count) songs"
$snap.playlists[0].songs[0..2] | Format-Table idx, name, artists -AutoSize
```

期望:输出 `2 playlists, X + Y songs`,然后表格显示前 3 首歌(歌名 + 艺人非空)。

- [ ] **Step B4.3:** Commit

```powershell
git add scripts/ncm-fetch-playlists.js
git commit -m "feat(ncm): fetch seed playlists to data snapshot

Pulls all netease-source playlists from user/playlists.json into
data/netease-snapshot.json with full track metadata."
```

---

## Section C · M-init:快速 taste 冷启动

输入:三个数据源 + dj-persona。输出:`user/taste.md` + `user/life-stages.md`。

### Task C1:写 cold-start prompt 模板

**Files:**
- Create: `prompts/cold-start-taste.md`

- [ ] **Step C1.1:** 写 prompt 模板

```markdown
# Cold-Start Taste Analysis Prompt

你是 Elliot 的私人音乐档案管理员。任务是基于他的种子歌单和 DJ 人格,生成 taste.md(口味档案)+ life-stages.md(三段人生章节)的初版。

---

## DJ 人格

{{DJ_PERSONA}}

---

## 已知人生章节(用户已分好,你只需填充内容,不要重新切分)

- **章节 1 · 早期听歌探索期**(2014-2017):网易云歌单 160249544,已不太听,记忆考古素材
- **章节 2 · 主流偏好期 · 回忆主线**(2017-2023):网易云歌单 945616754,常规电台高权重
- **章节 3 · 当前活跃**(2024-2026):Apple Music Favorite Songs 100 首,当前主流

---

## 数据源

### 网易云歌单 1(2014-2017,160249544)

{{NETEASE_PLAYLIST_1}}

### 网易云歌单 2(2017-2023,945616754)

{{NETEASE_PLAYLIST_2}}

### Apple Music Favorite Songs(2024-2026)

{{APPLE_MUSIC_PLAYLIST}}

---

## 用户自由描述(可选)

{{USER_FREE_DESCRIPTION_OR_EMPTY}}

---

## 任务

输出一个 JSON 对象,字段如下:

```json
{
  "taste_md": "完整的 taste.md 内容(markdown 字符串)",
  "life_stages_md": "完整的 life-stages.md 内容(markdown 字符串)",
  "observations": ["3-5 条值得 Elliot 注意的观察(自然语言)"]
}
```

### taste.md 结构(Opus 自由组织,以下是建议)

- 当前口味总结(2-3 段,companion 档语气)
- 常听风格(按比例,带具体艺人/歌曲举例)
- 高完成率歌曲类型(从重叠的歌推断)
- 容易跳过的类型(从未出现的类型反推)
- 时段偏好留空(无时间戳数据,等运行时积累)
- 旧歌记忆线索(指向 life-stages.md 章节 1 / 2)

### life-stages.md 结构(每章)

```markdown
## 章节 N · [占位名,等 Elliot 命名]

时间范围:YYYY-MM ~ YYYY-MM
关键事件:[等 Elliot 填]
状态:[活跃 / 记忆考古]
音乐锚点:
  - <歌名> · <艺人>(本章节 top 频次/印象)
  - ...(共 5-10 首)
模糊记忆:[空,等 chat 慢慢补]
避雷:[空,等反馈沉淀]
```

### 强制约束

- **不要**直接复述具体事件名词(隐私边界,见 dj-persona 系统硬规则)
- 引用旧歌时使用**时段化表达**:"那年常听的"、"早期反复循环的"
- companion 档语气,不要"治愈/陪你/温暖"等避讳词的近义
- observations 用第二人称,简洁,不煽情
```

- [ ] **Step C1.2:** Commit

```powershell
git add prompts/cold-start-taste.md
git commit -m "feat(prompts): cold-start taste analysis template"
```

---

### Task C2:写 cold-start.js 跑 Opus 一次性分析

**Files:**
- Create: `scripts/cold-start.js`

- [ ] **Step C2.1:** 写脚本

```javascript
// scripts/cold-start.js
// 拼装 cold-start prompt → 调 claude opus → 解析 JSON → 写 user/taste.md 和 user/life-stages.md
import fs from 'fs/promises';
import { spawn } from 'child_process';

const TEMPLATE_PATH = 'prompts/cold-start-taste.md';
const DJ_PERSONA_PATH = 'user/dj-persona.md';
const APPLE_PLAYLIST_PATH = 'user/apple-music-favorites-2024-2026.md';
const NETEASE_SNAPSHOT_PATH = 'data/netease-snapshot.json';
const FREE_DESC_PATH = 'user/free-taste-description.txt'; // 可选
const TASTE_OUT = 'user/taste.md';
const LIFE_STAGES_OUT = 'user/life-stages.md';

async function readOrEmpty(path) {
  try { return await fs.readFile(path, 'utf8'); }
  catch { return ''; }
}

function netesePlaylistToText(p) {
  const lines = [`歌单元数据: ${p.label} | ${p.time_range} | 共 ${p.track_count_fetched} 首`];
  p.songs.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name} / ${s.artists}`);
  });
  return lines.join('\n');
}

async function buildPrompt() {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const djPersona = await fs.readFile(DJ_PERSONA_PATH, 'utf8');
  const applePlaylist = await fs.readFile(APPLE_PLAYLIST_PATH, 'utf8');
  const snapshot = JSON.parse(await fs.readFile(NETEASE_SNAPSHOT_PATH, 'utf8'));
  const freeDesc = await readOrEmpty(FREE_DESC_PATH);

  const p1 = snapshot.playlists.find(p => p.id === '160249544');
  const p2 = snapshot.playlists.find(p => p.id === '945616754');

  return template
    .replace('{{DJ_PERSONA}}', djPersona)
    .replace('{{NETEASE_PLAYLIST_1}}', p1 ? netesePlaylistToText(p1) : '(歌单 1 数据未拉取)')
    .replace('{{NETEASE_PLAYLIST_2}}', p2 ? netesePlaylistToText(p2) : '(歌单 2 数据未拉取)')
    .replace('{{APPLE_MUSIC_PLAYLIST}}', applePlaylist)
    .replace('{{USER_FREE_DESCRIPTION_OR_EMPTY}}', freeDesc.trim() || '(用户暂未提供自由描述,基于歌单本身分析)');
}

function callClaude(prompt, model = 'claude-opus-4-7') {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model], {
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true, // Windows 上找 claude.cmd
    });
    let stdout = '';
    child.stdout.on('data', d => stdout += d.toString());
    child.on('close', code => {
      if (code !== 0) reject(new Error(`claude exited ${code}`));
      else resolve(stdout);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function extractInnerJson(claudeRawOutput) {
  // claude -p --output-format json 返回 { result: "<assistant text>" } 之类
  // 我们要的 JSON 在 result 字段内,可能用 ```json ... ``` 包着
  const wrapper = JSON.parse(claudeRawOutput);
  const innerText = wrapper.result || wrapper.message || JSON.stringify(wrapper);
  // 从 inner text 提取第一段 ```json ... ``` 或纯 JSON
  const codeBlockMatch = innerText.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : innerText;
  return JSON.parse(jsonStr);
}

async function main() {
  console.log('1. 拼装 prompt...');
  const prompt = await buildPrompt();
  console.log(`   prompt 长度: ${prompt.length} 字符`);

  console.log('2. 调 Claude Opus(可能需要 30-90 秒)...');
  const t0 = Date.now();
  const raw = await callClaude(prompt);
  console.log(`   ✓ ${Date.now() - t0}ms`);

  console.log('3. 解析 JSON...');
  const parsed = extractInnerJson(raw);

  console.log('4. 写文件...');
  await fs.writeFile(TASTE_OUT, parsed.taste_md, 'utf8');
  await fs.writeFile(LIFE_STAGES_OUT, parsed.life_stages_md, 'utf8');

  console.log(`   ✓ ${TASTE_OUT}`);
  console.log(`   ✓ ${LIFE_STAGES_OUT}`);

  console.log('\n5. Opus 的观察(供 Elliot 参考):');
  for (const obs of parsed.observations || []) {
    console.log(`   • ${obs}`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step C2.2:** 运行(需要先做完 Task B4 拿到 netease-snapshot.json)

```powershell
npm run cold-start
```

期望输出:终端打印各阶段进度,最终列出 3-5 条 observations。`user/taste.md` 和 `user/life-stages.md` 文件被创建。

**手动验证**:

```powershell
Get-Content user/taste.md | Select-Object -First 30
"---"
Get-Content user/life-stages.md
```

期望:taste.md 前 30 行是 markdown 内容(有"## 当前口味总结"之类的章节);life-stages.md 包含 3 个 `## 章节` 章节,每个有时间范围 + 音乐锚点 5-10 首。

- [ ] **Step C2.3:** Elliot 审 taste.md(5 分钟)

由 Elliot 直接打开 `user/taste.md` 编辑,改 1-2 句不顺的措辞。**这是必要步骤,不能跳过**——确保档案符合 Elliot 真实口味。

- [ ] **Step C2.4:** Commit cold-start 产物

```powershell
git add prompts/ scripts/cold-start.js user/taste.md user/life-stages.md
git commit -m "feat(cold-start): generate initial taste.md + life-stages.md

One-shot Opus analysis of 3 seed playlists (2 netease + Apple Music).
Reviewed by Elliot, ready for prompt injection."
```

---

## Section D · M2:命令行最小原型

目标:跑一次 chat 命令,看到 `{say, play[N], reason, ...}` JSON。验证 LLM 在 Elliot 身上的智能。

### Task D1:state.db schema + 封装

**Files:**
- Create: `server/state-db.js`

- [ ] **Step D1.1:** 写封装

```javascript
// server/state-db.js
// SQLite 主库封装。schema 来自 v0.3 §9.2,只创建本月用得到的表。
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = 'data/state.db';

function ensureDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_events (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      source_app TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration_sec INTEGER,
      played_sec INTEGER,
      ended_reason TEXT,
      context_json TEXT
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      signal TEXT NOT NULL,
      context_json TEXT
    );

    CREATE TABLE IF NOT EXISTS anti_list (
      id INTEGER PRIMARY KEY,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      reason TEXT,
      ts INTEGER NOT NULL,
      scope TEXT
    );

    CREATE TABLE IF NOT EXISTS cooldown (
      id INTEGER PRIMARY KEY,
      song_title TEXT NOT NULL,
      song_artist TEXT NOT NULL,
      cooldown_until INTEGER NOT NULL,
      reason TEXT
    );

    CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY,
      ts_start INTEGER NOT NULL,
      ts_end INTEGER,
      mode TEXT,
      songs_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_play_events_ts ON play_events(ts);
    CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback(ts);
  `);
}

ensureDir();
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
migrate(db);

export function recordPlay(event) {
  const stmt = db.prepare(`
    INSERT INTO play_events
    (ts, source_app, title, artist, album, duration_sec, played_sec, ended_reason, context_json)
    VALUES (@ts, @source_app, @title, @artist, @album, @duration_sec, @played_sec, @ended_reason, @context_json)
  `);
  stmt.run({
    ts: event.ts || Math.floor(Date.now() / 1000),
    source_app: event.source_app || 'Nightliner-NCM',
    title: event.title,
    artist: event.artist,
    album: event.album || null,
    duration_sec: event.duration_sec || null,
    played_sec: event.played_sec || null,
    ended_reason: event.ended_reason || null,
    context_json: event.context_json ? JSON.stringify(event.context_json) : null,
  });
}

export function recordFeedback(fb) {
  db.prepare(`
    INSERT INTO feedback (ts, song_title, song_artist, signal, context_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    Math.floor(Date.now() / 1000),
    fb.song_title,
    fb.song_artist,
    fb.signal,
    fb.context_json ? JSON.stringify(fb.context_json) : null
  );

  // 'too_familiar' → 进 cooldown 90 天
  if (fb.signal === 'too_familiar') {
    const until = Math.floor(Date.now() / 1000) + 90 * 86400;
    db.prepare(`
      INSERT INTO cooldown (song_title, song_artist, cooldown_until, reason)
      VALUES (?, ?, ?, ?)
    `).run(fb.song_title, fb.song_artist, until, 'too_familiar');
  }
  // 'never_again' → 进 anti_list
  if (fb.signal === 'never_again') {
    db.prepare(`
      INSERT INTO anti_list (song_title, song_artist, reason, ts, scope)
      VALUES (?, ?, ?, ?, ?)
    `).run(fb.song_title, fb.song_artist, 'user marked never_again',
           Math.floor(Date.now() / 1000), 'song');
  }
}

export function recentPlays(limit = 30) {
  return db.prepare(`SELECT * FROM play_events ORDER BY ts DESC LIMIT ?`).all(limit);
}

export function recentFeedback(limit = 20) {
  return db.prepare(`SELECT * FROM feedback ORDER BY ts DESC LIMIT ?`).all(limit);
}

export function antiList() {
  return db.prepare(`SELECT song_title, song_artist FROM anti_list`).all();
}

export function activeCooldowns() {
  const now = Math.floor(Date.now() / 1000);
  return db.prepare(`
    SELECT song_title, song_artist FROM cooldown WHERE cooldown_until > ?
  `).all(now);
}

export function recordQueue(queue) {
  return db.prepare(`
    INSERT INTO queues (ts_start, mode, songs_json) VALUES (?, ?, ?)
  `).run(
    Math.floor(Date.now() / 1000),
    queue.mode || 'chat',
    JSON.stringify(queue.songs)
  ).lastInsertRowid;
}

export default db;
```

- [ ] **Step D1.2:** 手动验证

```powershell
node -e "import('./server/state-db.js').then(m => { m.recordPlay({title:'测试', artist:'测试人'}); console.log(m.recentPlays(5)); })"
```

期望:输出含一条 `title: '测试', artist: '测试人'` 的记录。

清空测试数据:

```powershell
Remove-Item data/state.db, data/state.db-wal, data/state.db-shm -ErrorAction SilentlyContinue
```

- [ ] **Step D1.3:** Commit

```powershell
git add server/state-db.js
git commit -m "feat(state-db): SQLite schema + helpers

Tables: play_events, feedback, anti_list, cooldown, queues.
Reuses v0.3 §9.2 schema, only the M2/M7-mini-relevant subset."
```

---

### Task D2:llm-logger 落盘

**Files:**
- Create: `server/llm-logger.js`

- [ ] **Step D2.1:** 写封装

```javascript
// server/llm-logger.js
// 每次 Claude 调用的 prompt + 响应 + 耗时全部追加到 data/llm-calls.jsonl
import fs from 'fs/promises';
import path from 'path';

const LOG_PATH = 'data/llm-calls.jsonl';

export async function logLlmCall(entry) {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  const line = JSON.stringify({
    ts: entry.ts || new Date().toISOString(),
    model: entry.model,
    trigger: entry.trigger,
    prompt: entry.prompt,
    response: entry.response,
    duration_ms: entry.duration_ms,
    error: entry.error || null,
  }) + '\n';
  await fs.appendFile(LOG_PATH, line, 'utf8');
}
```

- [ ] **Step D2.2:** Commit

```powershell
git add server/llm-logger.js
git commit -m "feat(llm-logger): JSONL persistence for every Claude call"
```

---

### Task D3:claude-adapter.js 子进程封装

**Files:**
- Create: `server/claude-adapter.js`

- [ ] **Step D3.1:** 写封装

```javascript
// server/claude-adapter.js
// claude -p 子进程调用,返回 assistant 输出文本(不解析 JSON,留给 caller)
import { spawn } from 'child_process';
import { logLlmCall } from './llm-logger.js';

export async function callClaude({ prompt, model, trigger }) {
  const t0 = Date.now();
  let response = '';
  let error = null;

  try {
    response = await new Promise((resolve, reject) => {
      const child = spawn('claude', ['-p', '--output-format', 'json', '--model', model], {
        stdio: ['pipe', 'pipe', 'inherit'],
        shell: true,
      });
      let stdout = '';
      child.stdout.on('data', d => stdout += d.toString());
      child.on('close', code => {
        if (code !== 0) reject(new Error(`claude exited ${code}`));
        else resolve(stdout);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  } catch (e) {
    error = String(e);
    throw e;
  } finally {
    await logLlmCall({
      model,
      trigger,
      prompt,
      response,
      duration_ms: Date.now() - t0,
      error,
    });
  }

  // claude -p 包了一层 wrapper { result: "<assistant text>", ... }
  const wrapper = JSON.parse(response);
  return wrapper.result || wrapper.message || response;
}

// 从 Claude 输出文本里提取 JSON(可能用 ```json ... ``` 包着)
export function extractJson(text) {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text;
  return JSON.parse(jsonStr.trim());
}
```

- [ ] **Step D3.2:** Commit

```powershell
git add server/claude-adapter.js
git commit -m "feat(claude-adapter): subprocess wrapper + JSON extraction

Logs every call via llm-logger. Returns raw assistant text;
extractJson() strips code-block fence."
```

---

### Task D4:chat-mode prompt 模板

**Files:**
- Create: `prompts/chat-mode.md`

- [ ] **Step D4.1:** 写模板(基于 v0.3 §五.5 + 附录 D.2)

```markdown
# Chat Mode Prompt

你是 Elliot 的私人 DJ。每次接到他的一句话,你要决定播什么歌、为什么播、是否需要打断当前 queue。

---

## 1. DJ 人格

{{DJ_PERSONA}}

## 2. 用户语料(口味档案)

### taste.md
{{TASTE}}

### mood-rules.md
{{MOOD_RULES}}

### life-stages.md
{{LIFE_STAGES}}

## 3. 环境

- 时间:{{TS}}
- 星期:{{DOW}}
- (天气暂未接入,默认晴)

## 4. 已检索记忆

### 最近播放(最多 30 条,从 state.db 取)
{{RECENT_PLAYS}}

### 最近反馈(最多 20 条)
{{RECENT_FEEDBACK}}

### Anti-list(永久禁播)
{{ANTI_LIST}}

### Cooldown(短期降权,90 天内不要推)
{{COOLDOWNS}}

## 5. 用户输入

{{USER_MESSAGE}}

## 6. 当前 queue 状态

{{CURRENT_QUEUE_OR_EMPTY}}

---

## 任务

为 Elliot 生成一段 {{N}} 首歌的推荐。

### 强制约束(违反则换一首)

1. **reason 字段是 chain-of-thought 也是 DJ 字幕**——先把"为什么是这首"写清楚,再确定 play。如果 reason 写不出有说服力的理由,换一首。
2. **memoryLink 必须有真实数据支撑**——只有当此歌在 RECENT_PLAYS 出现 N 次以上,或在 LIFE_STAGES 章节里被显式列为音乐锚点,才能填;否则必须为 `null`。"宁可不说,不要瞎说。"
3. **隐私边界**:引用 life-stages 中的关键事件时,使用**时段化**表达("那段日子常听的"),不直接复述事件名词。
4. **避讳词**:DJ 永远不要说 dj-persona 中列出的 3 个避讳词,也不要说近义("加油 / 治愈 / 陪你 / 温暖 / 拥抱 / 力量 / 致敬 / 诠释" 这一类)。
5. **取歌策略**:目标比例 70% library-prefer(从 taste / netease 历史命中的)+ 20% recommend channel + 10% wildcard。但**不要解释这个比例**,自然出歌即可。
6. **avoid**:不要推 ANTI_LIST 里的歌,不要推 COOLDOWNS 里的歌,不要推 RECENT_PLAYS 前 5 条已经在播的(避免重复)。

### 输出 JSON 结构

只输出一个 JSON 对象,放在 ```json ... ``` 代码块里:

```json
{
  "say": "1-2 句话开场白(companion 档语气,看 dj-persona 的话密度设置)",
  "play": [
    {
      "title": "歌名",
      "artist": "艺人",
      "reason": "为什么这首(chain-of-thought + 字幕双重身份)",
      "memoryLink": null,
      "confidence": 0.0-1.0,
      "source_preference": "netease"
    }
  ],
  "queueAction": null,
  "modeUpdate": null
}
```

`queueAction` 取值:`null`(普通生成)/ `"rewrite_tail"`(用户要"换一批")/ `"insert_next"`(用户要"下一首播 X")/ `"replace_all"`(整批换)。
`source_preference` 在 v0.4 永远是 `"netease"`(主源单一)。
```

- [ ] **Step D4.2:** Commit

```powershell
git add prompts/chat-mode.md
git commit -m "feat(prompts): chat-mode template with v0.3 §5 constraints"
```

---

### Task D5:context-builder.js 拼装 6 片 prompt

**Files:**
- Create: `server/context-builder.js`

- [ ] **Step D5.1:** 写封装

```javascript
// server/context-builder.js
// 拼装 chat-mode prompt 的 6 个片段
import fs from 'fs/promises';
import db, { recentPlays, recentFeedback, antiList, activeCooldowns } from './state-db.js';

const TEMPLATE_PATH = 'prompts/chat-mode.md';

async function readOrEmpty(p) {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}

function fmtPlays(plays) {
  if (!plays.length) return '(无最近播放,这是首次会话)';
  return plays.map(p => {
    const ago = Math.round((Date.now() / 1000 - p.ts) / 60);
    const tag = p.ended_reason || '?';
    return `- ${p.title} / ${p.artist} (${ago}min前, ${tag})`;
  }).join('\n');
}

function fmtFeedback(fbs) {
  if (!fbs.length) return '(无最近反馈)';
  return fbs.map(f => {
    const ago = Math.round((Date.now() / 1000 - f.ts) / 60);
    return `- [${f.signal}] ${f.song_title} / ${f.song_artist} (${ago}min前)`;
  }).join('\n');
}

function fmtSongList(rows) {
  if (!rows.length) return '(空)';
  return rows.map(r => `- ${r.song_title} / ${r.song_artist}`).join('\n');
}

export async function buildChatPrompt({ userMessage, currentQueue, n = 5 }) {
  const template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  const djPersona = await readOrEmpty('user/dj-persona.md');
  const taste = await readOrEmpty('user/taste.md');
  const moodRules = await readOrEmpty('user/mood-rules.md');
  const lifeStages = await readOrEmpty('user/life-stages.md');

  const now = new Date();
  const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];

  return template
    .replace('{{DJ_PERSONA}}', djPersona || '(dj-persona.md 为空)')
    .replace('{{TASTE}}', taste || '(taste.md 尚未生成)')
    .replace('{{MOOD_RULES}}', moodRules || '(mood-rules.md 为空,从空开始)')
    .replace('{{LIFE_STAGES}}', lifeStages || '(life-stages.md 尚未生成)')
    .replace('{{TS}}', now.toISOString())
    .replace('{{DOW}}', dow)
    .replace('{{RECENT_PLAYS}}', fmtPlays(recentPlays(30)))
    .replace('{{RECENT_FEEDBACK}}', fmtFeedback(recentFeedback(20)))
    .replace('{{ANTI_LIST}}', fmtSongList(antiList()))
    .replace('{{COOLDOWNS}}', fmtSongList(activeCooldowns()))
    .replace('{{USER_MESSAGE}}', userMessage)
    .replace('{{CURRENT_QUEUE_OR_EMPTY}}',
      currentQueue && currentQueue.length
        ? currentQueue.map((s, i) => `${i + 1}. ${s.title} / ${s.artist}`).join('\n')
        : '(当前 queue 为空)')
    .replace('{{N}}', String(n));
}
```

- [ ] **Step D5.2:** Commit

```powershell
git add server/context-builder.js
git commit -m "feat(context-builder): assemble 6-block chat prompt

Loads dj-persona/taste/mood-rules/life-stages + state.db queries
(recent plays, feedback, anti-list, cooldown) + env (time/DOW)."
```

---

### Task D6:CLI 入口 chat-once

**Files:**
- Create: `scripts/chat-once.js`

- [ ] **Step D6.1:** 写脚本

```javascript
// scripts/chat-once.js
// 命令行原型:接一句用户输入,跑一次完整 chat 流程,打印 {say, play, ...} JSON
import { buildChatPrompt } from '../server/context-builder.js';
import { callClaude, extractJson } from '../server/claude-adapter.js';
import yaml from 'yaml';
import fs from 'fs/promises';

async function loadConfig() {
  return yaml.parse(await fs.readFile('config.yaml', 'utf8'));
}

async function main() {
  const userMessage = process.argv.slice(2).join(' ');
  if (!userMessage) {
    console.error('用法: node scripts/chat-once.js "我想听点高中刷题时听的"');
    process.exit(1);
  }

  const config = await loadConfig();
  const model = config.models.chat_mode;

  console.log(`>>> 用户: ${userMessage}\n`);

  const prompt = await buildChatPrompt({ userMessage, currentQueue: [], n: 5 });
  console.log(`(prompt 长度: ${prompt.length} 字符,模型: ${model})\n`);

  const t0 = Date.now();
  const raw = await callClaude({ prompt, model, trigger: 'chat-once-cli' });
  console.log(`(Claude 耗时: ${Date.now() - t0}ms)\n`);

  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    console.error('JSON 解析失败,原始输出:');
    console.error(raw);
    process.exit(1);
  }

  console.log('>>> DJ:');
  console.log('say:', parsed.say);
  console.log('\nplay:');
  parsed.play.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.title} / ${s.artist}`);
    console.log(`     reason: ${s.reason}`);
    console.log(`     memoryLink: ${s.memoryLink || 'null'}`);
    console.log(`     confidence: ${s.confidence}`);
  });
  if (parsed.queueAction) console.log(`\nqueueAction: ${parsed.queueAction}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step D6.2:** 加 npm script

修改 `package.json` 的 `scripts`:

```json
"scripts": {
  "start": "node server/index.js",
  "ncm:login": "node scripts/ncm-login-qr.js",
  "ncm:fetch": "node scripts/ncm-fetch-playlists.js",
  "cold-start": "node scripts/cold-start.js",
  "chat": "node scripts/chat-once.js"
}
```

- [ ] **Step D6.3:** 验证(M2 验收点 · 验证 LLM 在 Elliot 身上够不够聪明)

```powershell
npm run chat -- "想听点高中刷题时候会循环的歌"
```

期望:终端先打印 prompt 长度 + Claude 耗时,然后:
- `say` 是 1-2 句 companion 档语气的话(无避讳词)
- `play` 是 5 首歌,每首带 `reason`(读起来有说服力)和 `memoryLink`(基本应该是 null,因为 RECENT_PLAYS 还为空)
- 若 Elliot 觉得推荐质量不够好,**回到 prompts/chat-mode.md 调整模板,不改代码**

跑 2-3 个不同的输入感受质量:

```powershell
npm run chat -- "下雨天,给我点旧的"
npm run chat -- "想沉一会儿,但别太丧"
npm run chat -- "周日早晨想要松弛点的"
```

每次结果都 dump 到 `data/llm-calls.jsonl`,供后续 prompt 调参看。

- [ ] **Step D6.4:** Commit

```powershell
git add scripts/chat-once.js package.json
git commit -m "feat(m2): CLI chat prototype

Reads taste/mood-rules/life-stages + state.db, calls Opus once,
prints structured recommendation. M2 verification: LLM intelligence check."
```

---

## Section E · M3:接通 NCM song_url(命令行可播)

### Task E1:playback-coordinator.js 拉直链

**Files:**
- Create: `server/playback-coordinator.js`

- [ ] **Step E1.1:** 写封装

```javascript
// server/playback-coordinator.js
// 把 Claude 输出的 play[] 解析成可播放的网易云直链。搜不到的从 queue 删除。
import { search, songUrl } from './ncm-client.js';
import yaml from 'yaml';
import fs from 'fs/promises';

let _config = null;
async function getConfig() {
  if (!_config) {
    _config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
  }
  return _config;
}

// 从 NCM 搜索结果里挑最匹配的(歌名 + 艺人)
function pickBest(searchResult, targetTitle, targetArtist) {
  const songs = searchResult?.result?.songs || [];
  if (!songs.length) return null;
  const norm = s => (s || '').toLowerCase().replace(/\s|·|・|・|\(|\)|（|）/g, '');
  const tt = norm(targetTitle);
  const ta = norm(targetArtist);
  for (const s of songs) {
    const sName = norm(s.name);
    const sArtist = norm(s.artists.map(a => a.name).join(''));
    if (sName === tt && sArtist.includes(ta.split('/')[0])) return s;
  }
  // 兜底:第一个名字命中的
  for (const s of songs) {
    if (norm(s.name) === tt) return s;
  }
  // 再兜底:第一条
  return songs[0];
}

// 给一个 play[],返回 [{ title, artist, ncm_id, url, duration_ms, found: true|false }, ...]
export async function resolvePlayList(plays) {
  const config = await getConfig();
  const level = config.ncm.song_url_level;

  const resolved = [];
  for (const p of plays) {
    const q = `${p.title} ${p.artist}`;
    let entry = { title: p.title, artist: p.artist, found: false };

    try {
      const sr = await search(q, { limit: 5 });
      const best = pickBest(sr, p.title, p.artist);
      if (!best) {
        console.warn(`[playback] 未命中: ${q}`);
        resolved.push(entry);
        continue;
      }
      const urlResp = await songUrl(best.id, level);
      const url = urlResp?.data?.[0]?.url;
      if (!url) {
        console.warn(`[playback] 命中但无 URL(可能仅 VIP): ${best.name} / ${best.artists[0].name}`);
        resolved.push({ ...entry, ncm_id: best.id });
        continue;
      }
      resolved.push({
        ...entry,
        ncm_id: best.id,
        url,
        duration_ms: best.duration,
        ncm_name: best.name,
        ncm_artist: best.artists.map(a => a.name).join(' / '),
        found: true,
      });
    } catch (e) {
      console.warn(`[playback] 错误 ${q}: ${e.message}`);
      resolved.push(entry);
    }
  }

  return resolved;
}
```

- [ ] **Step E1.2:** Commit

```powershell
git add server/playback-coordinator.js
git commit -m "feat(playback): NCM search + song_url resolution

Returns enriched play[] with direct URLs. Misses (VIP-only / not-found)
are kept in array with found: false (queue layer drops them)."
```

---

### Task E2:命令行集成测试 chat-once + 直链

**Files:**
- Modify: `scripts/chat-once.js`

- [ ] **Step E2.1:** 在 chat-once.js 里追加直链解析

修改 chat-once.js,在打印 play 之前加一段:

替换原有 `>>> DJ:` 部分到 `if (parsed.queueAction)` 之间为:

```javascript
  console.log('>>> DJ:');
  console.log('say:', parsed.say);

  console.log('\n解析直链(网易云搜索 + song_url)...');
  const { resolvePlayList } = await import('../server/playback-coordinator.js');
  const resolved = await resolvePlayList(parsed.play);

  console.log('\nplay:');
  resolved.forEach((s, i) => {
    const orig = parsed.play[i];
    const status = s.found ? '✓' : '✗';
    console.log(`  ${i + 1}. ${status} ${s.title} / ${s.artist}`);
    console.log(`     reason: ${orig.reason}`);
    if (s.found) {
      console.log(`     ncm: ${s.ncm_name} / ${s.ncm_artist}`);
      console.log(`     url: ${s.url.substring(0, 80)}...`);
    } else {
      console.log(`     ✗ 未找到可播放直链(从 queue 删除)`);
    }
  });
  if (parsed.queueAction) console.log(`\nqueueAction: ${parsed.queueAction}`);
```

- [ ] **Step E2.2:** 验证(M3 验收点 · 直链可播)

确保 NCM API 仍在跑(`.\scripts\start-ncm-api.ps1` 在另一个终端开着)。

```powershell
npm run chat -- "想听点轻快的电子流行"
```

期望:每首歌打印 `✓` 和 url(以 `http://m...music.126.net/...` 之类开头)。

**关键验证**:复制其中一首歌的 url 到浏览器地址栏,听到歌就 OK。

如果大部分歌都 `✗`,可能是搜索匹配规则需要调整,回到 `pickBest()` 优化。

- [ ] **Step E2.3:** Commit

```powershell
git add scripts/chat-once.js
git commit -m "feat(m3): wire chat-once to NCM song_url resolution

Verified end-to-end: prompt → Claude → search → song_url → playable URL."
```

---

## Section F · M7-mini:精简 PWA

### Task F1:Vue 3 + Vite 项目骨架

**Files:**
- Create: `pwa/package.json`
- Create: `pwa/vite.config.js`
- Create: `pwa/index.html`
- Create: `pwa/src/main.js`
- Create: `pwa/src/App.vue`

- [ ] **Step F1.1:** 创建 pwa 子项目

```powershell
cd pwa
npm init -y
npm install vue
npm install -D vite @vitejs/plugin-vue
cd ..
```

- [ ] **Step F1.2:** 写 `pwa/package.json`(覆盖 npm init 生成的)

```json
{
  "name": "nightliner-pwa",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.1.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step F1.3:** 写 `pwa/vite.config.js`

```javascript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/stream': { target: 'ws://127.0.0.1:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step F1.4:** 写 `pwa/index.html`

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nightliner</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0a0a0a; color: #e8e8e8; }
    #app { max-width: 720px; margin: 0 auto; padding: 16px; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step F1.5:** 写 `pwa/src/main.js`

```javascript
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
```

- [ ] **Step F1.6:** 写 `pwa/src/App.vue`(只是骨架,具体在 F3-F5 实现)

```vue
<template>
  <div class="player-shell">
    <h1>Nightliner</h1>
    <p v-if="!connected">连接中...</p>
    <Player v-else :state="state" @feedback="onFeedback" @chat="onChat" />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import Player from './components/Player.vue';
import { connectWs, sendChat, sendFeedback } from './ws-client.js';

const connected = ref(false);
const state = ref({ now: null, queue: [], subtitle: '' });

let ws;

onMounted(() => {
  ws = connectWs((msg) => {
    if (msg.type === 'now') state.value.now = msg.data;
    if (msg.type === 'queue') state.value.queue = msg.data;
    if (msg.type === 'subtitle') state.value.subtitle = msg.data;
    if (msg.type === 'connected') connected.value = true;
  });
});

onUnmounted(() => ws?.close());

function onFeedback(signal) {
  if (state.value.now) sendFeedback({ ...state.value.now, signal });
}

function onChat(text) {
  sendChat(text);
}
</script>
```

- [ ] **Step F1.7:** 写 `pwa/src/ws-client.js`

```javascript
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
```

- [ ] **Step F1.8:** Commit

```powershell
git add pwa/ -- ":!pwa/node_modules"
git commit -m "feat(pwa): Vue 3 + Vite skeleton with WS client + proxy"
```

---

### Task F2:Express + WebSocket 后端入口

**Files:**
- Create: `server/index.js`

- [ ] **Step F2.1:** 写主入口

```javascript
// server/index.js
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import yaml from 'yaml';
import fs from 'fs/promises';
import { buildChatPrompt } from './context-builder.js';
import { callClaude, extractJson } from './claude-adapter.js';
import { resolvePlayList } from './playback-coordinator.js';
import { recordFeedback, recordPlay, recordQueue } from './state-db.js';

const config = yaml.parse(await fs.readFile('config.yaml', 'utf8'));
const PORT = config.server.port;

const app = express();
app.use(express.json());
app.use(express.static('pwa/dist')); // 生产构建产物;开发时用 vite proxy

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/stream' });

const broadcast = (msg) => {
  const json = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(json);
  }
};

// In-memory current queue + now playing
let currentQueue = [];
let now = null;

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'now', data: now }));
  ws.send(JSON.stringify({ type: 'queue', data: currentQueue }));
});

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  res.json({ ok: true, status: 'thinking' });
  broadcast({ type: 'subtitle', data: 'DJ 思考中...' });

  try {
    const prompt = await buildChatPrompt({ userMessage: message, currentQueue, n: 5 });
    const raw = await callClaude({ prompt, model: config.models.chat_mode, trigger: 'chat' });
    const parsed = extractJson(raw);

    const resolved = await resolvePlayList(parsed.play);
    const playable = resolved.filter(s => s.found);

    if (parsed.queueAction === 'rewrite_tail' && currentQueue.length) {
      // 保留当前已播,替换后段
      const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
      const head = idxNow >= 0 ? currentQueue.slice(0, idxNow + 1) : [];
      currentQueue = [...head, ...playable];
    } else if (parsed.queueAction === 'insert_next') {
      const idxNow = now ? currentQueue.findIndex(s => s.title === now.title) : -1;
      currentQueue.splice(idxNow + 1, 0, ...playable);
    } else {
      // null / 'replace_all' → 直接整批替换(M7-mini 简化:不区分 replace_all 和默认)
      currentQueue = playable;
      now = playable[0] || null;
    }

    recordQueue({ mode: 'chat', songs: currentQueue });
    broadcast({ type: 'queue', data: currentQueue });
    broadcast({ type: 'now', data: now });
    broadcast({ type: 'subtitle', data: parsed.say + (parsed.play[0]?.reason ? '\n' + parsed.play[0].reason : '') });
  } catch (e) {
    console.error('chat error:', e);
    broadcast({ type: 'subtitle', data: '出错了:' + e.message });
  }
});

// GET /api/now
app.get('/api/now', (req, res) => res.json(now));

// GET /api/queue
app.get('/api/queue', (req, res) => res.json(currentQueue));

// POST /api/feedback
app.post('/api/feedback', (req, res) => {
  const { title, artist, signal } = req.body;
  if (!title || !artist || !signal) return res.status(400).json({ error: 'fields missing' });
  recordFeedback({ song_title: title, song_artist: artist, signal });
  res.json({ ok: true });
  // 反馈影响下一段 queue 在下一次 chat 时通过 prompt 注入生效
});

// POST /api/play-event(由 PWA 在 audio 事件时上报)
app.post('/api/play-event', (req, res) => {
  const e = req.body;
  recordPlay({
    title: e.title,
    artist: e.artist,
    duration_sec: e.duration_sec,
    played_sec: e.played_sec,
    ended_reason: e.ended_reason,
  });
  // 切到下一首
  if (e.ended_reason === 'natural' || e.ended_reason === 'user_skip') {
    const idx = currentQueue.findIndex(s => s.title === e.title);
    if (idx >= 0 && idx + 1 < currentQueue.length) {
      now = currentQueue[idx + 1];
      broadcast({ type: 'now', data: now });
    } else {
      now = null;
      broadcast({ type: 'now', data: null });
      broadcast({ type: 'subtitle', data: 'queue 结束。再来一段?' });
    }
  }
  res.json({ ok: true });
});

server.listen(PORT, config.server.host, () => {
  console.log(`Nightliner server on http://${config.server.host}:${PORT}`);
});
```

- [ ] **Step F2.2:** Commit

```powershell
git add server/index.js
git commit -m "feat(m7-mini): Express + WS server with chat/feedback/now endpoints

Single in-memory queue + now-playing. WS broadcasts state changes.
Maps queueAction (rewrite_tail / insert_next / null) to queue mutations."
```

---

### Task F3:Player 主组件

**Files:**
- Create: `pwa/src/components/Player.vue`
- Create: `pwa/src/components/SubtitleBar.vue`
- Create: `pwa/src/components/FeedbackButtons.vue`
- Create: `pwa/src/components/QueuePreview.vue`
- Create: `pwa/src/components/ChatInput.vue`

- [ ] **Step F3.1:** 写 `pwa/src/components/Player.vue`

```vue
<template>
  <div class="player">
    <div class="now" v-if="state.now">
      <div class="title">{{ state.now.title }}</div>
      <div class="artist">{{ state.now.artist }}</div>
      <div class="source">来源:网易云</div>
      <audio
        ref="audio"
        :src="state.now.url"
        autoplay
        controls
        @ended="onEnded"
        @timeupdate="onTimeUpdate"
      />
    </div>
    <div class="now empty" v-else>
      <p>(暂无播放,跟 DJ 聊几句开始)</p>
    </div>

    <SubtitleBar :text="state.subtitle" />

    <FeedbackButtons @feedback="$emit('feedback', $event)" />

    <QueuePreview :queue="state.queue" :now="state.now" />

    <ChatInput @send="$emit('chat', $event)" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import SubtitleBar from './SubtitleBar.vue';
import FeedbackButtons from './FeedbackButtons.vue';
import QueuePreview from './QueuePreview.vue';
import ChatInput from './ChatInput.vue';

const props = defineProps({ state: Object });
defineEmits(['feedback', 'chat']);

const audio = ref(null);
let lastReportedSec = 0;

function onTimeUpdate() {
  if (!audio.value) return;
  lastReportedSec = Math.floor(audio.value.currentTime);
}

function onEnded() {
  reportPlayEvent('natural', Math.floor(audio.value?.duration || 0));
}

// 用户点 ⏭ 或换歌时的"被打断"信号:audio src 变化 → 旧的 audio 被销毁,这里用 watch
import { watch } from 'vue';
watch(() => props.state.now?.title, (newTitle, oldTitle) => {
  if (oldTitle && oldTitle !== newTitle && lastReportedSec > 0) {
    // 旧歌没播完就换了,记一笔 user_skip
    fetch('/api/play-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: oldTitle,
        artist: props.state.now?.artist || '',
        duration_sec: Math.floor(audio.value?.duration || 0),
        played_sec: lastReportedSec,
        ended_reason: 'user_skip',
      }),
    });
    lastReportedSec = 0;
  }
});

function reportPlayEvent(reason, playedSec) {
  if (!props.state.now) return;
  fetch('/api/play-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: props.state.now.title,
      artist: props.state.now.artist,
      duration_sec: Math.floor(audio.value?.duration || 0),
      played_sec: playedSec,
      ended_reason: reason,
    }),
  });
}
</script>

<style scoped>
.player { padding: 12px 0; }
.now { text-align: center; margin: 24px 0; }
.title { font-size: 24px; font-weight: 600; margin-bottom: 4px; }
.artist { color: #999; margin-bottom: 8px; }
.source { color: #555; font-size: 12px; margin-bottom: 16px; }
.empty { color: #555; padding: 40px 0; }
audio { width: 100%; max-width: 480px; }
</style>
```

- [ ] **Step F3.2:** 写 `pwa/src/components/SubtitleBar.vue`

```vue
<template>
  <div class="subtitle-bar">
    <p v-if="text">{{ text }}</p>
    <p v-else class="hint">(等 DJ 发话)</p>
  </div>
</template>

<script setup>
defineProps({ text: String });
</script>

<style scoped>
.subtitle-bar {
  min-height: 64px;
  background: #1a1a1a;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 16px 0;
  white-space: pre-line;
  line-height: 1.5;
}
.hint { color: #555; }
</style>
```

- [ ] **Step F3.3:** 写 `pwa/src/components/FeedbackButtons.vue`

```vue
<template>
  <div class="feedback">
    <button @click="$emit('feedback', 'love')" title="喜欢">❤️</button>
    <button @click="$emit('feedback', 'wrong_vibe')" title="不对味">💢</button>
    <button @click="$emit('feedback', 'too_familiar')" title="太熟了">🔁</button>
    <button @click="$emit('feedback', 'never_again')" title="别再播">🚫</button>
  </div>
</template>

<script setup>
defineEmits(['feedback']);
</script>

<style scoped>
.feedback { display: flex; gap: 12px; justify-content: center; margin: 16px 0; }
button {
  font-size: 22px;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #fff;
  border-radius: 8px;
  width: 56px;
  height: 56px;
  cursor: pointer;
  transition: transform 0.1s;
}
button:hover { transform: scale(1.1); background: #222; }
button:active { transform: scale(0.95); }
</style>
```

- [ ] **Step F3.4:** 写 `pwa/src/components/QueuePreview.vue`

```vue
<template>
  <div class="queue-preview">
    <div v-if="upcoming.length === 0" class="empty">(queue 已结束)</div>
    <div v-else>
      <div class="next">→ {{ upcoming[0].title }} - {{ upcoming[0].artist }}</div>
      <div v-if="upcoming.length > 1" class="rest">
        ... 还有 {{ upcoming.length - 1 }} 首
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ queue: Array, now: Object });

const upcoming = computed(() => {
  if (!props.queue) return [];
  if (!props.now) return props.queue;
  const idx = props.queue.findIndex(s => s.title === props.now.title);
  return idx >= 0 ? props.queue.slice(idx + 1) : props.queue;
});
</script>

<style scoped>
.queue-preview { padding: 12px; background: #111; border-radius: 8px; margin: 16px 0; }
.next { font-size: 14px; color: #ccc; }
.rest { color: #666; font-size: 12px; margin-top: 4px; }
.empty { color: #555; }
</style>
```

- [ ] **Step F3.5:** 写 `pwa/src/components/ChatInput.vue`

```vue
<template>
  <form class="chat" @submit.prevent="onSubmit">
    <input
      v-model="text"
      placeholder="跟 DJ 说话…"
      autocomplete="off"
    />
    <button type="submit" :disabled="!text.trim()">发送</button>
  </form>
</template>

<script setup>
import { ref } from 'vue';
const text = ref('');
const emit = defineEmits(['send']);

function onSubmit() {
  const msg = text.value.trim();
  if (!msg) return;
  emit('send', msg);
  text.value = '';
}
</script>

<style scoped>
.chat { display: flex; gap: 8px; margin-top: 16px; }
input {
  flex: 1;
  padding: 12px;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
}
input:focus { outline: none; border-color: #555; }
button {
  padding: 12px 24px;
  background: #2a4a8a;
  border: none;
  color: #fff;
  border-radius: 8px;
  cursor: pointer;
}
button:disabled { background: #333; color: #666; cursor: not-allowed; }
</style>
```

- [ ] **Step F3.6:** Commit

```powershell
git add pwa/src/components/
git commit -m "feat(pwa): Player composition (subtitle/feedback/queue/chat)

5 leaf components, audio events report to /api/play-event for skip detection."
```

---

### Task F4:端到端验证

- [ ] **Step F4.1:** 同时启动三个进程

终端 1(NCM API):

```powershell
.\scripts\start-ncm-api.ps1
```

终端 2(Nightliner 后端):

```powershell
npm start
```

期望:`Nightliner server on http://127.0.0.1:8080`

终端 3(PWA dev server):

```powershell
cd pwa
npm run dev
```

期望:`Local: http://localhost:5173`

- [ ] **Step F4.2:** 浏览器打开 http://localhost:5173

预期看到:
- 顶部 "Nightliner" 标题
- "(暂无播放,跟 DJ 聊几句开始)"
- 字幕区写着 "(等 DJ 发话)"
- 4 个反馈按钮(灰色)
- 底部 chat 输入框

- [ ] **Step F4.3:** chat 一句

输入框打:`周日早上,给我点松弛的`,回车。

期望流程:
1. 字幕变为 "DJ 思考中..."
2. ~5-15 秒后,字幕变为 DJ 的开场白 + 第一首 reason
3. Player 区显示第一首歌名 / 艺人 / "来源:网易云"
4. `<audio>` 自动开始播放(可能需要点一次播放按钮,因为浏览器 autoplay 政策)
5. queue preview 显示 "→ <下一首>" + "...还有 N 首"

- [ ] **Step F4.4:** 测试反馈

听几秒,点 💢(不对味)。

期望:`data/state.db` 的 `feedback` 表多一行 signal=wrong_vibe。下一次 chat 时,这个反馈会通过 prompt 进入 Claude 的上下文。

```powershell
node -e "import('./server/state-db.js').then(m => console.log(m.recentFeedback(5)))"
```

- [ ] **Step F4.5:** 测试跳过 / 自然结束

跳到下一首(浏览器 audio 控件 → 拖进度条到末尾)。

期望:终端输出 `[server] play-event: natural` 之类(view server logs);`data/state.db` 的 `play_events` 表多一行 ended_reason=natural;`now` 自动切到 queue 下一首。

- [ ] **Step F4.6:** 测试"换一批"

chat 输入:`换一批,这批不太对`

期望:Claude 输出 `queueAction: "rewrite_tail"`,服务端把当前歌后面的全部替换;UI queue preview 立即更新。

- [ ] **Step F4.7:** Commit M7-mini 完成里程碑

```powershell
git add .
git commit -m "feat(m7-mini): end-to-end PWA

Verified flow: chat → Claude → NCM URL → audio playback → feedback → DB.
5-7 day Windows MVP scope complete."
```

---

## Section G · 收尾

### Task G1:写 README + Mac 迁移指引

**Files:**
- Create: `README.md`

- [ ] **Step G1.1:** 写 `README.md`

```markdown
# Nightliner

Elliot 的私人音乐 Agent · v0.4 Windows MVP

## 状态

Windows 期(2026-05-08 起)— 网易云为主源,PWA 内嵌 `<audio>` 播放。
Mac 迁移期(预计 2026-06)— 增加 Apple Music 协调层 + MediaRemote 信号采集。

## 启动

需要三个进程同时跑(三个终端):

```powershell
# 终端 1:NCM API
.\scripts\start-ncm-api.ps1

# 终端 2:Nightliner 后端
npm start

# 终端 3:PWA dev server
cd pwa && npm run dev
```

浏览器打开 http://localhost:5173

## 首次使用前

1. `npm run ncm:login`(扫码登录网易云)
2. `npm run ncm:fetch`(拉两个种子歌单)
3. `.\scripts\parse-apple-html.ps1 -InputHtml <path-to-exported-html> -OutputMd user/apple-music-favorites-2024-2026.md`(刷新 Apple Music 100 首)
4. `npm run cold-start`(生成 taste.md / life-stages.md)
5. 审一遍 `user/taste.md`

## 设计文档

- 完整原始设计:[`nightliner-design-v0.3.md`](nightliner-design-v0.3.md)
- Windows 差分:[`docs/superpowers/specs/2026-05-08-nightliner-windows-mvp-design.md`](docs/superpowers/specs/2026-05-08-nightliner-windows-mvp-design.md)
- 实施计划:[`docs/superpowers/plans/2026-05-08-nightliner-windows-mvp.md`](docs/superpowers/plans/2026-05-08-nightliner-windows-mvp.md)

## Mac 迁移路径

1. `git push` 到私有仓库 → Mac 上 `git clone`
2. `npm install`(根目录 + pwa/)
3. 数据迁移:`data/state.db` 直接拷贝(SQLite 跨平台)
4. 新增工作:M4(AppleScript)/ M5(MediaRemote daemon)/ M6(数据冷启动升级)/ M7 完整版 / M8(consolidation)

## 不做的事

参见 v0.3 §11.5 + v0.4 spec §九 附录 C。
```

- [ ] **Step G1.2:** Commit

```powershell
git add README.md
git commit -m "docs: README with launch flow + Mac migration path"
```

---

## Self-Review

### 1. Spec coverage(逐章对照 v0.4 spec)

| spec § | plan section | 实现 task |
|--------|--------------|-----------|
| §一 关键差分(平台/播放源/范围) | A | A1(config.yaml) |
| §二 四层架构 | D + F | D1-D6(后端 3-4 层)+ F1-F3(UI 层) |
| §三 M0(项目初始化) | A | A1 |
| §三 M1(灵魂文件) | — | 已就绪,A1 commit 收纳 |
| §三 M-init | C | C1-C2(prompt + cold-start) + B1-B4(数据准备前置) |
| §三 M2(命令行原型) | D | D1-D6 |
| §三 M3(NCM 客户端 + 命令行可播) | B + E | B1-B4(client) + E1-E2(直链解析) |
| §三 M7-mini(精简 PWA) | F | F1-F4 |
| §四 Mac 迁移检查表 | G | G1(README) |
| §五 保留 v0.3 部分 | — | prompt 模板沿用 v0.3 §5 约束;无新增任务 |
| §六 Apple Music HTML 解析 | A | A2(脚本固化) |
| §七 待补全(避讳词等) | — | 由 Elliot 补,不需要任务 |
| §八 user/ 最终态 | — | C2.4 commit 体现 |

✅ 所有 spec 章节都有对应任务。

### 2. Placeholder scan

通读全 plan,没发现 "TBD" / "TODO" / "implement later" / "fill in details" / "appropriate error handling" / "similar to Task N" / "write tests for the above" 等 placeholder。所有代码块都是完整可运行内容。

### 3. Type / 命名一致性

- `play[]` 数组中元素字段:`title / artist / reason / memoryLink / confidence / source_preference` —— Task D4 prompt 模板与 Task E1 `resolvePlayList()` 处理一致(Task E1 在 entry 里追加 `ncm_id / url / found / ncm_name / ncm_artist / duration_ms`,不冲突)。
- `feedback signal` 取值:`love / wrong_vibe / too_familiar / never_again` —— Task D1 state-db / Task F3 FeedbackButtons / Task F2 /api/feedback 处理一致。
- `ended_reason` 取值:`natural / user_skip / app_close / unknown` —— Task D1 schema 注释 + Task F3 audio 事件上报一致。
- `queueAction` 取值:`null / rewrite_tail / insert_next / replace_all` —— Task D4 prompt 与 Task F2 `/api/chat` handler 一致。
- `source_preference` 永远是 `"netease"`(v0.4 单源)—— Task D4 prompt 显式约束。

✅ 全部一致。

### 4. 已修正的边界

- M-init prompt 模板里 `{{NETEASE_PLAYLIST_1}}` 注入的内容用 Task C2 `netesePlaylistToText` 函数生成;格式与 prompt 模板里"歌单元数据 + 编号列表"对应。
- claude-adapter 的 `extractJson` 与 cold-start 的 `extractInnerJson` 实现一致,后者额外处理了 wrapper 的 .result 字段——cold-start.js Step C2.1 中已合并到一个函数,无重复实现。

---

## 已知不实现 / 留 Mac 期

- TTS / Apple MusicKit JS / Spotify(永远不做)
- SMTC daemon / Windows 服务封装(Windows 特有,迁 Mac 报废)
- Profile 视图 / Settings 视图 / 模式 chip / 调音台 / consolidation pass(都留 Mac)
- queue 流式分段生成(v0.3 §3.2)—— v0.4 简化:每次 chat 一次性出 5 首,不做后段预生成(因为 PWA 内嵌 audio 没有"切换 queue 间隙"问题,且 5-7 天 scope 内不必要)
- 模型路由 light_command / radio_mode 分流 —— v0.4 只用 chat_mode(Opus),Sonnet 留 Mac 上线模式 chip 时再启用

---

**Plan 结束。**
