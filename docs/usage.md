# MCP Toolbox 使用说明（AI Coding Stats / Feishu Docs / File Decrypt）

这个项目是一个 MCP server：提供一组可供 AI 客户端调用的 tools；同时内置一个本地 Dashboard，用于查看 AI Coding 统计。

这份文档按“怎么用 → 怎么调用 → 内部逻辑 → 写入了什么结果”的顺序，带你把整条链路跑通并理解清楚。

---

## 1. 快速了解

### 1.1 主要能力

1. AI Coding Stats
   - 记录每一轮 AI Coding 对话统计（开始/结束时间、模型、代码改动行数、Token、客户端等）
   - 支持“撤销”轮次：不删除原记录，而是写一条撤销事件；有效统计默认排除被撤销的轮次
2. Feishu Docs
   - 解析飞书 doc/docx/wiki URL，读取元信息或将文档内容转换成 Markdown（尽量保留表格/图片/链接结构）
3. File Decrypt（IP-Guard）
   - 对经 IP-Guard DRM 加密的本地文件解密：文本文件直接返回内容；二进制文件返回解密后的文件路径

### 1.2 入口文件与关键模块

- MCP server 入口：`src/index.ts`
- Tools 注册：`src/tools/*.ts`
- 本地存储（JSON）：`src/local-storage.ts`
- AI 统计写入：`src/database.ts`、`src/requirement.ts`
- Dashboard 后端：`src/dashboard-server.ts`
- Dashboard 前端静态资源：`public/dashboard/*`（HTML/CSS/JS）
- Token 同步（扫描本地日志）：`scripts/sync-token-usage.ts`

---

## 2. 安装与构建

### 2.1 前置条件

- Node.js 18+
- npm

### 2.2 安装与编译

```bash
npm install
npm run build
```

构建产物在 `dist/`，MCP server 与 Dashboard 都依赖它。

---

## 3. 作为 MCP Server 使用（给 Claude Code / Codex 等客户端调用 tools）

### 3.1 本地运行 MCP server

```bash
node dist/index.js
```

它通过 stdio 与 MCP client 通信（同类用法可参考 `scripts/verify-mcp-server.ts`）。

### 3.2 在 MCP client 里配置这个 server

参考示例：`examples/mcp-client-config.example.json`。

Windows 上常见的写法（把 `args` 改成你的本机路径）：

```json
{
  "mcpServers": {
    "mcp-toolbox": {
      "command": "node",
      "args": ["C:/Users/00232924/Desktop/mcp/dist/index.js"],
      "env": {
        "MCP_TOOLBOX_STORAGE_DIR": ".mcp-toolbox"
      }
    }
  }
}
```

你也可以在这里继续添加飞书 / IP-Guard / Dashboard 的环境变量（下面会列出需要哪些）。

### 3.3 自检：确认 MCP tools 都能被列出

```bash
npm run test:mcp
```

这会启动一个 MCP client，连接本项目的 MCP server，并打印 tools 列表（不依赖飞书凭证也能跑通）。

---

## 4. AI Coding Stats：记录一轮对话统计

### 4.1 有哪些 tools

定义在 `src/tools/ai-coding-stats.ts`：

- `record_ai_coding_round`：记录一轮对话统计
- `record_ai_coding_round_revert`：记录“撤销上一轮/指定轮次”的事件

### 4.2 `record_ai_coding_round`：怎么调用

关键字段：

- `conversationId`：会话/线程的稳定 ID（用于“没写 #编号时沿用上下文”）
- `startedAt` / `endedAt`：ISO 8601 时间字符串
- `modelName`：模型名
- `promptText`：用户当轮输入（用来解析 `#12` 这种需求编号，也用于审计/回看）

统计字段（可选，但建议尽量填）：

- `filesChanged`、`linesAdded`、`linesDeleted`、`codeLinesChanged`
- `inputTokens`、`outputTokens`、`totalTokens`
- `metadata`：任意扩展 JSON（强烈建议写入 `client`、`projectPath`；Token 同步会用到）

### 4.3 需求编号（#12）怎么解析

解析逻辑在 `src/requirement.ts`：

