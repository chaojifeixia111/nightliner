// server/budget-enforcer.js
// 1. enforceSourcePoolBudget: 检查 LLM 返回的 play[] 实际 source_pool 分布
// 2. checkReasonHallucination: 检查 reason 里是否出现 evidence 外的专辑/年代/合作艺人

export function enforceSourcePoolBudget(plays, target, threshold = 0.10) {
  // target: { lib, rec, wild } 百分比
  if (!plays.length) return { ok: true, deviation: 0, hint: '' };
  const counts = { library: 0, recommend: 0, wildcard: 0 };
  for (const p of plays) {
    const k = p.source_pool || 'wildcard';
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = plays.length;
  const actual = {
    lib: counts.library / total,
    rec: counts.recommend / total,
    wild: counts.wildcard / total,
  };
  const deviation = Math.max(
    Math.abs(actual.lib - target.lib / 100),
    Math.abs(actual.rec - target.rec / 100),
    Math.abs(actual.wild - target.wild / 100),
  );
  if (deviation <= threshold) return { ok: true, deviation, hint: '' };

  const hint = `上一轮 source_pool 分布 (lib:${(actual.lib * 100).toFixed(0)}% rec:${(actual.rec * 100).toFixed(0)}% wild:${(actual.wild * 100).toFixed(0)}%) 偏离目标 (lib:${target.lib}% rec:${target.rec}% wild:${target.wild}%). 重新分配,严格命中比例.`;
  return { ok: false, deviation, hint };
}

// 简单启发式: 检测 reason 里出现的 4 位年份 / 看似专辑名 (引号或斜体) / 大写人名词组
// 这些 token 必须在 evidence 字符串里出现过, 否则视为幻觉
export function checkReasonHallucination(plays, evidence) {
  const ev = (evidence || '').toLowerCase();
  const hits = [];
  for (let i = 0; i < plays.length; i++) {
    const reason = (plays[i].reason || '').trim();
    if (!reason) continue;
    const suspects = extractSuspectTerms(reason);
    const missing = suspects.filter(t => !ev.includes(t.toLowerCase()));
    if (missing.length) {
      hits.push({ play_idx: i, suspect_terms: missing });
    }
  }
  return hits;
}

function extractSuspectTerms(reason) {
  const out = [];
  // 1. 4 位年代
  for (const m of reason.matchAll(/\b(19|20)\d{2}\b/g)) out.push(m[0]);
  // 2. 《X》或 "X" 包裹的专辑/歌名
  for (const m of reason.matchAll(/[《"](.+?)[》"]/g)) out.push(m[1]);
  // 3. "X 那张专辑" / "X 那首" / "X 专辑"
  for (const m of reason.matchAll(/(.+?)(?:那张专辑|那首歌|专辑)/g)) {
    const candidate = m[1].slice(-20).trim();
    if (candidate.length >= 2) out.push(candidate);
  }
  return out;
}
