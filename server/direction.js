// server/direction.js
// 「方向」是用户点名的硬约束(语种 / 性别 / 艺人),优先级高于探索档位。
// 档位只决定该方向内「熟悉↔全新」的配比;方向本身不可被档位稀释。
//
// 设计取舍:
//  - 语种判定 = 「艺人语种表」优先,「歌名脚本」兜底(trackLang)。
//    纯歌名脚本对 K-pop/J-pop 会塌:绝大多数歌名是拉丁字母("Talk that Talk"/TWICE、
//    "Lemon"/米津玄師),会被判成 english,导致「韩语/日语」方向把它们全过滤掉、候选池缩到只剩
//    歌名带谚文/假名的那几首(用户踩过的坑:点「KPOP女声」只推回 1 首)。所以先按艺人查 ARTIST_LANG,
//    查不到才退回歌名脚本。歌名脚本仍保「Sad Sometimes(黄霄雲 EDM)不混进国语」的老保护。
//  - 性别无法从歌名/艺人名可靠判定 → server 不在性别上过滤,交给 LLM 按方向文案把关;
//    但「全新」种子取自用户该语种下收藏的艺人(本就偏女声),配合 LLM 终筛,实际效果够好。
//  - 艺人:精确匹配传入的曲库艺人名集合。

const HAN = /[一-鿿㐀-䶿]/;
const KANA = /[぀-ヿ]/;
const HANGUL = /[가-힯]/;

