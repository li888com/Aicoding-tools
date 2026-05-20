# MCP Toolbox 项目详细说明与内部逻辑

本文面向接手开发、联调后端、部署 Dashboard、排查同步问题的人员，说明 MCP Toolbox 的整体结构、内部数据流、核心脚本和运行逻辑。

## 1. 项目定位

MCP Toolbox 是一个基于 Model Context Protocol 的本地工具服务，目前主要包含三类能力：

1. AI Coding 统计记录与同步。
2. 飞书云文档读取。
3. IP-Guard 加密文件解密。

其中当前重点是 AI Coding 统计链路：

```text
AI 客户端
  -> 调用 MCP 工具 record_ai_coding_round
  -> 本地 .mcp-toolbox/data.json 记录 round
  -> token 同步脚本扫描 Codex / Claude 日志并回填 token
  -> online sync 脚本把本地数据上传到线上后端
  -> Dashboard 从本地或线上接口读取统计数据
```

当前已跑通的线上测试后端：

```text
写接口: http://localhost:9906/api/ai-coding
查询接口: http://localhost:9906/api/ai-coding/dashboard
```

## 2. 目录结构

核心目录如下：

```text
src/
  index.ts                         MCP server 入口
  database.ts                      AI Coding 本地记录服务层
  local-storage.ts                 JSON 本地存储与并发锁
  requirement.ts                   requirementId 解析逻辑
  dashboard-server.ts              本地 Dashboard HTTP server
  dashboard-config.ts              Dashboard 配置
  config.ts                        飞书、IP-Guard 等配置
  tools/
    ai-coding-stats.ts             AI Coding MCP 工具注册
    feishu-docs.ts                 飞书 MCP 工具注册
    file-decrypt.ts                文件解密 MCP 工具注册
  integrations/
    feishu/                        飞书 API 客户端、URL 解析、Markdown 渲染
    ipguard/                       IP-Guard 解密客户端

scripts/
  sync-token-usage.ts              token 回填主脚本
  sync-token-usage-recent.ts       最近 pending round 快捷回填
  sync-to-online.ts                本地数据上传线上
  auto-sync-loop.ts                token 回填 + 线上同步自动循环
  code-change-stats.ts             git diff 行数分类统计
  call-record-round-via-mcp.ts     本地调用 MCP 记录 round 的测试入口
  verify-*.ts                      行为验证脚本

public/dashboard/
  *.html                           Dashboard 多页面入口
  app.js                           前端渲染和交互逻辑
  styles.css                       页面样式

docs/
  AI-Coding本地数据同步线上使用说明.md
  AI-Coding数据存储与统计接口实现方案.md
  线上存储改造方案.md
```

## 3. 启动入口

MCP server 入口是 `src/index.ts`。

启动后会注册三组工具：

```ts
registerAiCodingStatsTools(server);
registerFeishuDocsTools(server);
registerFileDecryptTools(server);
```

然后通过 `StdioServerTransport` 和 AI 客户端通信：

```text
AI 客户端 stdin/stdout
  <-> MCP server
  <-> 本地工具逻辑
```

构建和启动：

```bash
npm install
npm run build
npm run start
```

开发模式：

```bash
npm run dev
```

## 4. AI Coding MCP 工具

AI Coding 工具注册在 `src/tools/ai-coding-stats.ts`。

### 4.1 record_ai_coding_round

用途：记录一轮正常 AI Coding 工作。

关键入参：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "startedAt": "2026-05-19T10:00:00.000Z",
  "endedAt": "2026-05-19T10:05:00.000Z",
  "modelName": "gpt-5-codex",
  "promptText": "#555 实现同步逻辑",
  "filesChanged": 2,
  "linesAdded": 30,
  "linesDeleted": 4,
  "codeLinesChanged": 34,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "codex",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "tokenStatsUnavailable": true
  }
}
```

内部调用：

```text
record_ai_coding_round
  -> recordRound(input)
  -> resolveRequirementId(promptText, currentRequirementId)
  -> localStorage.createRound(...)
  -> localStorage.saveConversation(...)
