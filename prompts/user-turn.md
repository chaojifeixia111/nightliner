{{USER_MESSAGE}}

## 当前 now-playing
{{NOW_PLAYING}}

## 当前 queue
{{CURRENT_QUEUE}}

## 时间
{{TS}} ({{DOW}})

## 方向(硬约束,优先级高于探索档位)
{{DIRECTION}}
- 若上面不是「(无…)」:这一批**每一首**都必须落在该方向内(语种 / 性别 / 艺人)。档位只决定该方向内「熟悉↔全新」的配比,不能拿它当借口塞别的语种 / 方向。
- 方向内的「全新」歌已由 server 备在下面「每日推荐池」「相似探索候选」里(都已按方向过滤);不够就多挑方向内的库内歌,**绝不**用跑偏方向的歌凑数,也**绝不**把一首歌谎称成该方向(例:别把英文歌说成「国语女声」)。

## 探索档位
当前档位 = {{MODE_NAME}}(系数 {{EXPLORATION_PCT}})
{{MODE_BRIEF}}
**本批分配(server 会按真实曲库校验):你收藏内 {{FAMILIAR_TARGET}} 首 + 全新(不在你收藏里){{NEW_TARGET}} 首。** 有方向时,这两个数已是「方向内」的配比;方向内全新供给不足时该比例自动让位(多给方向内库内歌,而不是塞跑偏方向的)。
「全新」那部分的参考构成(软,可偏离): recommend {{REC_PCT}}% / wildcard(相似 + 同艺人深挖) {{WILD_PCT}}%。

## 你最近确认的口味(运行时 love 积累 —— 优先于下方静态档案)
{{LIVE_TASTE}}

## RAG 检索结果 — evidence

### 相关曲库 ({{N_SONGS}}首, source_pool=library 必须从这里取;有方向时这里已是你收藏中符合方向的歌)
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

### 不喜欢(wrong_vibe —— 别再推)
{{DEMOTED}}

### RECENT_PLAYS (不可重复)
{{RECENT_PLAYS}}

---

按 system prompt 的约束输出 {{N}} 首推荐 (intent=recommend) 或对话 (intent=chat) 或反馈记录 (intent=feedback).