export function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '').replace(/[（）()·・,，.。!！?？'’"]/g, '');
}

// 歌名主导的语种判定。返回 'chinese' | 'english' | 'korean' | 'japanese'
export function songLang(title) {
  const t = title || '';
  if (HANGUL.test(t)) return 'korean';
  if (KANA.test(t)) return 'japanese';
  if (HAN.test(t)) return 'chinese';
  return 'english';
}

// 艺人 → 语种(curated,基于 Elliot 真实曲库 + 反馈)。拉丁标题的 K/J-pop 靠它救回,
// 歌名脚本(songLang)只作未知艺人的兜底。新增韩/日艺人往这里加即可——key 用 norm() 后的形式
// (小写、去空格/连字符/标点)。只放「确定是韩/日」的艺人,别放中/英艺人,以免污染其它方向。
const ARTIST_LANG = new Map(Object.entries({
  // —— 韩语 / K-pop ——
  twice: 'korean', blackpink: 'korean', ive: 'korean', lesserafim: 'korean',
  sistar: 'korean', cnblue: 'korean', bigbang: 'korean', akmu: 'korean',
  taeyang: 'korean', '태양': 'korean', 악동뮤지션: 'korean',
  少女时代: 'korean', '소녀시대': 'korean', girlsgeneration: 'korean',
  newjeans: 'korean', '뉴진스': 'korean', aespa: 'korean', '에스파': 'korean',
  iu: 'korean', '아이유': 'korean',
  // —— 日语 / J-pop ——
  米津玄師: 'japanese', 米津玄师: 'japanese', oneokrock: 'japanese', daoko: 'japanese',
  yoasobi: 'japanese', aimer: 'japanese', あいみょん: 'japanese', aimyon: 'japanese',
  kinggnu: 'japanese', radwimps: 'japanese', ヨルシカ: 'japanese', yorushika: 'japanese',
  藤井風: 'japanese', fujiikaze: 'japanese',
}));

// 从艺人串判定语种。拆分多艺人(/ × & feat with ,),逐段「精确」匹配,
// 避免短 key(如 'ive')子串误命中('Stive Morgan' 含 'ive' 但不是韩语)。查不到返回 null。
function artistLang(artist) {
  if (!artist) return null;
  for (const seg of String(artist).split(/[/×&,]|feat\.?|with/i)) {
    const k = norm(seg).replace(/-/g, '');
    if (k && ARTIST_LANG.has(k)) return ARTIST_LANG.get(k);
  }
  return null;
}

// 一首歌的有效语种:艺人语种表优先,歌名脚本兜底。方向语种过滤应当用它,而不是裸 songLang。
export function trackLang(title, artist) {
  return artistLang(artist) || songLang(title);
}

// 语种关键词 → 规范语种(优先级自上而下;命中即停)
const LANG_KEYWORDS = [
  ['chinese', ['国语', '华语', '中文', '普通话', '汉语', '国风', '粤语', '中文歌', 'mandarin', 'chinese', 'cpop', 'c-pop']],
  ['korean', ['韩语', '韩文', '韩国', 'kpop', 'k-pop', 'k pop', 'korean']],
  ['japanese', ['日语', '日文', '日本', '日系', 'jpop', 'j-pop', 'japanese']],
  ['english', ['英文', '英语', '欧美', '美式', 'english']],
];

const GENDER_KEYWORDS = [
  ['female', ['女声', '女生', '女歌手', '女歌', '女音', '女嗓', '女声线', 'female', 'girl']],
  ['male', ['男声', '男生', '男歌手', '男歌', '男音', '男嗓', 'male']],
];

const CONTINUATION = /(下一批|下一首|下一个|下首|再来|继续|接着|接下来|还要|还想|多来|多放|换一批|换批|换一首|来一批|换点别的|next|more)/i;

// 连续/翻页指令:沿用上一轮的方向(本身不带新方向时才生效)
export function isContinuation(message) {
  return CONTINUATION.test(message || '');
}

// 纠正/追问/refine 信号:用户在批评或修正上一批,仍在当前方向语境内 → 应沿用方向
const CORRECTION = /(不是|不对|又是|又给|怎么|为什么|为啥|错了|搞错|说过|说的是|明明|重新|重来|还是|第一首|刚才|上一|按我说|我让你|我说的|不要再|别再|不要给|别给)/i;

// 是否应沿用上一轮方向(连续指令 或 纠正/追问)。fresh 的新请求两者都不命中 → 清空方向。
export function carriesDirection(message) {
  return CONTINUATION.test(message || '') || CORRECTION.test(message || '');
}

// 明确「放开/重置」方向:回到开放推荐(优先级高于沿用)
const OPEN_RESET = /(随便|都行|随意|无所谓|不限|任意|啥都|什么都|换个口味|换种风格|换个方向|别限定|不要限定|放开)/;
export function isOpenReset(message) {
  return OPEN_RESET.test(message || '');
}

/**
 * 从用户消息检测「方向」。检测不到(纯开放式/纯风格情绪)返回 null。
 * @param {string} message
 * @param {{artistNames?: string[]}} opts 曲库艺人名(用于点名艺人匹配)
 * @returns {null | {langMatch:string|null, gender:string|null, artists:string[], raw:string}}
 */
export function detectDirection(message, { artistNames = [] } = {}) {
  const msg = message || '';
  const low = msg.toLowerCase();

  let langMatch = null;
  for (const [lang, kws] of LANG_KEYWORDS) {
    if (kws.some(k => low.includes(k))) { langMatch = lang; break; }
  }

  let gender = null;
  for (const [g, kws] of GENDER_KEYWORDS) {
    if (kws.some(k => low.includes(k))) { gender = g; break; }
  }

  // 点名艺人:规范化后子串匹配(长度≥2,避免误命中)
  const artists = [];
  const nmsg = norm(msg);
  for (const a of artistNames) {
    const na = norm(a);
    if (na.length >= 2 && nmsg.includes(na)) artists.push(a);
  }

  if (!langMatch && !gender && !artists.length) return null;
  return { langMatch, gender, artists, raw: msg.trim() };
}

/**
 * 一首候选歌是否符合当前方向。用于「绝不用跑偏方向的歌凑数」。
 *  - 点名艺人:艺人匹配即过(艺人优先于语种)。
 *  - 仅语种:按 trackLang(艺人语种表优先,歌名脚本兜底)判定。
 *  - 仅性别 / 仅情绪:server 无法判定 → 返回 true,交给 LLM。
 */
export function songMatchesDirection(title, artist, dir) {
  if (!dir) return true;
  if (dir.artists && dir.artists.length) {
    const an = norm(artist);
    if (dir.artists.some(a => an.includes(norm(a)))) return true;
    if (!dir.langMatch) return false;  // 点了艺人又没语种兜底 → 不匹配
  }
  if (dir.langMatch) return trackLang(title, artist) === dir.langMatch;
  return true;
}

// 给 prompt / 日志用的人类可读方向描述
export function describeDirection(dir) {
  if (!dir) return '(无)';
  const parts = [];
  const LANG_CN = { chinese: '中文/国语', english: '英文/欧美', korean: '韩语', japanese: '日语' };
  if (dir.langMatch) parts.push(LANG_CN[dir.langMatch] || dir.langMatch);
  if (dir.gender) parts.push(dir.gender === 'female' ? '女声' : '男声');
  if (dir.artists && dir.artists.length) parts.push(`艺人:${dir.artists.join('、')}`);
  return parts.join(' · ') || dir.raw || '(无)';
}

// 方向 → 用于 RAG 向量检索的关键词串(替代 "下一批" 这种空查询)
export function directionQuery(dir) {
  if (!dir) return '';
  const LANG = { chinese: '中文 国语 华语', english: '英文 欧美', korean: '韩语 kpop', japanese: '日语' };
  const parts = [];
  if (dir.langMatch) parts.push(LANG[dir.langMatch] || dir.langMatch);
  if (dir.gender) parts.push(dir.gender === 'female' ? '女声 女生' : '男声 男生');
  if (dir.artists && dir.artists.length) parts.push(dir.artists.join(' '));
  return parts.join(' ');
}

// 独立自测:node server/direction.js
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const A = (cond, label) => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  const artistNames = ['孙燕姿', '田馥甄', 'Vicetone', 'By2'];

  const d1 = detectDirection('现在我要听国语女声', { artistNames });
  A(d1 && d1.langMatch === 'chinese' && d1.gender === 'female', '国语女声 → chinese+female');

  const d2 = detectDirection('下一批', { artistNames });
  A(d2 === null, '下一批 → null direction');
  A(isContinuation('下一批'), '下一批 → continuation');

  const d3 = detectDirection('换点英文男声', { artistNames });
  A(d3 && d3.langMatch === 'english' && d3.gender === 'male', '英文男声 → english+male');

  const d4 = detectDirection('放点孙燕姿', { artistNames });
  A(d4 && d4.artists.includes('孙燕姿'), '放点孙燕姿 → artist match');

  A(songLang('开始懂了') === 'chinese', 'songLang 开始懂了 = chinese');
  A(songLang('Sad Sometimes') === 'english', 'songLang Sad Sometimes = english');
  A(songLang('夏日漱石 (Summer Cozy Rock)') === 'chinese', 'songLang mixed-han = chinese');

  const dir = { langMatch: 'chinese', gender: 'female', artists: [], raw: '国语女声' };
  A(songMatchesDirection('寂寞寂寞就好', '田馥甄', dir) === true, 'match 寂寞寂寞就好 in chinese');
  A(songMatchesDirection('Sad Sometimes', 'Alan Walker / 黄霄雲', dir) === false, 'reject Sad Sometimes (latin title) in chinese');
  A(songMatchesDirection('Where To Start', 'Vincentz', dir) === false, 'reject Where To Start in chinese');

  A(carriesDirection('怎么又是feel good，不是让你第一首放safe with me吗'), 'correction → carries direction');
  A(carriesDirection('下一批'), 'continuation → carries direction');
  A(!carriesDirection('推荐几首晚上的'), 'fresh request → does NOT carry (clears)');
  A(isOpenReset('随便来点都行'), 'open/reset detected');
  A(!isOpenReset('放点孙燕姿'), 'artist request is not a reset');

  console.log('direction:', describeDirection(d1));
}
