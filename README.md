# MCP Toolbox

这个项目是一个 MCP 工具集合，目前包含：

- AI Coding 统计写入工具。
- 飞书云文档读取工具。

## 飞书云文档 MCP

飞书工具用于读取云文档正文和基础元信息，支持新版 `docx`、旧版 `doc`，以及解析到文档对象的 `wiki` URL。

### AI 客户端接入

先构建 MCP server：

```bash
npm install
npm run build
```

然后把下面配置加入支持 MCP 的 AI 客户端。可以直接复制 [examples/mcp-client-config.example.json](./examples/mcp-client-config.example.json)，再把 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 替换为真实值。

```json
{
  "mcpServers": {
    "mcp-toolbox": {
      "command": "node",
      "args": [
        "/Users/dubo/Documents/sbt/sl/mcp/dist/index.js"
      ],
      "env": {
        "FEISHU_APP_ID": "cli_xxx",
        "FEISHU_APP_SECRET": "replace-with-your-secret",
        "FEISHU_BASE_URL": "https://open.feishu.cn"
      }
    }
  }
}
```

AI 客户端接入后，可以让 AI 调用：

```text
feishu_get_doc_content
```

输入飞书文档 URL，例如：

```json
{
  "input": "https://example.feishu.cn/wiki/xxxxx"
}
```

如果 AI 客户端已经启动过，需要重启或刷新 MCP server，让它重新读取构建后的 `dist/index.js` 和环境变量。

### 配置

在 `.env` 或 MCP client 的 `env` 中配置：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_BASE_URL=https://open.feishu.cn
```

如果使用 `.env`，请把文件放在项目根目录。服务启动时会读取当前工作目录和项目根目录的 `.env`；MCP client 的 `env` 配置优先级更高。

`FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 来自飞书开放平台的企业自建应用。应用需要开通云文档读取相关权限，并且测试文档需要授权给该应用。

如果传入的是 Wiki URL，还需要给应用开通以下任一应用身份权限：

```text
wiki:wiki
wiki:wiki:readonly
wiki:node:read
```

飞书接口返回的权限申请入口类似：

```text
https://open.feishu.cn/app/<app_id>/auth?q=wiki:wiki,wiki:wiki:readonly,wiki:node:read&op_from=openapi&token_type=tenant
```

### 工具

#### `feishu_parse_doc_url`

解析飞书文档 URL，返回类型和 token。这个工具不请求飞书 API，可用于检查输入。

```json
{
  "input": "https://example.feishu.cn/wiki/xxxxx"
}
```

#### `feishu_get_doc_meta`

读取文档基础元信息。传入 wiki URL 时，会先解析 Wiki 节点对应的文档对象。

```json
{
  "input": "https://example.feishu.cn/docx/xxxxx"
}
```

#### `feishu_get_doc_content`

读取文档正文原始文本。传入 wiki URL 时，会先解析 Wiki 节点对应的文档对象。

```json
{
  "input": "https://example.feishu.cn/wiki/xxxxx"
}
```

## AI Coding Stats MCP

这个 MCP 用于在每轮 AI Coding 结束后，把会话统计写入本地 JSON 文件（默认：`.mcp-toolbox/data.json`）。

## 能力

- 记录每轮对话的开始时间、结束时间、模型名称、代码改动行数、token 消耗等信息。
- 从用户问题中解析 `#12` 这样的需求编号，并写入本轮记录。
- 当本轮问题没有需求编号时，自动沿用同一个 `conversationId` 上下文中的上一个需求编号。
- 如果问题和上下文都没有需求编号，则本轮 `requirement_id` 为空。

## 数据库设计

- `ai_coding_conversations`：保存每个会话的当前需求上下文。
- `ai_coding_rounds`：保存每轮 AI Coding 明细。
- `ai_coding_requirements`：保存需求标题、项目名称、GPM 编号、状态和备注。

核心字段：

- `conversation_id`：AI Coding 对话或线程的稳定 ID。
- `requirement_id`：需求编号，来自 prompt、上下文或为空。
- `requirement_source`：`prompt`、`context`、`empty`。
- `started_at` / `ended_at` / `duration_ms`：时间和耗时。
- `model_name`：模型名称。
- `files_changed` / `lines_added` / `lines_deleted` / `code_lines_changed`：代码改动统计。
- `input_tokens` / `output_tokens` / `total_tokens`：token 统计。
- `metadata`：额外 JSON 信息。

