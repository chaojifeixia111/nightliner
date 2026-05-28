// server/embedder.js
// 本地 BGE-M3 (Xenova/bge-m3 q8 ONNX) 推理. 进程内单例.
import { pipeline, env } from '@huggingface/transformers';

if (process.env.HF_CACHE_DIR) env.cacheDir = process.env.HF_CACHE_DIR;
if (process.env.HF_ENDPOINT) env.remoteHost = process.env.HF_ENDPOINT;

let _extractor = null;
let _loadingPromise = null;

async function getExtractor() {
  if (_extractor) return _extractor;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = pipeline('feature-extraction', 'Xenova/bge-m3', { dtype: 'q8' });
  _extractor = await _loadingPromise;
  return _extractor;
}

export async function embed(text) {
  const e = await getExtractor();
  const out = await e(text, { pooling: 'cls', normalize: true });
  return new Float32Array(out.data);
}

// 预热: 启动时 await 一次,避免首次 chat 卡 3s
export async function warmup() {
  await getExtractor();
}
