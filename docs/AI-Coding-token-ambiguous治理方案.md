# AI-Coding Token Ambiguous 治理方案

## 1. 背景

AI Coding 轮次记录完成后，会通过 token 同步任务从 Codex / Claude 本地日志中回填真实 token。

当前系统中存在一类状态：

```text
tokenSyncStatus = ambiguous
```

它表示系统已经找到了多个可能匹配的 token 候选，但缺少足够证据判断哪一个才属于当前 round。它不是“完全没拿到 token”，而是“拿到了多个候选，不敢自动绑定”。

如果长期保留大量 ambiguous，会带来两个问题：

1. 总览页 token 完整率偏低，看起来像大量数据缺失。
2. 有些真实 token 已经在候选里，但没有进入有效统计。

如果强行把所有 ambiguous 自动绑定，又会带来更严重的问题：

1. 同一条 token event 可能被多个 round 重复统计。
2. token 可能绑定到错误 round，导致需求、模型、时间维度统计失真。

因此治理目标不是简单“消灭 ambiguous”，而是把 ambiguous 拆成可自动处理、需人工处理、应排除统计三类。

## 2. 目标

最终目标：

1. 能自动确定的 ambiguous 自动转为 `synced`。
2. 不能自动确定的 ambiguous 不再混在一个模糊状态里。
3. 总览页能清楚区分：
   - 已同步 token
   - 待人工确认
   - 候选冲突
   - 无日志证据
4. token 完整率不要被“证据不足但不可自动判断”的历史数据长期污染。
5. 保留人工修正入口，后续可以手动绑定候选恢复统计。

## 3. 状态设计

建议将 token 状态扩展为：

| 状态 | 含义 | 是否计入有效 token | 是否影响完整率 |
| --- | --- | --- | --- |
| `synced` | 已成功绑定 token | 是 | 是 |
| `pending` | 等待下一轮日志扫描 | 否 | 是 |
| `not_found` | 没找到候选 token 日志 | 否 | 是 |
| `needs_review` | 找到多个候选，但没有明显最优，需要人工确认 | 否 | 单独展示，可选择不计入完整率分母 |
| `conflict` | 候选 token 已经被其他 round 使用 | 否 | 单独展示，可选择不计入完整率分母 |
| `failed` | 同步脚本执行失败 | 否 | 是 |

保留兼容：

```text
ambiguous
```

作为旧状态，后续同步任务会继续尝试重扫，并迁移为：

- `synced`
- `needs_review`
- `conflict`

## 4. 源头治理：记录 turnId

最根本的解决方案，是在调用 `record_ai_coding_round` 时写入当前 Codex / Claude 的精确上下文：

```json
{
  "metadata": {
    "client": "codex",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "threadId": "019e...",
    "turnId": "019e..."
  }
}
```

同步脚本匹配优先级：

1. `exact_tool_call`：日志里能直接找到本 round 的 MCP tool call result。
2. `turn_id`：metadata.turnId 与日志 turnId 精确相同。
3. `prompt_tool_call`：Claude 日志里能通过 prompt/tool call 证据匹配。
4. `time_window`：只能通过时间窗口推断。

只要前两类占比提升，ambiguous 会大幅下降。

## 5. 自动消歧规则

当一个 round 找到多个候选时，脚本不应立即标记 ambiguous，而是先打分。

### 5.1 候选过滤

先排除明显不可用候选：

1. 候选 token event 已经被其他 round 绑定。
2. 候选所属 client 与 round.metadata.client 不一致。
3. 候选项目路径与 round.metadata.projectPath 不一致。
4. 候选时间与 round 时间完全不重叠，且距离超过阈值。

### 5.2 候选打分

建议评分项：

| 维度 | 规则 |
| --- | --- |
| 匹配质量 | `exact_tool_call` > `turn_id` > `prompt_tool_call` > `time_window` |
| 时间重叠 | 候选时间与 round 时间重叠越多分越高 |
| 时间距离 | 候选中心时间离 round 中心时间越近分越高 |
| 项目路径 | 完全相同加分 |
| 模型一致 | 候选 model 与 round model 一致加分 |
| token 合理性 | totalTokens > 0 且未异常偏大加分 |

### 5.3 自动绑定条件

满足任一条件可自动绑定：