## 本地存储

默认把数据写到当前工作目录的 `.mcp-toolbox/data.json`（可通过环境变量 `MCP_TOOLBOX_STORAGE_DIR` 指定目录）。

```bash
cp .env.example .env
npm install
```

## Dashboard

这个项目内置了一个 AI Coding 统计页面，用于展示需求效率、token 消耗和模型差异。

本地启动：

```bash
npm run build
npm run dashboard:start
```

默认访问：

```text
http://127.0.0.1:3000
```

Dashboard 按统计维度拆分为多个页面：

- `/`：总览 KPI、Token 数据质量、需求和模型效率图
- `/requirements.html`：按需求统计，包含 AI 生成代码总耗时、首轮开始和末轮结束；点击时间可下穿到对话详情
- `/models.html`：按模型统计，展示有效轮次、Token、代码改动、撤销率和平均耗时
- `/timeline.html`：按日期趋势查看 Token 和代码改动
- `/rounds.html`：每轮 AI Coding 对话详情
- `/requirement-maintenance.html`：维护需求标题、项目名称、GPM 编号、状态和备注
- `/local-logs.html`：查看 Codex / Claude Code 本地日志文件，默认只加载文件列表和尾部片段，避免大日志拖慢页面

登录账号来自环境变量：

```env
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=change-me
DASHBOARD_SESSION_SECRET=replace-with-a-long-random-secret
```

公网部署前必须修改默认密码和 session secret。

Docker Compose 启动 Dashboard：

```bash
docker compose up -d dashboard
```

Dashboard API 默认需要登录 cookie。只读接口包括：

- `GET /api/summary`
- `GET /api/requirements`
- `GET /api/models`
- `GET /api/timeline`
- `GET /api/rounds`
- `GET /api/filters`
- `GET /api/requirement-records`
- `GET /api/local-logs/files`
- `GET /api/local-logs/file`

需求维护写接口：

- `PUT /api/requirement-records/:id`
- `DELETE /api/requirement-records/:id`

对话维护写接口：

- `PUT /api/rounds/:id`
- `DELETE /api/rounds/:id`

本地日志接口有固定性能上限：

- 文件列表单次最多返回 200 条。
- 后端扫描单次最多收集 3000 个候选文件。
- 文件内容只读取尾部，最大 256 KB。
- Codex 的 SQLite 日志库只展示文件元信息，不在页面直接加载二进制内容。

请求示例：

```json
{
  "title": "AI Coding 统计页面",
  "projectName": "ai-coding-stats",
  "gpmNumber": "GPM-12345",
  "status": "active",
  "description": "补充需求背景和验收信息"
}
```

支持筛选参数：

```text
from=2026-05-01
to=2026-05-08
model=gpt-5-codex
requirementId=12
requirementId=null
client=codex
includeReverted=true
```

默认统计使用 `ai_coding_effective_rounds`，即排除已撤销轮次。

## 构建

```bash
npm run build
```

## 本地写入测试

```bash
npm run test:record
npm run test:verify
npm run test:revert
npm run test:dashboard
npm run test:tokens
```

验证飞书文档读取：

```bash
npm run test:feishu -- https://example.feishu.cn/wiki/xxxxx
```

验证构建后的 MCP server 可被 AI 客户端发现：

```bash
npm run build
npm run test:mcp -- https://example.feishu.cn/wiki/xxxxx
```

## Token 回填

如果 Codex 或 Claude Code 在每轮结束时不能直接提供真实 token，可以先让 MCP 写入 `0`，之后用同步脚本从本机日志回填。

为了提高匹配准确率，记录轮次时建议在 `metadata` 里保存客户端上下文：

```json
{
  "client": "codex",
  "projectPath": "/Users/dubo/Documents/sbt/sl/mcp",
  "threadId": "Codex thread id",
  "turnId": "Codex turn id",
  "tokenStatsUnavailable": true
}
```

Claude Code 对应为：

