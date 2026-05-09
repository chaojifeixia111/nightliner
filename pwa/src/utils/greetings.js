// Pick a random greeting based on current time of day.
const POOLS = {
  morning: [   // 5:00 - 11:00
    'Good morning, Elliot — 早上想听点什么?',
    '今天是新的一天 — 来一首温柔的开机曲?',
    '早安. 要醒神还是慢起?',
    '咖啡还没好? 先放点轻的',
    '清晨第一首 — Long Shot 那阵的吗?',
    'Sunrise vibe 还是直接 Future Bass?',
    '还困着 — 慢的还是猛的?',
    '今天想从哪一年的歌单开始?',
    'Morning playlist starts here. Tell me a mood.',
    '早 — 一首歌的时间唤醒你?',
  ],
  afternoon: [ // 11:00 - 17:00
    'Good afternoon — 下午要换换味道?',
    '中午吃饱了 — 来点带劲的?',
    '工位上挂耳朵里 — 来 Long Shot?',
    '午后微困 — 整一首带 vocal 的?',
    'Working time — 给点专注的电子流',
    '下午茶 — 想听首什么?',
    '敲键盘配 future bass 怎么样?',
    '该放点带感的了 — Chainsmokers?',
    '下午需要 reset 一下吗?',
    'Half-day check — 想往回走一点?',
  ],
  evening: [   // 17:00 - 22:00
    'Good evening — 今晚什么节奏?',
    '下班了 — 给自己一首奖励',
    '晚饭后 — 来首好下饭的?',
    '今晚是慢慢听还是嗨一点?',
    '夜色刚起 — 找点 Drift 那阵的?',
    '今天还行吗? 让 DJ 配你心情',
    '想往回走一点? 千禧华语?',
    'ILLENIUM 那条线? 还是别的?',
    'After-dark — Tell me the mood.',
    '一首歌的时间 — 你想听哪个章节?',
  ],
  night: [     // 22:00 - 2:00
    'Late night — 静一点的?',
    '夜深了 — 来首 vocal 慢曲?',
    '今晚不睡是因为想听歌吗?',
    '深夜电台 — 你点,我播',
    '夜里更适合 Long Shot 那阵的',
    '想被某首歌击中?',
    'Quiet hours — 整首慢的?',
    '陶喆 / 孙燕姿 那条线?',
    '凌晨快到了 — 想清醒还是想沉?',
    '夜里听什么都更清楚 — 来一首',
  ],
  lateNight: [ // 2:00 - 5:00
    '凌晨了还醒着 — DJ 陪一首',
    '失眠夜 — 想听点什么压底?',
    '这个点了 — 你点,我配',
    '夜里最长的几个小时 — 一首慢的?',
    '醒着的话 — Drift 章节的?',
    '都这点了... 来首暖的',
    '深夜深听 — 想沉一点?',
    '凌晨的 playlist 是另一种 playlist',
  ],
};

export function pickGreeting(now = new Date()) {
  const h = now.getHours();
  let pool;
  if (h >= 5 && h < 11) pool = POOLS.morning;
  else if (h >= 11 && h < 17) pool = POOLS.afternoon;
  else if (h >= 17 && h < 22) pool = POOLS.evening;
  else if (h >= 22 || h < 2) pool = POOLS.night;
  else pool = POOLS.lateNight;
  return pool[Math.floor(Math.random() * pool.length)];
}
