// tests/direction.test.js
// 方向语种判定:艺人感知 —— 拉丁标题的 K-pop / J-pop 不应被歌名脚本误判成 english。
// 回归点:英文 EDM(非韩/日艺人)绝不能漏进 korean 方向;短 key("ive")不能子串误命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { songMatchesDirection, trackLang, isAcknowledgment, detectVerbatim, detectPinnedFirst, resolveDirectionState, isGenderReset } from '../server/direction.js';

const KOR = { langMatch: 'korean', gender: null, artists: [], raw: 'kpop' };
const KOR_F = { langMatch: 'korean', gender: 'female', artists: [], raw: 'kpop女声' };
const KOR_M = { langMatch: 'korean', gender: 'male', artists: [], raw: 'kpop男声' };
const JPN = { langMatch: 'japanese', gender: null, artists: [], raw: 'jpop' };
const CHN = { langMatch: 'chinese', gender: null, artists: [], raw: '国语' };
const CHN_F = { langMatch: 'chinese', gender: 'female', artists: [], raw: '国语女声' };
const CHN_M_ARTISTS = { langMatch: 'chinese', gender: 'male', artists: ['陶喆', '李荣浩', '林俊杰'], raw: '华语男声 陶喆 林俊杰 李荣浩' };

test('Latin-titled K-pop by known artist matches korean direction', () => {
  // 用户曲库真实存在、且 [love] 过的歌 —— 现在被歌名脚本判成 english 而漏掉
  assert.equal(songMatchesDirection('Talk that Talk', 'TWICE', KOR), true);
  assert.equal(songMatchesDirection('What is Love?', 'TWICE', KOR), true);
  assert.equal(songMatchesDirection('Off The Record', 'IVE', KOR), true);
  assert.equal(songMatchesDirection('Good Parts (when the quality is bad but I am)', 'LE SSERAFIM', KOR), true);
});

test('Latin-titled female K-pop matches korean female direction', () => {
  assert.equal(songMatchesDirection('Talk that Talk', 'TWICE', KOR_F), true);
});

test('known male K-pop artists do not satisfy female direction', () => {
  assert.equal(songMatchesDirection('Y, Why...', 'CNBLUE', KOR_F), false);
  assert.equal(songMatchesDirection("LET'S NOT FALL IN LOVE", 'BIGBANG', KOR_F), false);
});

test('known female K-pop artists do not satisfy male direction', () => {
  assert.equal(songMatchesDirection('Talk that Talk', 'TWICE', KOR_M), false);
  assert.equal(songMatchesDirection('Off The Record', 'IVE', KOR_M), false);
});

test('unknown gender stays allowed after language match', () => {
  assert.equal(songMatchesDirection('노래', 'Unknown K Artist', KOR_F), true);
});

test('partially-known collaborations are not hard rejected by gender', () => {
  assert.equal(songMatchesDirection('珊瑚海', '周杰伦 / 梁心颐', CHN_F), true);
});

test('Hangul-titled K-pop still matches korean (no regression from title path)', () => {
  assert.equal(songMatchesDirection('바빠', 'SISTAR', KOR), true);
  assert.equal(songMatchesDirection('눈,코,입', '太阳', KOR), true);
});

test('Latin-titled J-pop by known artist matches japanese direction', () => {
  assert.equal(trackLang('Lemon', '米津玄師'), 'japanese');
  assert.equal(songMatchesDirection('Lemon', '米津玄師', JPN), true);
});

test('English EDM by non-K/J artist does NOT bleed into korean direction', () => {
  assert.equal(songMatchesDirection('Feel Good', 'Gryffin / ILLENIUM / Daya', KOR), false);
  assert.equal(songMatchesDirection('Try', 'Colbie Caillat', KOR), false);
});

test('short artist key "ive" must not substring-match unrelated artists', () => {
  // 'Stive Morgan' 含子串 'ive',绝不能被判成 korean
  assert.equal(trackLang('Witch Dance', 'Stive Morgan'), 'english');
  assert.equal(songMatchesDirection('Witch Dance', 'Stive Morgan', KOR), false);
});

test('known Korean artist in a collab segment is detected', () => {
  // 多艺人串,韩/日艺人不在首位也应识别
  assert.equal(trackLang('Some Collab', 'DJ Snake / TWICE'), 'korean');
});

test('chinese direction unaffected (Han-title still chinese)', () => {
  assert.equal(songMatchesDirection('寂寞寂寞就好', '田馥甄', CHN), true);
  assert.equal(songMatchesDirection('Talk that Talk', 'TWICE', CHN), false);
});

test('resolveDirectionState merges partial continuation with previous language', () => {
  const next = resolveDirectionState(KOR, '下一批，我只要女声的。');
  assert.equal(next.langMatch, 'korean');
  assert.equal(next.gender, 'female');
});

