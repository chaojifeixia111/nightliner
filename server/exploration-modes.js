// server/exploration-modes.js
// 探索系数 = 5 个命名档位。每档一个明确配方:池子比例 + 探索池构成 + 给模型的 brief。
//
// 唯一「硬对齐」的量是 familiar↔new(库内 vs 全新)比例 —— index.js 用 libraryKeys
// 确定性校验返回结果并补齐,详见那里。其余(recommend/wildcard 占比、同艺人深挖量、
// 风格纪律)是「软指引」:靠 brief + 探索池参数引导,不强制。要调任何一档,改这张表即可。

export const MODES = [
  {
    value: 0, name: '舒适区', en: 'Comfort',
    lib: 100, rec: 0, wild: 0,
    deepCutArtists: 0, perSeedCap: 0,
    desc: '只放你最爱、最常听的',
    brief: '纯舒适区:只放你收藏里最爱、最常听的。怎么熟怎么来,可以重温老爱曲,死守当前 mood —— 这一档不要给新东西。',
  },
  {
    value: 25, name: '偏熟悉', en: 'Cozy',
    lib: 75, rec: 20, wild: 5,
    deepCutArtists: 2, perSeedCap: 0,
    desc: '收藏里没常听的 + 一点同艺人深挖',
    brief: '偏熟悉:大部分还是你收藏的,但挑没怎么常听的「冷藏曲」而非最爱;极少量新歌只来自你已爱艺人的其它作品;基本同风格。',
  },
  {
    value: 50, name: '平衡', en: 'Balanced',
    lib: 50, rec: 35, wild: 15,
    deepCutArtists: 2, perSeedCap: 1,
    desc: '一半熟,一半新',
    brief: '平衡:一半你的收藏(最爱与冷藏各半),一半新的(同艺人深挖 + 少量相邻新歌);邻近风格可以跨。',
  },
  {
    value: 75, name: '偏探索', en: 'Venture',
    lib: 25, rec: 40, wild: 35,
    deepCutArtists: 2, perSeedCap: 2,
    desc: '大半没听过的,锚在你口味上',
    brief: '偏探索:大半是你没听过的(同艺人深挖 + 新艺人各半);收藏只取冷藏曲、别重放最爱;可在你口味范围内跨风格。',
  },
  {
    value: 100, name: '狂野', en: 'Wild',
    lib: 5, rec: 30, wild: 65,
    deepCutArtists: 1, perSeedCap: 3,
    desc: '几乎全新,只留一点底色',
    brief: '狂野:几乎全是新艺人 / 新歌,只留一两首锚住你的底色;鼓励跨风格、跳出舒适区。',
  },
];

// 把任意 0–100 的值吸附到最近的档位(滑块停在 0/25/50/75/100 时精确命中)
export function modeForValue(v) {
  const x = Number.isFinite(Number(v)) ? Number(v) : 50;
  let best = MODES[0];
  for (const m of MODES) {
    if (Math.abs(m.value - x) < Math.abs(best.value - x)) best = m;
  }
  return best;
}

// 本批 N 首里「库内(familiar)」应有多少首 —— 唯一硬对齐的量,其余为 new。
export function familiarTarget(mode, n) {
  return Math.round((mode.lib / 100) * n);
}