```

返回值示例：

```json
{
  "id": 130,
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "requirementId": 555,
  "requirementSource": "context",
  "modelName": "gpt-5-codex",
  "durationMs": 30000,
  "codeLinesChanged": 0,
  "totalTokens": 0
}
```

### 4.2 record_ai_coding_round_revert

用途：记录撤销某轮代码改动。

设计原则：

1. 不删除原始 round。
2. 新增一条 revert 记录。
3. 有效统计中排除已撤销 round。

如果没有传 `targetRoundId`，系统会查找同一 `conversationId` 下最新未撤销 round。

## 5. requirementId 解析逻辑

实现文件：`src/requirement.ts`。

解析规则：

1. prompt 中包含 `#12` 时，当前 round 归属 requirementId `12`，source 为 `prompt`。
2. prompt 中没有编号，但当前 conversation 之前有 requirementId，则继承上下文，source 为 `context`。
3. prompt 和上下文都没有编号，则 requirementId 为 `null`，source 为 `empty`。

正则逻辑：

```ts
/#\s*([1-9]\d*)\b/
```

这也是为什么用户后续只说“继续”，系统仍能继承到 `#555`。

## 6. 本地存储模型

实现文件：`src/local-storage.ts`。

默认存储位置：

```text
.mcp-toolbox/data.json
```

可用环境变量修改：

```env
MCP_TOOLBOX_STORAGE_DIR=.mcp-toolbox
MCP_TOOLBOX_STORAGE_FILE=.mcp-toolbox/data.json
```

### 6.1 核心数据结构

`data.json` 顶层包含：

```json
{
  "conversations": [],
  "requirements": [],
  "rounds": [],
  "roundReverts": [],
  "tokenUsageEvents": [],
  "tokenUsageCandidates": [],
  "aiCodingCorrections": [],
  "autoSyncState": null,
  "nextRoundId": 1
}
```

### 6.2 conversations

保存会话上下文：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "currentRequirementId": 555,
  "lastRoundId": 130,
  "firstSeenAt": "...",
  "lastSeenAt": "..."
}
```

作用：让后续 prompt 没写 `#555` 时仍能归属到同一需求。

### 6.3 rounds

保存每轮 AI Coding 记录：

```json
{
  "id": 130,
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "requirementId": 555,
  "requirementSource": "context",
  "modelName": "gpt-5-codex",
  "startedAt": "...",
  "endedAt": "...",
  "promptText": "现在是自动扫描吗",
  "filesChanged": 0,
  "linesAdded": 0,
  "linesDeleted": 0,
  "codeLinesChanged": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "tokenSource": "unavailable",
  "tokenSyncStatus": "pending",
  "metadata": {
    "client": "codex",
    "projectPath": "C:/Users/00232924/Desktop/mcp"
  },
  "_sync": {
    "status": "synced",
    "onlineId": "2056693500728582146",
    "syncedAt": "..."
  }
}
```

### 6.4 tokenUsageEvents

保存从 Codex / Claude 日志中解析出来的真实 token 证据。

字段包括：

```text
roundId
client
sourcePath
sourceEventId
conversationId
turnId
modelName
startedAt / endedAt
inputTokens / outputTokens / totalTokens
matchQuality
rawEvent
```

### 6.5 tokenUsageCandidates

当某个 round 匹配到多个可能的 token event 时，不会自动写入 token，而是保存候选：

```text
round.tokenSyncStatus = ambiguous
tokenUsageCandidates = [...]
```

用户可以在 Dashboard 人工绑定。

### 6.6 aiCodingCorrections

保存人工修正记录，例如：

```text
token_manual_bind
token_reset
round_update
round_ignore
round_restore
```

用于审计：谁改了什么、为什么改、改前改后是什么。

### 6.7 并发写锁

本地 JSON 写入使用 `.mcp-toolbox/.lock` 目录作为简单锁。

逻辑：

1. 写入前尝试 `mkdir .lock`。
2. 成功表示拿到锁。
3. 失败说明其他进程正在写，等待后重试。
4. 锁超过 2 分钟视为 stale，会被清理。

这样避免多个脚本同时写 JSON 导致文件损坏。

## 7. Token 回填逻辑

脚本：`scripts/sync-token-usage.ts`。

运行命令：

```bash
npm run tokens:sync
npm run tokens:sync:recent
npm run tokens:sync:codex
npm run tokens:sync:claude
```

### 7.1 为什么需要 token 回填

AI 客户端在调用 MCP 时不一定能立即提供真实 token。

记录 round 时可以先写：

```json
{
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "tokenStatsUnavailable": true
  }
}
```

之后脚本从本地日志中找真实 token，再回填。

### 7.2 Claude Code token 来源

扫描：

```text
~/.claude/projects/**/*.jsonl
```

