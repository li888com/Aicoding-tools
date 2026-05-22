# AI-Coding 轻量统计 MCP 与日志回填方案

## 1. 结论

```text
MCP 管代码行数，日志管 token。
```

这是当前最干净、最可控的架构。

原因是：

- 代码行数必须依赖真实轮次边界，适合在 MCP 当前轮结束时现场统计。
- token 日志可能延迟，适合作为后续回填数据源。
- prompt、需求绑定、projectPath、threadId、turnId 等上下文，MCP 当前轮最容易拿准。
- `logs_2.sqlite` 不应该决定代码 diff 边界，否则 token 延迟会导致行数串轮。

## 2. 为什么新建轻量 MCP

原 `mcp-toolbox` 同时包含：

- AI Coding 统计
- AI Coding 需求选择
- 飞书文档
- 文件解密
- Dashboard 相关能力

作为通用 toolbox 没问题，但如果只为了每轮 AI Coding 统计，它偏大。

本次新增轻量入口：

```text
src/ai-coding-stats-server.ts
```

它只注册 AI Coding 统计工具：

```text
begin_ai_coding_round
record_ai_coding_round
record_ai_coding_round_revert
```

启动命令：

```bash
npm run start:ai-coding-stats
```

开发命令：

```bash
npm run dev:ai-coding-stats
```

## 3. 分工设计

### 3.1 MCP 负责代码行数

一轮开始时调用：

```text
begin_ai_coding_round
```

它会：

```text
1. 根据 conversationId + projectPath 生成 baselineId
2. 扫描 Git 工作区 tracked、modified、untracked 文件
3. 记录每个文本文件的行数
4. 保存 baseline 到 .mcp-toolbox/round-baselines
```

一轮结束时调用：

```text
record_ai_coding_round
```

它会：

```text
1. 读取本轮 baseline
2. 重新扫描当前工作区
3. 计算 baseline -> current snapshot 的行数差异
4. 写入 filesChanged、linesAdded、linesDeleted、codeLinesChanged
5. token 字段先保持 0 或 pending
```

如果没有找到 baseline，会回退到 workspace cumulative diff，并在 metadata 里标记：

```text
codeStatsPrecision = workspace-cumulative
codeStatsNote = No begin_ai_coding_round baseline found
```

这个回退结果只能作为兜底，不应当视为完全精确的单轮统计。

### 3.2 日志负责 token 回填

token 仍由现有同步脚本从工具日志回填：

```bash
npm run tokens:sync
```

Codex 主要来源：

```text
~\.codex\logs_2.sqlite
~\.codex\sessions\...\rollout-*.jsonl
```

匹配优先级应尽量使用：

```text
turnId
threadId
conversationId
projectPath
时间窗口
```

当找不到唯一候选时，不能强行绑定，应进入：

```text
ambiguous / needs_review
```

## 4. 本次代码变更

新增：

```text
src/code-stats.ts
src/ai-coding-stats-server.ts
docs/AI-Coding轻量统计MCP与日志回填方案.md
```

修改：

```text
src/tools/ai-coding-stats.ts
package.json
scripts/call-record-round-via-mcp.ts
```

### 4.1 `src/code-stats.ts`

提供共享代码行数统计能力：

- `createCodeSnapshot(projectPath)`
- `saveRoundBaseline(conversationId, projectPath, snapshot)`
- `loadRoundBaseline(conversationId, projectPath)`
- `getCodeStatsSinceSnapshot(projectPath, snapshot)`
- `getWorkspaceCodeStats(projectPath)`

### 4.2 `begin_ai_coding_round`

新增 MCP tool，用于一轮开始时保存 baseline。

返回：

```json
{
  "conversationId": "...",
  "projectPath": "...",
  "baselineId": "...",
  "baselinePath": "...",
  "baselineCreatedAt": "...",
  "filesTracked": 0
}
```

### 4.3 `record_ai_coding_round`

增强为：

```text
优先用 baseline snapshot diff 计算代码行数。
```

并在 metadata 中写入：

```text
codeStatsSource
codeStatsPrecision
baselineId
baselinePath
tokenStatsSource = tool_log_backfill
tokenStatsUnavailable = true/false
```

## 5. 过程问题收集

### 5.1 问题：只靠 token 日志切轮会串行数

场景：

```text
第一轮代码已改完
第二轮又开始改代码
第一轮 token 日志才延迟出现
```

如果此时才统计 Git diff，会把第二轮代码算进第一轮。

处理结论：

```text
logs_2.sqlite 不能负责代码行数切轮。
```

### 5.2 问题：原 MCP 入口过大

原入口 `src/index.ts` 注册多个领域工具。

如果只做 AI Coding 统计，建议使用轻量入口：

```text
src/ai-coding-stats-server.ts
```

这样 MCP 配置更清晰，故障面更小。

### 5.3 问题：没有 begin baseline 时无法保证单轮行数

如果只在结束时调用 `record_ai_coding_round`，MCP 不知道本轮开始前的工作区状态。

处理方式：

```text
1. 优先要求每轮开始调用 begin_ai_coding_round
2. 结束调用 record_ai_coding_round
3. 没有 baseline 时只能 fallback，并标记 precision
```

### 5.4 问题：token 不应由 MCP 强行估算

MCP 当前轮不一定能拿到真实 token。

处理方式：

```text
MCP 记录 token = 0 / pending
后台日志同步回填真实 token
```

### 5.5 问题：多会话同时改同一仓库仍可能冲突

即使使用 MCP baseline，如果两个 Codex 会话同时修改同一工作区，行数归因仍然可能不清楚。

后续建议增加：

```text
codeStatsStatus = completed / ambiguous / estimated
recordSource = mcp / session_watcher / manual
```

## 6. 推荐调用顺序

一轮开始：

```json
{
  "tool": "begin_ai_coding_round",
  "arguments": {
    "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "startedAt": "2026-05-22T10:00:00.000+08:00"
  }
}
```

一轮结束：

```json
{
  "tool": "record_ai_coding_round",
  "arguments": {
    "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "startedAt": "2026-05-22T10:00:00.000+08:00",
    "endedAt": "2026-05-22T10:05:00.000+08:00",
    "modelName": "gpt-5.5",
    "promptText": "用户原始需求",
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "metadata": {
      "client": "codex",
      "threadId": "019e...",
      "turnId": "019e..."
    }
  }
}
```

随后后台执行：

```bash
npm run tokens:sync
npm run sync:online
```

或：

```bash
npm run auto-sync
```

## 7. 一句话原则

```text
代码行数必须在真实轮次边界上统计；token 可以接受延迟回填。
```
