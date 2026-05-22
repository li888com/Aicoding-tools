# Codex 每轮对话自动采集准确性问题记录

## 1. 背景

当前讨论的自动采集方案主要围绕 Codex 本机日志展开：

```text
~\.codex\logs_2.sqlite
~\.codex\sessions\...\rollout-*.jsonl
```

目标是自动统计每一轮 AI Coding 对话的：

- 用户 prompt
- startedAt / endedAt
- token 用量
- 本轮代码变更行数
- 项目、需求、模型等上下文

经过验证，单独依赖 `logs_2.sqlite` 中的 token 完成事件无法保证每一轮对话都精确切分，尤其无法保证代码行数和真实对话轮次一一对应。

## 2. 当前 `watch --tool codex` 的基本原理

当前 watcher 的核心思路是：

```text
1. 启动时记录当前 Git baseline
2. 轮询 ~\.codex\logs_2.sqlite
3. 发现新的 response.completed token 事件
4. 认为一轮对话完成
5. 立刻做 Git snapshot
6. 用 baseline -> snapshot 的 diff 统计代码行数
7. 写入本地 turn 记录并同步
8. 把当前 snapshot 作为下一轮 baseline
```

`logs_2.sqlite` 比较适合提供：

- response.completed
- inputTokens
- outputTokens
- cachedTokens
- reasoningTokens
- toolTokens
- conversationId
- eventTimestamp

但它不适合作为唯一的对话边界来源。

## 3. 已确认的问题

### 3.1 token 日志可能延迟

如果第一轮对话已经完成，但 token 事件延迟到第二轮对话之后才写入 `logs_2.sqlite`，则 watcher 会在错误的时间点切 Git diff。

示例：

```text
09:00 第一轮对话完成，代码改了 100 行
09:01 第二轮对话开始，又改了 50 行
09:02 第一轮 token 日志才出现在 logs_2.sqlite
```

此时如果以 token 日志出现时间作为第一轮结束时间，就会把第一轮统计成：

```text
100 + 50 = 150 行
```

第二轮后续可能被统计成 0 行或少算。

结论：

```text
token 日志适合回填 token，不适合单独决定代码 diff 边界。
```

### 3.2 同一轮 response 可能有多条日志

同一轮 Codex response 可能同时出现多类日志：

```text
codex_otel.trace_safe
codex_otel.log_only
codex_api::sse::responses
codex_core::stream_events_utils
codex_client::transport
```

其中部分日志带 token，部分日志不带 token。带 token 的日志也可能重复出现。

因此必须做去重，不能把每一条 `response.completed` 都当作一轮独立对话。

推荐去重签名：

```text
conversationId
turnId
occurredAt
inputTokens
outputTokens
cachedTokens
reasoningTokens
toolTokens
```

### 3.3 token 事件中的 turnId 可能为空

实际样本中，带 token 的 `response.completed` 事件可能只有 `conversationId`，没有 `turnId`。

影响：

- 可以统计 token
- 可以按时间大致匹配
- 但无法稳定绑定到具体 prompt
- 多轮连续对话时容易进入 ambiguous

### 3.4 prompt 不应主要从 `logs_2.sqlite` 获取

prompt 更稳定的来源是：

```text
~\.codex\sessions\...\rollout-*.jsonl
```

其中可见：

```text
response_item message user
event_msg user_message
```

这类记录能够拿到用户原始 prompt。

### 3.5 session jsonl 更接近真实对话生命周期

`rollout-*.jsonl` 中还可以看到：

```text
event_msg task_started
event_msg task_complete
response_item message assistant
```

这些事件比 token 日志更适合切分每一轮对话。

其中 `task_complete` 通常带有 `turn_id`，适合作为一轮结束信号。

### 3.6 代码行数无法只靠事后累计 diff 精确归因

代码行数统计依赖 Git baseline。

如果 baseline 和 end snapshot 的边界不准确，则代码行数一定不准确。

典型不准场景：

- 用户手动同时修改文件
- 多个 Codex 会话同时修改同一个仓库
- token 日志延迟导致切轮滞后
- AI 回复完成后仍有异步工具落盘
- 两轮对话间隔很短，事件顺序交错
- watcher 中途启动，baseline 已经包含未归属改动
- 当前 worktree 本身不干净

## 4. 数据源能力边界

| 数据源 | 适合拿什么 | 不适合拿什么 |
| --- | --- | --- |
| `logs_2.sqlite` | token、response.completed、conversationId、eventTimestamp | 精确 prompt、稳定 turn 边界、代码 diff 边界 |
| `sessions/rollout-*.jsonl` | prompt、assistant 回复、task_started、task_complete、turn_id、对话顺序 | 最终 token 用量 |
| Git snapshot / diff | 代码行数、文件变化 | 判断变化一定属于哪一轮 AI |
| MCP 主动上报 | 当前 prompt、当前轮时间、可控 metadata | 依赖工具可用和模型遵守调用规则 |

