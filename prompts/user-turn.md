{{USER_MESSAGE}}

## 当前 now-playing
{{NOW_PLAYING}}

## 当前 queue
{{CURRENT_QUEUE}}

## 时间
{{TS}} ({{DOW}})

## 探索系数
当前 = {{EXPLORATION_PCT}}%
目标分布: library {{LIB_PCT}}% / recommend {{REC_PCT}}% / wildcard {{WILD_PCT}}%

## RAG 检索结果 — evidence

### 相关曲库 (top-{{N_SONGS}}, source_pool=library 必须从这里取)
{{LIBRARY_SLICE}}

### 网易云推荐池 (source_pool=recommend 必须从这里取)
{{RECOMMEND_POOL}}

### 相似歌曲探索候选 (source_pool=wildcard 优先从这里取 —— 参考,非指令,可弃可重排)
基于你 now-playing / 最近在听的歌的真实近邻,已过滤掉 anti/cooldown/最近播放/不喜欢。
{{EXPLORE_POOL}}

### 相关历史反馈
{{FEEDBACK_SLICE}}

### 相关 taste 片段
{{TASTE_SLICE}}

### 相关 life-stages 片段
{{LIFE_STAGE_SLICE}}

### 相关 mood-rules 片段
{{MOOD_RULE_SLICE}}

### 相关 vibe-anchors 片段
{{VIBE_ANCHOR_SLICE}}

### 相关历史对话 (语义检索)
{{SEMANTIC_HISTORY}}

## 硬约束 (全量, 不走 RAG)

### Anti-list (永久禁播)
{{ANTI_LIST}}

### Cooldown (90 天降权)
{{COOLDOWNS}}

### RECENT_PLAYS (不可重复)
{{RECENT_PLAYS}}

---

按 system prompt 的约束输出 {{N}} 首推荐 (intent=recommend) 或对话 (intent=chat) 或反馈记录 (intent=feedback).
