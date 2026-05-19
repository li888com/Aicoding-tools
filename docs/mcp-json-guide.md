# .mcp.json 配置说明

`.mcp.json` 是 MCP (Model Context Protocol) 客户端的项目级配置文件，用于声明当前项目提供了哪些 MCP Server，以及客户端应如何启动它们。

本项目的 `.mcp.json` 配置了一个 MCP Server：`mcp-toolbox`，它向 AI 客户端（如 Claude Code、Codex 等）暴露 AI Coding 统计记录、飞书文档读取和 IP-Guard 文件解密三类工具。

---

## 1. 文件位置与生效范围

- **项目根目录**：`.mcp.json`
- **生效范围**：当前项目。当 AI 客户端在此项目目录（或子目录）中工作时，会自动发现并加载该配置。

> 同一台机器上可以同时存在用户级配置（`~/.claude/.mcp.json` 或 `~/.codex/.mcp.json`）和项目级配置（`<project>/.mcp.json`），两者会合并生效。

---

## 2. 配置格式

```json
{
  "mcpServers": {
    "<server-name>": {
      "command": "<启动命令>",
      "args": ["<参数1>", "<参数2>", "..."],
      "cwd": "<工作目录>",
      "env": {
        "<KEY>": "<value>"
      }
    }
  }
}
```

### 2.1 顶级字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mcpServers` | object | 是 | 以 server 名称为 key 的配置字典。名称仅用于 MCP 客户端内部标识与日志，不要求与 server 代码中 `McpServer.name` 一致（但建议保持一致以便排查）。 |

### 2.2 每个 server 的配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | 启动 MCP server 进程的可执行文件，例如 `node`、`npx`、`python`。 |
| `args` | string[] | 否 | 传给 `command` 的命令行参数。 |
| `cwd` | string | 否 | server 进程的工作目录。支持 `${projectRoot}` 变量，表示 `.mcp.json` 所在的项目根目录。 |
| `env` | object | 否 | 注入到 server 进程的环境变量。适合传入凭据、存储路径等运行时配置。 |

---

## 3. 本项目 `.mcp.json` 解析

```json
{
  "mcpServers": {
    "mcp-toolbox": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "${projectRoot}"
    }
  }
}
```

### 3.1 逐字段说明

| 字段 | 值 | 含义 |
|------|-----|------|
| `command` | `"npx"` | 使用 npx 启动，这样无需全局安装 `tsx`，npx 会自动从项目 `node_modules` 中解析。 |
| `args` | `["tsx", "src/index.ts"]` | 用 tsx 直接运行 TypeScript 源码入口 `src/index.ts`，无需预先 `npm run build` 编译。 |
| `cwd` | `"${projectRoot}"` | 将工作目录设为项目根目录。`${projectRoot}` 由 MCP 客户端自动替换为 `.mcp.json` 所在目录的绝对路径。 |

### 3.2 启动等价命令

上述配置等价于在项目根目录执行：

```bash
npx tsx src/index.ts
```

MCP 客户端（如 Claude Code）会在启动时自动执行该命令，并通过 stdio 与 server 进程通信。

### 3.3 server 启动后注册的 tools

`src/index.ts` 启动后会注册以下 6 个 MCP tools：

| 分类 | Tool 名称 | 功能 |
|------|-----------|------|
| AI Coding Stats | `record_ai_coding_round` | 记录一轮 AI Coding 对话统计 |
| AI Coding Stats | `record_ai_coding_round_revert` | 记录撤销某一轮代码变更 |
| Feishu Docs | `feishu_parse_doc_url` | 解析飞书文档/wiki URL |
| Feishu Docs | `feishu_get_doc_meta` | 读取飞书文档元信息 |
| Feishu Docs | `feishu_get_doc_content` | 读取飞书文档内容（Markdown） |
| File Decrypt | `decrypt_file` | 解密 IP-Guard DRM 加密的本地文件 |