Claude 日志通常可以拿到 input/output/total token。

### 7.3 Codex token 来源

扫描 Codex 会话和日志数据，包括：

```text
~/.codex/sessions/**/*.jsonl
~/.codex/logs_2.sqlite
~/.codex/state_5.sqlite
```

如果系统没有 `sqlite3` CLI，脚本会降级，无法从 SQLite 中扫描部分信息。

### 7.4 匹配质量

token 回填不是简单按时间硬套，系统会尽量使用更可靠的匹配依据。

优先级大致为：

```text
exact_tool_call
turn_id
prompt_tool_call
time_window
```

状态含义：

| 状态 | 含义 |
| --- | --- |
| `synced` | 已找到唯一 token event 并写入 |
| `pending` | 等待扫描 |
| `not_found` | 没找到匹配日志 |
| `ambiguous` | 找到多个候选，等待人工绑定 |
| `failed` | 扫描异常 |

## 8. 代码行统计逻辑

脚本：`scripts/code-change-stats.ts`。

底层依赖：

```bash
git diff --numstat
```

输出包括：

```text
filesChanged
linesAdded
linesDeleted
codeLinesChanged
fileCategorySummary
```

文件类型拆分：

```text
source
doc
config
test
generated
other
```

同步线上时会把这些拆分写成顶层字段：

```json
{
  "sourceLinesChanged": 4,
  "docLinesChanged": 2,
  "configLinesChanged": 1,
  "testLinesChanged": 3,
  "generatedLinesChanged": 0,
  "otherLinesChanged": 2
}
```

## 9. 线上同步逻辑

脚本：`scripts/sync-to-online.ts`。

### 9.1 线上地址

配置：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
```

默认值：

```text
https://ai-test.sbtjt.com/api/ai-coding
```

### 9.2 鉴权

`SYNC_API_TOKEN` 是可选的。

如果配置：

```powershell
$env:SYNC_API_TOKEN = "xxx"
```

请求会带：

```http
Authorization: Bearer xxx
```

如果后端不要求鉴权，可以不配置。当前流程已经验证过无 token 上传。

### 9.3 上传顺序

同步顺序固定：

```text
requirements
  -> rounds
  -> roundReverts
  -> tokenUsageEvents
```

原因：

1. round 可能引用 requirement。
2. revert 必须引用线上 round id。
3. tokenUsageEvent 也必须引用线上 round id。

### 9.4 幂等键

round 上传时会带：

```text
idempotencyKey = local-round-{本地roundId}
```

后端必须保证同一个幂等键重复请求返回已有记录，而不是重复插入。

### 9.5 onlineId 映射

后端可能返回雪花 ID，例如：

```json
{
  "id": "2056693500728582146"
}
```

这个值超过 JavaScript safe integer 范围，所以本地按字符串保存：

```json
{
  "_sync": {
    "status": "synced",
    "onlineId": "2056693500728582146"
  }
}
```

后续 revert 和 token event 上传时，使用 `_sync.onlineId` 映射到线上 round。

### 9.6 跳过测试数据

以下数据不会上传：

```text
#999 token sync verification
dashboard temporary round
dashboard-api-
dashboard-test
verify-dashboard
verify-model
metadata.skipOnlineSync = true
metadata.testData = true
```

### 9.7 失败退避

上传失败时会写入：

```json
{
  "_sync": {
    "status": "failed",
    "error": "...",
    "failedAttempts": 1,
    "lastAttemptAt": "...",
    "nextRetryAt": "..."
  }
}
```

默认下一次不会立即重试，要等 `nextRetryAt` 到达。

强制重试：

```bash
npm run sync:online -- --retry-failed-now
```

### 9.8 dry-run

只检查，不上传：

```bash
npm run sync:online:dry -- --limit 10
```

## 10. 自动同步逻辑

脚本：`scripts/auto-sync-loop.ts`。

### 10.1 单次自动同步

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
npm run auto-sync:once
```

执行顺序：

```text
runTokenSync()
  -> scripts/sync-token-usage.ts

runOnlineSync()
  -> scripts/sync-to-online.ts
```

### 10.2 每轮结束后的推荐流程

当前项目规则是：

```text
1. 回答结束前调用 record_ai_coding_round
2. MCP 记录成功后执行 npm run auto-sync:once
3. auto-sync 扫描 token 并上传未同步数据
4. 再给用户最终回复
```

