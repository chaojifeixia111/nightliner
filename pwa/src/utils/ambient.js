// 封面取色:纯函数可单测,浏览器壳负责 canvas/CORS。
// 网易云 CDN 不放行 CORS 时 extractAmbient 返回 null,调用方回退鎏金(spec §8)。

export function averageRgb(data) {
  if (!data || data.length < 4) return null;
  let r = 0, g = 0, b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

export function extractAmbient(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve(averageRgb(ctx.getImageData(0, 0, 32, 32).data));
      } catch { resolve(null); } // canvas tainted = CORS 拒绝
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
