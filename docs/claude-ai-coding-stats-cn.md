# Claude Code AI Coding 统计记录规范

本文档是 [CLAUDE.md](../CLAUDE.md) 的中文说明页，用于指导 Claude Code 在本项目中接入 `ai-coding-stats` MCP server，并在每轮 AI Coding 工作结束时记录统计数据。

## 1. 什么时候记录

每处理完一次用户请求，都需要在最终回复用户之前调用一次 MCP 统计工具。

正常轮次使用：

```text
record_ai_coding_round
```

撤销或回滚轮次使用：

```text
record_ai_coding_round_revert
```

即使本轮没有改动任何文件，也不能跳过记录。此时将 `filesChanged`、`linesAdded`、`linesDeleted`、`codeLinesChanged` 都填为 `0`。

如果 MCP server 不可用，需要在最终回复中简要说明记录失败的原因。

## 2. 需求编号规则

调用工具时，应把用户原始输入放入 `promptText`。

如果用户输入中包含 `#12`、`#555` 这类标记，MCP server 会自动解析为需求编号。

示例：

```text
#555 生成一页 CLAUDE.md 的中文文档 启动mcp
```

该轮会被记录到需求 `555`。

如果本轮 prompt 没有需求编号，仍然需要调用统计工具。MCP server 会优先沿用同一个 `conversationId` 下已有的需求上下文；如果上下文也没有需求编号，则本轮需求编号为空。

## 3. conversationId 约定

Claude Code 应在同一个编码会话中使用稳定的 `conversationId`。

推荐格式：

```text
claude:<absolute project path>:<stable session label>
```

如果没有稳定的会话标签，可以使用：

```text
claude:<absolute project path>
```

示例：

```text
claude:C:/Users/00232924/Desktop/mcp
```

保持 `conversationId` 稳定的目的，是让 MCP server 能在后续轮次中正确继承需求编号。

## 4. 时间记录

每轮请求开始时记录 `startedAt`，结束时记录 `endedAt`。

时间必须使用 ISO 8601 字符串。当前 MCP tool 使用严格校验，推荐传入 UTC 格式：

```text
2026-05-19T06:30:15.844Z
```

## 5. 代码变更统计

在修改文件前，应记住当前工作区基线。结束时优先使用 Git 统计：

```bash
git diff --numstat
```

需要填充的字段：

| 字段 | 含义 |
| --- | --- |
| `filesChanged` | 本轮变更文件数 |
| `linesAdded` | 本轮新增行数 |
| `linesDeleted` | 本轮删除行数 |
| `codeLinesChanged` | 新增行数与删除行数之和 |

如果无法获得精确的本轮 Git 统计，可以使用最佳估算，并在 `metadata.codeStatsSource` 中说明来源。

## 6. Token 统计

如果客户端能提供真实 token 用量，应填写：

- `inputTokens`
- `outputTokens`
- `totalTokens`

如果无法获取真实 token，用 `0` 填充，并在 `metadata` 中加入：

```json
{
  "tokenStatsUnavailable": true
}
```

如能获取 Claude Code 的 `sessionId` 和当前 assistant message 的 `turnId`，也应写入 `metadata`。后续 token 同步任务可以利用这些字段从 Claude JSONL 日志中补齐真实 token 用量。

## 7. 正常轮次 Payload

`record_ai_coding_round` 的推荐 payload：

```json
{
  "conversationId": "claude:C:/Users/00232924/Desktop/mcp",
  "startedAt": "2026-05-19T06:30:15.844Z",
  "endedAt": "2026-05-19T06:35:00.000Z",
  "modelName": "current model name",
  "promptText": "#555 生成一页 CLAUDE.md 的中文文档 启动mcp",
  "filesChanged": 1,
  "linesAdded": 120,
  "linesDeleted": 0,
  "codeLinesChanged": 120,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "claude-code",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "sessionId": "current Claude Code session id when available",
    "turnId": "current assistant message uuid when available",
    "codeStatsSource": "git diff --numstat",
    "tokenStatsUnavailable": true
  }
}
```

## 8. 撤销轮次 Payload

如果用户要求撤销上一轮或指定轮次，先完成代码回滚，再调用 `record_ai_coding_round_revert`。

不要删除或覆盖原始轮次记录。系统会保留原记录用于审计，并通过有效统计视图排除被撤销的轮次。

推荐 payload：

```json
{
  "conversationId": "claude:C:/Users/00232924/Desktop/mcp",
  "targetRoundId": 123,
  "revertedAt": "2026-05-19T06:40:00.000Z",
  "modelName": "current model name",
  "promptText": "撤销上一轮改动",
  "reason": "user requested undo",
  "filesChanged": 1,
  "linesAdded": 0,
  "linesDeleted": 120,
  "codeLinesChanged": 120,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "claude-code",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "revertTarget": "latest active round when targetRoundId is omitted",
    "tokenStatsUnavailable": true
  }
}
```

如果不知道 `targetRoundId`，并且用户明确要求撤销当前会话的最新轮次，可以省略该字段。MCP server 会标记同一 `conversationId` 下最新的有效轮次为已撤销。

## 9. 启动与验证 MCP

先安装依赖并构建：

```bash
npm install
npm run build
```

启动 MCP server：

```bash
npm run start
```

该 server 通过 stdio 与 MCP client 通信，通常由 Claude Code、Codex 或其他 MCP client 按配置自动拉起。

也可以运行项目内验证脚本，确认 MCP server 能启动并返回工具列表：

```bash
npm run test:mcp
```

验证通过后，应能看到 `record_ai_coding_round` 和 `record_ai_coding_round_revert` 等工具。

## 10. 执行顺序总结

每轮 AI Coding 建议按以下顺序执行：

1. 记录 `startedAt`。
2. 完成用户请求。
3. 运行必要的构建或测试。
4. 统计本轮文件和行数变化。
5. 调用 `record_ai_coding_round` 或 `record_ai_coding_round_revert`。
6. 向用户发送最终回复。
