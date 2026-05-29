{{USER_MESSAGE}}

## 当前 now-playing
{{NOW_PLAYING}}

## 当前 queue
{{CURRENT_QUEUE}}

## 时间
{{TS}} ({{DOW}})

## 探索档位
当前档位 = {{MODE_NAME}}(系数 {{EXPLORATION_PCT}})
{{MODE_BRIEF}}
**本批分配(硬要求,server 会按真实曲库校验):你收藏内 {{FAMILIAR_TARGET}} 首 + 全新(不在你收藏里){{NEW_TARGET}} 首。**
「全新」那部分的参考构成(软,可偏离): recommend {{REC_PCT}}% / wildcard(相似 + 同艺人深挖) {{WILD_PCT}}%。

## RAG 检索结果 — evidence

### 相关曲库 (top-{{N_SONGS}}, source_pool=library 必须从这里取)
{{LIBRARY_SLICE}}

### 网易云每日推荐池 (source_pool=recommend 必须从这里取)
以下是服务端用 Elliot 账号拉取的网易云「每日推荐」,每轮自动刷新——已接入,你无需登录。列表为空才表示今天没拉到。
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