1. 存在唯一 `exact_tool_call` 候选。
2. 存在唯一 `turn_id` 候选。
3. 最高分候选与第二名分差超过阈值。
4. 过滤后只剩一个可用候选。

否则不自动绑定，进入 `needs_review`。

## 6. 冲突处理

如果某个候选 token event 已经被其他 round 使用：

```text
codex token usage event already assigned to round 37
```

不要强行重复绑定。

处理策略：

1. 如果当前 round 还有其他未占用候选，继续参与打分。
2. 如果所有候选都已被占用，标记为 `conflict`。
3. Dashboard 展示冲突目标 round，提供跳转查看。
4. 人工确认后，可选择：
   - 保持原绑定
   - 解绑旧 round 后绑定当前 round
   - 忽略当前 round 的 token 统计

## 7. Dashboard 展示调整

总览页建议展示以下卡片：

| 指标 | 含义 |
| --- | --- |
| Token completeness | `synced / 可判定轮次` |
| Synced | 已同步 token 的 round 数 |
| Pending | 等待扫描 |
| Not found | 没找到日志候选 |
| Needs review | 多候选，需要人工确认 |
| Conflict | 候选已被其他 round 占用 |
| Failed | 同步脚本失败 |

完整率建议改为：

```text
synced / (synced + pending + not_found + failed)
```

`needs_review` 和 `conflict` 单独展示，不默认计入完整率分母。这样能避免历史模糊数据长期拉低完整率，同时不隐藏问题。

## 8. 详情页处理入口

Round 详情页对 `needs_review` / `conflict` 提供操作：

1. 查看候选 token event 列表。
2. 展示每个候选：
   - totalTokens
   - inputTokens
   - outputTokens
   - matchQuality
   - startedAt / endedAt
   - turnId
   - 是否已被其他 round 使用
3. 支持 `Bind`。
4. 支持 `Ignore for token completeness`。
5. 支持重新扫描当前 round。

## 9. 同步脚本改造步骤

### 第一步：保留当前自动消歧

当前已经完成：

- `ambiguous` 进入重扫队列。
- 多候选按匹配质量、时间重叠、时间距离打分。
- 明显最优时自动绑定。
- 缺少系统 `sqlite3` CLI 时，用 Node `sql.js` 读取 SQLite。

### 第二步：增加状态迁移

将无法自动消歧的旧 ambiguous 迁移为：

```text
needs_review
```

候选全部冲突时迁移为：

```text
conflict
```

### 第三步：扩展筛选项

`/api/filters` 返回：

```json
{
  "tokenSyncStatuses": [
    "pending",
    "synced",
    "not_found",
    "needs_review",
    "conflict",
    "failed"
  ]
}
```

兼容旧数据时也可暂时保留：

```text
ambiguous
```

### 第四步：调整 summary

`/api/summary` 增加：

```json
{
  "tokenNeedsReviewRounds": 12,
  "tokenConflictRounds": 3,
  "tokenReviewExcludedRounds": 15,
  "tokenCompletenessRate": 0.96
}
```

### 第五步：Dashboard 文案替换

将 `Ambiguous` 改为更直观的：

```text
Needs review
```

将候选占用场景展示为：

```text
Conflict
```

## 10. 数据修复策略

历史 ambiguous 处理流程：

1. 执行一次全量重扫：

```bash
npm run tokens:sync:codex
```

2. 自动消歧能解决的直接转 `synced`。
3. 剩余 ambiguous：
   - 有可用候选但无法决策：转 `needs_review`
   - 候选全部被占用：转 `conflict`
4. Dashboard 只把 `needs_review/conflict` 作为待处理事项展示。
5. 人工逐步处理剩余条目。

## 11. 推荐落地顺序

1. 完成脚本状态迁移：`ambiguous` -> `needs_review/conflict`。
2. 更新 Dashboard 总览指标。
3. 更新详情页筛选和候选展示。
4. 增加人工忽略完整率的按钮。
5. 后续再优化 MCP 记录，补齐 `turnId`。

## 12. 最终效果

治理后，系统会变成：

1. 大部分 round 自动同步 token。
2. 可自动判断的 ambiguous 自动变成 synced。
3. 不能判断的条目不再混在 ambiguous，而是明确展示为 `needs_review` 或 `conflict`。
4. 总览完整率更可信。
5. 不会为了“消灭 ambiguous”而错绑或重复统计 token。