1. 如果 `promptText` 里包含 `#12`：本轮 `requirementId=12`，`requirementSource="prompt"`
2. 如果本轮没写 `#编号`：会沿用同一 `conversationId` 上一轮的 `currentRequirementId`，`requirementSource="context"`
3. 如果 prompt 与上下文都没有：本轮 `requirementId=null`，`requirementSource="empty"`

这意味着：你只需要在“第一轮”写一次 `#12`，后续同一 `conversationId` 的轮次不写也会自动归到 12。

### 4.4 内部写入链路（代码视角）

1. MCP server 收到工具调用（`src/tools/ai-coding-stats.ts`），用 zod 校验入参
2. 调用 `recordRound(input)`（`src/database.ts`）
3. `recordRound` 会：
   - 读取/创建 conversation（保存“当前需求上下文”）
   - 解析 requirementId（`src/requirement.ts`）
   - 计算默认值：`codeLinesChanged = linesAdded + linesDeleted`、`totalTokens = inputTokens + outputTokens`（如果未显式提供）
4. 最终通过 `src/local-storage.ts` 加锁，把数据写入本地 JSON 文件

### 4.5 写到了哪里？写了什么结构？

默认写入：

- 目录：`<process.cwd()>/\.mcp-toolbox`
- 文件：`.mcp-toolbox/data.json`

可通过环境变量修改目录：

- `MCP_TOOLBOX_STORAGE_DIR=/path/to/storage`

`data.json` 里包含（核心部分）：

- `conversations[]`：每个会话的当前需求上下文
- `rounds[]`：每一轮统计明细
- `roundReverts[]`：撤销事件
- `requirements[]`：需求维护信息（标题、项目、GPM、状态、备注等）
- `tokenUsageEvents[]`：Token 同步时保存的“证据记录”

### 4.6 需求“标题/项目/GPM”从哪里来？

当前版本的默认行为是：

- `record_ai_coding_round` 只负责记录“轮次统计”和“需求编号归属”，不会自动从 `promptText` 抽取标题并写入 `requirements[]`
- 需求标题等信息由 Dashboard 的“需求维护”页面写入（对应 API：`PUT /api/requirement-records/:id`，实现位于 `src/dashboard-server.ts`）

如果你希望“在 Claude Code 写一句 `#12 登录页改造` 就自动把标题存下来”，需要对 tool 入参做功能增强（例如增加可选字段 `requirementTitle`），这不是当前默认逻辑。

### 4.7 参考：用 Node MCP SDK 直接调用一次

可以仿照 `scripts/verify-mcp-server.ts`，写一个小脚本调用 `record_ai_coding_round`：

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: process.env,
  stderr: "pipe",
});

const client = new Client({ name: "demo", version: "0.0.0" });
await client.connect(transport);

await client.callTool({
  name: "record_ai_coding_round",
  arguments: {
    conversationId: "claude:C:/path/to/project",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    endedAt: new Date().toISOString(),
    modelName: "claude-3-7-sonnet",
    promptText: "#12 登录页改造",
    filesChanged: 1,
    linesAdded: 10,
    linesDeleted: 2,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    metadata: { client: "claude-code", projectPath: "C:/path/to/project" }
  }
});

await client.close();
```

---

## 5. Dashboard：本地查看统计页面

### 5.1 启动

两种方式任选其一：

```bash
npm run build
npm run dashboard:start
```

或 Windows 双击 `start-dashboard.bat`（实际运行 `node dist/dashboard-server.js`）。

默认访问：`http://127.0.0.1:3000`

### 5.2 登录与配置

Dashboard 使用环境变量控制（默认值见 `.env.example` 与 `src/dashboard-config.ts`）：

