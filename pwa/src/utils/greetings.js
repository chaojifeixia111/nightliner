// Pick a random greeting based on current time of day.
// 文案纪律(spec §6):全英文、短句、正常语气,禁止破折号抒情体。
const POOLS = {
  morning: [   // 5:00 - 11:00
    "Morning. What's first?",
    'Something easy to start with?',
    'What do you want to hear?',
    'Pick the first track of the day',
  ],
  afternoon: [ // 11:00 - 17:00
    'What do you want to hear?',
    'Need focus or a break?',
    'Something for the afternoon?',
    'Name a song, an artist, or a mood',
  ],
  evening: [   // 17:00 - 22:00
    'Done for the day. What now?',
    "Pick tonight's first track",
    'Loud or quiet tonight?',
    'What do you want to hear?',
  ],
  night: [     // 22:00 - 2:00
    'Something quiet?',
    'What do you want to hear tonight?',
    'Slow ones from here?',
    'Name a mood',
  ],
  lateNight: [ // 2:00 - 5:00
    'Still up? Name a song or a mood.',
    'Something low for the late hours?',
    'One more before bed?',
    'What do you want to hear?',
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