```json
{
  "client": "claude-code",
  "projectPath": "/Users/dubo/Documents/sbt/sl/mcp",
  "sessionId": "Claude Code session id",
  "turnId": "assistant message uuid",
  "tokenStatsUnavailable": true
}
```

同步所有可匹配轮次：

```bash
npm run tokens:sync -- --project /Users/dubo/Documents/sbt/sl/mcp
```

只同步 Codex：

```bash
npm run tokens:sync:codex -- --project /Users/dubo/Documents/sbt/sl/mcp
```

只同步 Claude Code：

```bash
npm run tokens:sync:claude -- --project /Users/dubo/Documents/sbt/sl/mcp
```

同步单个轮次：

```bash
npm run tokens:sync -- --round-id 29 --project /Users/dubo/Documents/sbt/sl/mcp
```

dry-run：

```bash
npm run tokens:sync -- --project /Users/dubo/Documents/sbt/sl/mcp --dry-run
```

数据来源：

- Claude Code：`~/.claude/projects/**/*.jsonl`，可回填 input/output token。
- Codex：`~/.codex/logs_2.sqlite` 和 `~/.codex/state_5.sqlite`，当前按 cumulative total delta 回填 total token。

Dashboard 会展示 token 数据质量：

- `mcp_payload`
- `claude_jsonl`
- `codex_log`
- `unavailable`

以及同步状态：

- `pending`
- `synced`
- `not_found`
- `ambiguous`
- `failed`

测试脚本会连续写入两轮：

1. 第一轮 prompt 中带 `#12`，因此 `requirement_source = prompt`。
2. 第二轮 prompt 不带编号，因此沿用上下文，`requirement_source = context`。

## MCP 配置示例

构建后可以把下面配置加入 MCP client：

```json
{
  "mcpServers": {
    "mcp-toolbox": {
      "command": "node",
      "args": [
        "/Users/dubo/Documents/sbt/sl/mcp/dist/index.js"
      ],
      "env": {
        "MCP_TOOLBOX_STORAGE_DIR": ".mcp-toolbox",
        "FEISHU_APP_ID": "cli_xxx",
        "FEISHU_APP_SECRET": "xxx",
        "FEISHU_BASE_URL": "https://open.feishu.cn"
      }
    }
  }
}
```

## 工具

### `record_ai_coding_round`

参数示例：

```json
{
  "conversationId": "thread-abc",
  "startedAt": "2026-05-08T00:10:00.000Z",
  "endedAt": "2026-05-08T00:18:30.000Z",
  "modelName": "gpt-5-codex",
  "promptText": "请实现 #12 的统计功能",
  "filesChanged": 4,
  "linesAdded": 120,
  "linesDeleted": 35,
  "inputTokens": 8000,
  "outputTokens": 2600,
  "metadata": {
    "repository": "example/repo",
    "branch": "feature/ai-coding-stats"
  }
}
```

### `record_ai_coding_round_revert`

当用户要求撤销某一轮对话产生的代码改动时，不删除原始记录，而是写入一条撤销事件。

如果知道原始轮次 id，传 `targetRoundId`。如果不知道，并且用户要撤销当前会话的上一轮，可以省略 `targetRoundId`，MCP 会选择同一个 `conversationId` 下最近一条尚未撤销的记录。

```json
{
  "conversationId": "thread-abc",
  "targetRoundId": 1,
  "revertedAt": "2026-05-08T00:30:00.000Z",
  "modelName": "gpt-5-codex",
  "promptText": "撤销上一轮代码改动",
  "reason": "user requested undo",
  "filesChanged": 2,
  "linesAdded": 35,
  "linesDeleted": 120,
  "inputTokens": 2000,
  "outputTokens": 800
}
```

统计有效产出时使用视图：

```sql
SELECT requirement_id, SUM(code_lines_changed) AS effective_code_lines_changed
FROM ai_coding_effective_rounds
GROUP BY requirement_id;
```

返回示例：

```json
{
  "id": 1,
  "conversationId": "thread-abc",
  "requirementId": 12,
  "requirementSource": "prompt",
  "modelName": "gpt-5-codex",
  "durationMs": 510000,
  "codeLinesChanged": 155,
  "totalTokens": 10600
}
```