test('resolveDirectionState preserves previous gender on correction language-only turns', () => {
  const next = resolveDirectionState(CHN_F, '我说了中文，你怎么还推英文');
  assert.equal(next.langMatch, 'chinese');
  assert.equal(next.gender, 'female');
});

test('resolveDirectionState keeps unmentioned female constraint on KPOP correction', () => {
  const next = resolveDirectionState(KOR_F, '我要听KPOP啊，你不要给我重新默认的推荐');
  assert.equal(next.langMatch, 'korean');
  assert.equal(next.gender, 'female');
});

test('resolveDirectionState clears only gender for explicit gender reset', () => {
  assert.equal(isGenderReset('KPOP 不限男女'), true);
  const next = resolveDirectionState(KOR_F, 'KPOP 不限男女');
  assert.equal(next.langMatch, 'korean');
  assert.equal(next.gender, null);
});

test('resolveDirectionState treats broad language requests as fresh direction resets', () => {
  const artistNames = ['陶喆', '李荣浩', '林俊杰', '陈奕迅'];

  const chinese = resolveDirectionState(CHN_M_ARTISTS, '来一批华语流行', { artistNames });
  assert.equal(chinese.langMatch, 'chinese');
  assert.equal(chinese.gender, null);
  assert.deepEqual(chinese.artists, []);

  const english = resolveDirectionState(CHN_M_ARTISTS, '来一批英文流行', { artistNames });
  assert.equal(english.langMatch, 'english');
  assert.equal(english.gender, null);
  assert.deepEqual(english.artists, []);
});

test('resolveDirectionState keeps old direction only for pure continuation', () => {
  const next = resolveDirectionState(CHN_M_ARTISTS, '下一批');
  assert.equal(next.langMatch, 'chinese');
  assert.equal(next.gender, 'male');
  assert.deepEqual(next.artists, ['陶喆', '李荣浩', '林俊杰']);
});

test('resolveDirectionState treats explicit artist requests as fresh hard targets', () => {
  const next = resolveDirectionState(KOR_F, '来一批林俊杰', { artistNames: ['林俊杰'] });
  assert.equal(next.langMatch, null);
  assert.equal(next.gender, null);
  assert.deepEqual(next.artists, ['林俊杰']);
});

// Layer 3: 纯确认词整句 = 闲聊,不该触发重新推荐("好的" 被当 recommend → 重复推 바빠)
test('isAcknowledgment: 整句只是确认词 → true', () => {
  for (const m of ['好的', '好', '嗯', '嗯嗯', '行', '可以', 'ok', 'OK', '没问题', '收到', '好的~', '好的。']) {
    assert.equal(isAcknowledgment(m), true, m);
  }
});
test('isAcknowledgment: 带新请求 / 实质内容 → false', () => {
  for (const m of ['好的，再来几首慢的', '换一批', '推荐几首晚上的', '好听吗', '好的吗']) {
    assert.equal(isAcknowledgment(m), false, m);
  }
});

// Layer 3: 显式 verbatim —— "直接放每日推荐" / "第一首放 X" 应跳过比例换槽
test('detectVerbatim: 显式直接/原样放每日推荐 → true', () => {
  assert.equal(detectVerbatim('直接放每日推荐'), true);
  assert.equal(detectVerbatim('原样放今天的每日推荐'), true);
  assert.equal(detectVerbatim('按顺序放每日推荐'), true);
});
test('detectPinnedFirst: 点名第一首 → true (moved from verbatim)', () => {
  assert.equal(detectPinnedFirst('第一首放 Shelter'), true);
  assert.equal(detectPinnedFirst('第一首要 Long Shot'), true);
  assert.equal(detectPinnedFirst('不是让你第一首放 safe with me 吗'), true);
});
test('detectVerbatim: 普通推荐 / 默认仍由 agent 策展 → false', () => {
  assert.equal(detectVerbatim('放一下今天的每日推荐'), false); // 无"直接/原样"线索 → 默认策展
  assert.equal(detectVerbatim('放点国语女声'), false);
  assert.equal(detectVerbatim('换一批'), false);
});

test('detectPinnedFirst catches natural phrasings', () => {
  for (const m of ['第一首放偏爱', '第一首我要听偏爱', '第一首歌要偏爱', '第一首是偏爱', '第一首先放 X']) {
    assert.equal(detectPinnedFirst(m), true, m);
  }
});
test('detectPinnedFirst does not fire on plain requests', () => {
  for (const m of ['来一批千禧华语', '换一批', '放点国语女声']) {
    assert.equal(detectPinnedFirst(m), false, m);
  }
});
test('detectVerbatim now only fires on 直接/原样, not 第一首', () => {
  assert.equal(detectVerbatim('直接放每日推荐'), true);
  assert.equal(detectVerbatim('第一首放偏爱'), false); // 现在归 detectPinnedFirst
});