---

## 4. 高级配置：添加环境变量

如果要用到飞书文档或 IP-Guard 解密功能，需要在 `.mcp.json` 中注入对应的环境变量：

```json
{
  "mcpServers": {
    "mcp-toolbox": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "${projectRoot}",
      "env": {
        "MCP_TOOLBOX_STORAGE_DIR": ".mcp-toolbox",
        "FEISHU_APP_ID": "<你的飞书 App ID>",
        "FEISHU_APP_SECRET": "<你的飞书 App Secret>",
        "IPGUARD_URL": "http://192.168.10.30:8095",
        "IPGUARD_NAME": "ipguard-dify",
        "IPGUARD_PASSWORD": "<你的 IP-Guard 密码>"
      }
    }
  }
}
```

### 4.1 支持的环境变量一览

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `MCP_TOOLBOX_STORAGE_DIR` | 统计数据存储目录 | `.mcp-toolbox`（相对于 `cwd`） |
| `FEISHU_APP_ID` | 飞书应用 ID | （无，飞书 tools 必需） |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | （无，飞书 tools 必需） |
| `FEISHU_BASE_URL` | 飞书 API 地址 | `https://open.feishu.cn` |
| `IPGUARD_URL` | IP-Guard 解密服务 URL | `http://192.168.10.30:8095` |
| `IPGUARD_NAME` | IP-Guard 登录用户名 | `ipguard-dify` |
| `IPGUARD_PASSWORD` | IP-Guard 登录密码 | （内置默认值） |
| `MYSQL_HOST` | MySQL 主机（当前未启用远程存储时无实际作用） | `127.0.0.1` |

> **安全提醒**：不要将包含真实凭据的 `.mcp.json` 提交到公共仓库。建议将凭据放在用户级配置（`~/.claude/.mcp.json`），项目级 `.mcp.json` 只保留不含凭据的通用配置。

---

## 5. 配置策略：项目级 vs 用户级

MCP 客户端（如 Claude Code）支持**两级配置合并**，你可以按需拆分：

| 配置级别 | 文件路径 | 适合放什么 |
|----------|----------|------------|
| 项目级 | `<project>/.mcp.json` | 通用启动命令（`command` + `args` + `cwd`），随代码一起提交 |
| 用户级 | `~/.claude/.mcp.json` | 凭据/密钥（`env` 中的 `FEISHU_APP_SECRET` 等敏感信息），不提交 |

**推荐做法**：

- 项目级 `.mcp.json`：只保留 `command`、`args`、`cwd`，以及不敏感的 `env`（如 `MCP_TOOLBOX_STORAGE_DIR`）
- 用户级配置：填写飞书/ipguard 的密钥等敏感 env，这样团队中每人用自己的凭据即可

---

## 6. 常见问题

### 6.1 修改 `.mcp.json` 后不生效？

MCP 客户端通常会在启动时加载配置。修改后需要**重启 AI 客户端**（如重启 Claude Code 会话或 VS Code 窗口）才能让新配置生效。

### 6.2 `command` 用 `node` 还是 `npx`？

| 命令 | 适用场景 |
|------|----------|
| `npx tsx src/index.ts` | 开发阶段，直接跑 TS 源码，无需编译 |
| `node dist/index.js` | 生产/稳定使用，需先 `npm run build` |

本项目的 `.mcp.json` 采用 `npx tsx` 方式，方便开发迭代。

### 6.3 `${projectRoot}` 是什么？

`${projectRoot}` 是 MCP 配置文件支持的**内置变量**，由客户端自动替换为 `.mcp.json` 所在目录的绝对路径。在本项目中即 `c:\Users\00232924\Desktop\mcp`。

### 6.4 如何验证配置是否正确？

```bash
npm run test:mcp
```

该脚本会模拟 MCP 客户端连接 server，列出所有注册的 tools。如果 tools 列表正常输出，说明 `.mcp.json` 配置正确。