- `DASHBOARD_HOST` / `DASHBOARD_PORT`
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`
- `DASHBOARD_SESSION_SECRET`（用于签名 session cookie，上线前务必更换）

### 5.3 页面是怎么显示出来的（原理）

Dashboard 是“静态页面 + 前端拉 API + 后端汇总本地 JSON”的结构：

1. `src/dashboard-server.ts` 把 `public/dashboard` 当作静态目录提供（HTML/CSS/JS）
2. 每个页面（例如 `requirements.html`）只提供页面骨架，并加载统一脚本 `public/dashboard/app.js`
3. `app.js` 根据 `<body data-page="...">` 判断当前页，然后请求对应 API（如 `/api/requirements`）
4. 后端 API 从 `.mcp-toolbox/data.json` 读取 rounds/reverts/requirements，按筛选条件过滤并汇总后返回 JSON

---

## 6. Token 同步：从本地日志补全 Token 数据

### 6.1 为什么需要同步

理想情况下，AI 客户端在调用 `record_ai_coding_round` 时就会把 `inputTokens/outputTokens/totalTokens` 填好。

但如果当时填的是 `0`（或者无法获取），项目提供了一个“二次同步”脚本：从 Codex/Claude Code 的本地日志里找到 usage 记录，匹配到某一轮 round，然后回填 Token。

### 6.2 同步脚本与运行方式

- 脚本：`scripts/sync-token-usage.ts`
- 运行：

```bash
npm run tokens:sync
```

也可以按客户端过滤（见 `package.json` scripts）：

- `npm run tokens:sync:codex`
- `npm run tokens:sync:claude`

### 6.3 从日志里能拿到什么数据

同步脚本的输出目标是构造一条候选记录（`RoundCandidate`），包含：

- `inputTokens`、`outputTokens`、`totalTokens`
- `conversationId`、`turnId`（用于更精确地匹配某一轮）
- `modelName`
- `startedAt` / `endedAt`（通常取日志事件时间戳）
- `sourcePath` / `sourceEventId` / `rawEvent` / `note`（作为“证据”，用于审计与排查）

它会根据 `metadata.client`、`metadata.projectPath`、`metadata.threadId/turnId` 等信息，尽量做“精确匹配”；匹配不到时会退化到“时间窗口匹配”。

### 6.4 同步后的写入结果

同步成功后会写回同一个本地存储：

- 更新 `rounds[]` 中该轮的 Token 字段，并设置 `tokenSource` / `tokenSyncStatus` / `tokenSyncedAt`
- 追加一条 `tokenUsageEvents[]` 记录，保存“从哪个日志文件、哪条事件”同步而来

---

## 7. Feishu Docs：读取飞书云文档

### 7.1 需要的环境变量

飞书工具要求（`src/config.ts`）：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_URL`（默认 `https://open.feishu.cn`）

项目会读取：

1. 当前工作目录的 `.env`（dotenv 默认行为）
2. 项目根目录的 `.env`（`src/config.ts` 中显式加载）

MCP client 也可以在配置里直接传 `env`，优先级更高。

### 7.2 对外 tools

定义在 `src/tools/feishu-docs.ts`：

- `feishu_parse_doc_url`：解析 URL，返回文档类型与 token（不请求飞书 API）
- `feishu_get_doc_meta`：读取文档元信息（wiki 会先解析到实际 doc/docx）
- `feishu_get_doc_content`：读取内容并输出 Markdown（docx 使用 blocks API 尽量保留结构）

---

## 8. File Decrypt（IP-Guard）：解密本地文件

### 8.1 需要的环境变量

- `IPGUARD_URL`
- `IPGUARD_NAME`
- `IPGUARD_PASSWORD`

不要把真实凭证写进代码或文档；用 `.env` 或 MCP client 的 `env` 传入。

### 8.2 对外 tool

定义在 `src/tools/file-decrypt.ts`：

- `decrypt_file`
  - 入参：`filePath`（绝对路径）
  - 返回：
    - 文本类文件：`{ type: "text", content, ... }`
    - 二进制文件：`{ type: "binary", decryptedFilePath, ... }`

解密流程在 `src/integrations/ipguard/decrypt.ts`：登录 → 上传 → 检测加密 → 触发解密 → 下载。

---

## 9. 常见问题（排查思路）

1. Dashboard 打不开/一直跳转登录
   - 检查 `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`
   - 检查端口是否被占用
2. Feishu tools 报 “FEISHU_APP_ID and FEISHU_APP_SECRET are required”
   - 补齐 `FEISHU_APP_ID/FEISHU_APP_SECRET`
3. 数据写不到预期位置
   - `data.json` 默认相对 `process.cwd()`；建议显式设置 `MCP_TOOLBOX_STORAGE_DIR`
4. Token 同步无效
   - 记录 round 时建议写 `metadata.client`、`metadata.projectPath`，以便同步脚本匹配
   - 确认本地日志目录存在（Codex：`~/.codex`；Claude Code：`~/.claude/projects`）