## 5. 推荐的准确采集方案

### 5.1 最优方案：MCP 主动上报

在每轮 AI Coding 正常结束前，由 Codex 当前上下文主动调用：

```text
record_ai_coding_round
```

优点：

- promptText 直接来自当前用户请求
- startedAt / endedAt 由当前轮真实上下文决定
- 结束前可以现场计算 Git diff
- metadata 可以写入 threadId / turnId / projectPath
- token 暂时不可用时可以先填 0，后续再回填

缺点：

- 依赖 MCP tool 暴露
- 依赖模型按规则调用
- 如果调用失败，需要保留失败告警

### 5.2 现实自动化方案：session 切轮 + token 回填

如果希望后台自动监听，不依赖每轮主动调用 MCP，则推荐改造为：

```text
1. 监听 sessions/rollout-*.jsonl 新增行
2. 发现 user_message / task_started 时记录本轮 baseline
3. 发现 task_complete 时立刻做 end snapshot
4. 用 baseline -> end snapshot 统计代码行数
5. 从 user_message 读取 promptText
6. 从 task_complete 读取 turnId
7. 后续从 logs_2.sqlite 按 conversationId / turnId / 时间窗口回填 token
```

这个方案的关键原则：

```text
session jsonl 负责切轮和 prompt
Git snapshot 负责当场统计代码
logs_2.sqlite 负责延迟补 token
```

不要让 token 日志出现时间决定代码行数边界。

### 5.3 CLI wrapper 方案

如果只统计命令行 Codex，可以包装 Codex 启动命令：

```text
before: 记录 baseline
run: 执行 Codex
after: 记录 snapshot 并统计 diff
```

该方案适合 CLI，不适合 VS Code 内嵌对话，因为 VS Code 中的每条 prompt 不一定经过 wrapper。

## 6. 推荐状态设计

为了避免假装所有数据都精确，建议每轮记录增加采集状态。

| 状态 | 含义 |
| --- | --- |
| `completed` | prompt、turn 边界、代码 diff、token 均已可信匹配 |
| `pending_tokens` | prompt 和代码行数已记录，token 等待日志回填 |
| `needs_review` | 找到多个候选 token 或多个候选 turn，需要人工确认 |
| `code_ambiguous` | 代码 diff 期间存在用户手动修改、多会话冲突或边界不确定 |
| `token_not_found` | 超过等待窗口仍未找到 token 日志 |
| `failed` | 采集或同步过程失败 |

## 7. 匹配优先级建议

token 回填时建议按以下优先级匹配：

```text
1. exact tool call evidence
2. turnId 精确匹配
3. conversationId + turn 时间窗口
4. conversationId + prompt 附近时间窗口
5. 普通时间窗口
```

只有低优先级匹配时，不应直接标记为完全可信，应进入 `needs_review` 或降低 confidence。

## 8. 对当前 watcher 的结论

当前只基于 `logs_2.sqlite` 的 `watch --tool codex` 可以做到：

```text
发现 Codex response.completed
统计 token
大致按完成事件切分轮次
用 Git 快照估算代码变更
```

但不能承诺：

```text
每轮对话都能 100% 精确切分
每个 prompt 都能稳定绑定
每轮代码行数都能精确归因
token 延迟时仍然不串轮
多会话并发时仍然不混淆
```

因此，当前方案可以作为 MVP 或辅助统计，但不应作为“精确到每一轮对话”的最终方案。

## 9. 后续改造建议

优先级从高到低：

1. 新增 `watch-session --tool codex`，监听 `sessions/rollout-*.jsonl` 切轮。
2. 将 `logs_2.sqlite` 从切轮触发源降级为 token 回填源。
3. 每轮记录写入 `threadId`、`turnId`、`sessionFile`、`promptEventOffset`、`completeEventOffset`。
4. 在 metadata 中记录 `codeStatsSource`、`codeStatsPrecision`、`matchStrategy`、`confidence`。
5. 增加 `pending_tokens`、`needs_review`、`code_ambiguous` 等状态。
6. 多会话并发时按 `cwd`、`threadId`、`turnId`、项目路径过滤。
7. Dashboard 展示不确定状态，避免把估算数据伪装成精确数据。

## 10. 一句话结论

```text
要精确到每一轮对话，不能只监听 token 日志。
应该用 session jsonl 切轮和拿 prompt，用 Git snapshot 统计当轮代码，用 logs_2.sqlite 延迟回填 token。
```
