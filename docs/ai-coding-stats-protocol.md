# AI Coding Stats MCP 接入文档

本文档说明 AI Coding 统计 MCP 协议的接入方式、调用字段、需求编号继承规则和撤销记录规则，适用于 Codex、Claude Code 等支持 MCP 的 AI Coding 客户端。

## 1. 目标

AI Coding Stats MCP 用于在每轮 AI Coding 结束时，把本轮工作的统计信息写入本地存储，便于后续按需求、会话、模型和代码变更量进行统计。

一轮记录通常包含：

- 用户原始 prompt
- 会话稳定标识 `conversationId`
- 开始和结束时间
- 模型名称
- 变更文件数、增删行数
- Token 使用量
- 需求编号及来源
- 客户端、项目路径等扩展元信息

## 2. MCP Tools

当前提供两个统计相关工具：

| Tool | 用途 |
| --- | --- |
| `record_ai_coding_round` | 记录一轮正常 AI Coding 工作 |
| `record_ai_coding_round_revert` | 记录一次撤销操作，并把目标轮次从有效统计中排除 |

正常实现、调查、文档编写、测试验证都应调用 `record_ai_coding_round`。

当用户请求撤销或回滚上一轮代码变更时，应先完成代码回滚，再调用 `record_ai_coding_round_revert`。

## 3. 会话标识

`conversationId` 必须在同一个项目会话中保持稳定。推荐格式：

```text
codex:<absolute project path>
```

示例：

```text
codex:C:/Users/00232924/Desktop/mcp
```

稳定的 `conversationId` 用于支持需求编号继承：当后续 prompt 没有写 `#编号` 时，系统可以沿用同一会话中上一轮的需求编号。

## 4. 需求编号规则

系统会从 `promptText` 中解析 `#12` 这类标记作为需求编号。

解析规则：

| 场景 | 结果 |
| --- | --- |
| prompt 中包含 `#44` | 本轮归属需求 `44`，来源为 `prompt` |
| prompt 中没有编号，但同一会话之前有编号 | 沿用上一轮需求编号，来源为 `context` |
| prompt 和会话上下文都没有编号 | 需求编号为空，来源为 `empty` |

因此，一个需求通常只需要在第一轮写一次编号，例如：

```text
#44 生成一个文档
```

后续同一会话中的问题即使没有再次写 `#44`，也会自动继承该需求编号。

## 5. 正常轮次记录

调用 `record_ai_coding_round` 时，推荐 payload 如下：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "startedAt": "2026-05-19T14:21:27.975+08:00",
  "endedAt": "2026-05-19T14:25:00.000+08:00",
  "modelName": "gpt-5-codex",
  "promptText": "#44 生成一个文档",
  "filesChanged": 1,
  "linesAdded": 120,
  "linesDeleted": 0,
  "codeLinesChanged": 120,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "codex",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "codeStatsSource": "git diff --numstat",
    "tokenStatsUnavailable": true
  }
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `conversationId` | 是 | 当前 AI Coding 会话的稳定 ID |
| `startedAt` | 是 | 本轮开始时间，ISO 8601 格式 |
| `endedAt` | 是 | 本轮结束时间，ISO 8601 格式 |
| `modelName` | 是 | 本轮使用的模型名称 |
| `promptText` | 否 | 用户原始 prompt，用于解析需求编号和审计 |
| `filesChanged` | 否 | 本轮变更文件数 |
| `linesAdded` | 否 | 本轮新增行数 |
| `linesDeleted` | 否 | 本轮删除行数 |
| `codeLinesChanged` | 否 | 代码变更总行数，通常等于新增加删除 |
| `inputTokens` | 否 | 输入 token 数 |
| `outputTokens` | 否 | 输出 token 数 |
| `totalTokens` | 否 | 总 token 数 |
| `metadata` | 否 | 扩展信息，建议写入客户端、项目路径和统计来源 |

当真实 token 数不可用时，token 字段填 `0`，并在 `metadata` 中设置：

```json
{
  "tokenStatsUnavailable": true
}
```

## 6. 代码变更统计

推荐在本轮开始前记住 worktree 基线，在结束时使用：

```bash
git diff --numstat
```

统计口径：

- `filesChanged`：有变更的文件数量
- `linesAdded`：所有新增行数之和
- `linesDeleted`：所有删除行数之和
- `codeLinesChanged`：`linesAdded + linesDeleted`

如果本轮没有代码或文档变更，仍然需要记录，四个字段均填 `0`。

## 7. 撤销轮次记录

当用户要求撤销上一轮或某一轮的代码变更时：

1. 先使用项目合适的方式完成代码回滚。
2. 再调用 `record_ai_coding_round_revert`。
3. 不删除原始 `record_ai_coding_round` 记录。

示例 payload：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "revertedAt": "2026-05-19T15:00:00.000+08:00",
  "modelName": "gpt-5-codex",
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
    "client": "codex",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "revertTarget": "latest active round when targetRoundId is omitted",
    "tokenStatsUnavailable": true
  }
}
```

如果知道原轮次 ID，可以额外传入 `targetRoundId`。如果不知道且用户要求撤销最新轮次，可以省略该字段，系统会选择同一 `conversationId` 下最新的有效轮次。

## 8. 本地存储

默认存储位置：

```text
.mcp-toolbox/data.json
```

可通过环境变量修改：

```env
MCP_TOOLBOX_STORAGE_DIR=.mcp-toolbox
```

核心数据包括：

- `conversations`：会话上下文，保存当前需求编号
- `rounds`：正常 AI Coding 轮次
- `roundReverts`：撤销事件
- `requirements`：需求维护信息
- `tokenUsageEvents`：token 同步证据记录

## 9. 客户端接入建议

AI Coding 客户端应在每轮请求生命周期中执行以下步骤：

1. 用户请求开始时记录 `startedAt`。
2. 执行实现、调查、测试或文档工作。
3. 结束前读取 `git diff --numstat` 生成代码变更统计。
4. 获取真实 token 用量；不可用时填 `0` 并设置 `tokenStatsUnavailable`。
5. 调用对应 MCP tool。
6. 再向用户返回最终结果。

对于 Codex，本项目约定的 `conversationId` 为：

```text
codex:C:/Users/00232924/Desktop/mcp
```

## 10. 验证方式

构建项目：

```bash
npm run build
```

验证 MCP server 可用：

```bash
npm run test:mcp
```

通过脚本写入一条测试记录：

```bash
.\node_modules\.bin\tsx.cmd scripts\call-record-round-via-mcp.ts "#44 MCP call smoke test"
```

写入成功后，可以检查：

```text
.mcp-toolbox/data.json
```

也可以启动 Dashboard 查看统计：

```bash
npm run dashboard:dev
```
