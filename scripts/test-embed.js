// scripts/test-embed.js
// 首次运行会下载 BGE-M3 ONNX 量化版本 (~1.1GB) 到 HF_CACHE_DIR
// 完成后跑两个 sample embed,验证维度 + 中英文都能处理
import { pipeline, env } from '@huggingface/transformers';

// 1. 缓存到 D 盘 (绕开默认的 C:\Users\Aaron\.cache)
if (process.env.HF_CACHE_DIR) {
  env.cacheDir = process.env.HF_CACHE_DIR;
  console.log(`[env] cacheDir = ${env.cacheDir}`);
}

// 2. 用国内镜像加速下载
if (process.env.HF_ENDPOINT) {
  env.remoteHost = process.env.HF_ENDPOINT;
  console.log(`[env] remoteHost = ${env.remoteHost}`);
}

console.log('[load] downloading + loading Xenova/bge-m3 (q8 quantized)...');
console.log('       首次运行需要下载约 1.1GB, 请耐心等待');

const t0 = Date.now();
const extractor = await pipeline('feature-extraction', 'Xenova/bge-m3', {
  dtype: 'q8',
  // 显示下载进度
  progress_callback: (info) => {
    if (info.status === 'progress' && info.file) {
      const pct = ((info.loaded / info.total) * 100).toFixed(1);
      process.stdout.write(`\r  ${info.file}: ${pct}%  (${(info.loaded / 1024 / 1024).toFixed(1)}MB / ${(info.total / 1024 / 1024).toFixed(1)}MB)   `);
    } else if (info.status === 'done') {
      process.stdout.write(`\n  done: ${info.file}\n`);
    }
  },
});
console.log(`[load] done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// 3. 测试中英混合
const samples = [
  '夜里听的歌,一个人,灯关',
  'songs for late night, alone, lights off',
  'Frank Ocean Blonde 那张专辑',
  'KPOP 女声',
];

for (const s of samples) {
  const t = Date.now();
  const out = await extractor(s, { pooling: 'cls', normalize: true });
  const dim = out.dims[out.dims.length - 1];
  const sample5 = Array.from(out.data.slice(0, 5)).map(x => x.toFixed(4));
  console.log(`[embed] "${s}"`);
  console.log(`        dim=${dim}, first5=[${sample5.join(', ')}], ${Date.now() - t}ms`);
}

console.log('\n✓ BGE-M3 本地推理可用');