也就是说，当前是“每轮结束自动扫一次”，不是一直常驻后台。

### 10.3 常驻后台模式

如果希望后台持续扫描：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
npm run auto-sync
```

默认参数：

```text
AUTO_SYNC_TOKEN_INTERVAL_MS = 180000
AUTO_SYNC_ONLINE_INTERVAL_MS = 600000
AUTO_SYNC_SINCE_HOURS = 24
AUTO_SYNC_LOOKBACK_MS = 1800000
AUTO_SYNC_TOKEN_LIMIT = 200
AUTO_SYNC_ONLINE_LIMIT = 200
```

### 10.4 自动同步状态

状态保存到：

```text
autoSyncState
```

示例：

```json
{
  "status": "stopped",
  "lastTokenSyncStatus": "ok",
  "lastOnlineSyncStatus": "ok",
  "lastOnlineSyncSummary": {
    "processed": 2,
    "rounds": 1,
    "tokenUsageEvents": 1,
    "failed": 0
  }
}
```

## 11. Dashboard 内部逻辑

后端文件：`src/dashboard-server.ts`。

前端文件：

```text
public/dashboard/index.html
public/dashboard/requirements.html
public/dashboard/models.html
public/dashboard/timeline.html
public/dashboard/rounds.html
public/dashboard/app.js
public/dashboard/styles.css
```

### 11.1 本地 Dashboard 启动

```bash
npm run build
npm run dashboard:start
```

默认配置：

```text
DASHBOARD_HOST = 127.0.0.1
DASHBOARD_PORT = 8080
DASHBOARD_USERNAME = admin
DASHBOARD_PASSWORD = change-me
```

### 11.2 登录逻辑

Dashboard 使用 cookie session。

核心逻辑：

1. `/login` 返回登录页。
2. `/api/login` 校验用户名和密码。
3. 成功后写入 `ai_coding_dashboard_session` cookie。
4. 后续 `/api/*` 需要 cookie。

生产环境必须修改默认密码和 session secret。

### 11.3 查询接口

本地 Dashboard 提供：

```text
GET /api/summary
GET /api/requirements
GET /api/models
GET /api/timeline
GET /api/rounds
GET /api/filters
GET /api/sync-status
```

同时也提供维护接口：

```text
PUT /api/requirement-records/:id
DELETE /api/requirement-records/:id
PUT /api/rounds/:id
DELETE /api/rounds/:id
POST /api/rounds/:id/token-reset
POST /api/rounds/:id/token-sync
POST /api/rounds/:id/token-candidates/:candidateId/bind
POST /api/rounds/:id/ignore
POST /api/rounds/:id/restore
```

### 11.4 远端代理逻辑

Dashboard server 支持把本地页面请求代理到远端后端。

配置：

```env
AI_CODING_DASHBOARD_API_BASE_URL=http://localhost:9906/api/ai-coding/dashboard
AI_CODING_DASHBOARD_API_FALLBACK_LOCAL=true
AI_CODING_DASHBOARD_API_TIMEOUT_MS=2000
```

代理映射：

```text
/api/filters       -> /filters
/api/summary       -> /summary
/api/requirements  -> /requirements, /by-requirement
/api/models        -> /models, /by-model
/api/timeline      -> /timeline
/api/rounds        -> /rounds
```

如果远端返回：

```json
{
  "code": 0,
  "data": {}
}
```

代理会自动解包 `data`，让前端继续消费原来的对象或数组结构。

### 11.5 sync-status 说明

`/api/sync-status` 是 MCP 本地 worker 状态接口，不是线上后端必须实现的 Dashboard 统计接口。

如果线上后端没有这个接口，前端应隐藏自动同步状态卡，不应显示 `not_found` 作为业务错误。

## 12. 飞书文档工具逻辑

工具注册：`src/tools/feishu-docs.ts`。

工具列表：

```text
feishu_parse_doc_url
feishu_get_doc_meta
feishu_get_doc_content
```

配置：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_BASE_URL=https://open.feishu.cn
```

内部逻辑：

```text
输入 doc/docx/wiki URL
  -> 解析 token 和类型
  -> wiki URL 先解析到底层文档对象
  -> 调用飞书 API 获取元信息或正文
  -> docx 使用 Blocks API 渲染 Markdown
```

`feishu_get_doc_content` 返回 Markdown 格式内容，尽量保留表格、图片和链接。

## 13. IP-Guard 文件解密逻辑

工具注册：`src/tools/file-decrypt.ts`。

工具：

```text
decrypt_file
```

配置：

```env
IPGUARD_URL=http://192.168.10.30:8095
IPGUARD_NAME=ipguard-dify
IPGUARD_PASSWORD=...
```

内部逻辑：

```text
输入本地文件绝对路径
  -> 调用 IP-Guard server API
  -> 获取解密内容
  -> 文本文件直接返回文本
  -> 二进制文件返回解密后的本地路径
```

## 14. 关键环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `MCP_TOOLBOX_STORAGE_DIR` | 本地 JSON 存储目录 | `.mcp-toolbox` |
| `MCP_TOOLBOX_STORAGE_FILE` | online sync 读取的 JSON 文件 | `.mcp-toolbox/data.json` |
| `SYNC_API_BASE_URL` | 线上写接口前缀 | `https://ai-test.sbtjt.com/api/ai-coding` |
| `SYNC_API_TOKEN` | 可选 Bearer Token | 空 |
| `AI_CODING_DASHBOARD_API_BASE_URL` | Dashboard 远端查询接口 | `http://localhost:9906/api/ai-coding/dashboard` |
| `AI_CODING_DASHBOARD_API_FALLBACK_LOCAL` | 远端失败时是否回退本地 JSON | `true` |
| `DASHBOARD_USERNAME` | Dashboard 用户名 | `admin` |
| `DASHBOARD_PASSWORD` | Dashboard 密码 | `change-me` |
| `DASHBOARD_SESSION_SECRET` | Dashboard session 密钥 | `local-dev-dashboard-secret` |
| `AUTO_SYNC_TOKEN_INTERVAL_MS` | 常驻模式 token 扫描间隔 | `180000` |
| `AUTO_SYNC_ONLINE_INTERVAL_MS` | 常驻模式线上同步间隔 | `600000` |

## 15. 常用命令

构建：

```bash
npm run build
```

启动 MCP server：

```bash
npm run start
```

启动 Dashboard：

```bash
npm run dashboard:dev
```

记录测试 round：

```bash
npm run test:record
```

扫描 token：

```bash
npm run tokens:sync:recent
```

上传线上：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
npm run sync:online -- --limit 10 --retry-failed-now
```

每轮结束自动同步一次：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
npm run auto-sync:once
```

验证远端 Dashboard：

```bash
npm run test:dashboard:remote
```

## 16. 排错指南

### 16.1 `SYNC_API_TOKEN is not configured`

旧版本 `auto-sync-loop.ts` 会因为缺少 token 跳过线上同步。

当前逻辑已经改为：`SYNC_API_TOKEN` 可选。后端不要求鉴权时，不配置也会上传。

### 16.2 `No static resource ai-coding/rounds`

说明 `SYNC_API_BASE_URL` 配错了。

本地后端应使用：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
```

### 16.3 `Missing or invalid round response id`

旧逻辑把线上雪花 ID 当作 JS number 校验，超过 safe integer 后误判失败。

当前逻辑支持字符串 ID：

```json
{
  "id": "2056693500728582146"
}
```

### 16.4 token 状态一直是 ambiguous

说明匹配到多个候选 token event。

处理方式：

1. 打开 Round 明细页。
2. 找到 ambiguous round。
3. 查看候选 token event。
4. 人工绑定正确候选。

### 16.5 Dashboard 数据没更新

检查顺序：

1. `npm run sync:online:dry -- --limit 10`
2. `npm run sync:online -- --limit 10 --retry-failed-now`
3. 查看 `.mcp-toolbox/data.json` 中 `_sync.status` 和 `_sync.onlineId`
4. `npm run test:dashboard:remote`
5. 检查 `AI_CODING_DASHBOARD_API_BASE_URL`

## 17. 当前已验证链路

截至 2026-05-19，已验证：

```text
record_ai_coding_round
  -> .mcp-toolbox/data.json
  -> auto-sync:once
  -> token scan
  -> sync-to-online
  -> localhost:9906
  -> test:dashboard:remote
```

最近一次验证结果：

```json
{
  "lastOnlineSyncStatus": "ok",
  "processed": 2,
  "rounds": 1,
  "tokenUsageEvents": 1,
  "failed": 0,
  "remoteSummary": {
    "roundCount": 87,
    "totalTokens": 29703602
  }
}
```

这说明当前“每轮结束记录 MCP，然后扫描并上传未同步数据”的主流程已经跑通。

