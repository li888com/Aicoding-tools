# AI-Coding 接口触发时机说明

本文用于说明当前项目中各类接口、MCP 工具和同步接口分别在什么场景下触发，帮助判断哪些接口是页面直接使用、哪些是后台任务使用、哪些属于预留或低频能力。

## 1. 总体结论

当前接口大体分为四类：

| 类型 | 触发入口 | 说明 |
| --- | --- | --- |
| MCP 工具 | AI 客户端调用 MCP server | 用于记录 AI Coding 轮次、撤销轮次，或执行飞书/IP-Guard 工具能力 |
| Dashboard 本地接口 | 浏览器访问本地 Dashboard 页面 | 前端 `public/dashboard/app.js` 根据页面和按钮操作请求 `/api/*` |
| 线上同步写接口 | `npm run sync:online` 或 `npm run auto-sync` | 把本地 `.mcp-toolbox/data.json` 中的记录上传到线上 API |
| 远端 Dashboard 查询接口 | 本地 Dashboard 代理 | 配置 `AI_CODING_DASHBOARD_API_BASE_URL` 后，本地查询接口会优先代理到远端 |

## 2. MCP 工具触发时机

| MCP 工具 | 是否使用 | 触发时机 |
| --- | --- | --- |
| `record_ai_coding_round` | 已使用 | 每轮正常 AI Coding 工作结束前，由 AI 客户端调用，用于写入本地 round 记录 |
| `record_ai_coding_round_revert` | 已使用，低频 | 用户明确要求撤销或回滚上一轮代码变更时调用 |
| `feishu_parse_doc_url` | 按需使用 | MCP 客户端需要解析飞书文档 URL 时调用 |
| `feishu_get_doc_meta` | 按需使用 | MCP 客户端需要读取飞书文档元信息时调用 |
| `feishu_get_doc_content` | 按需使用 | MCP 客户端需要读取飞书文档正文内容时调用 |
| `decrypt_file` | 按需使用 | MCP 客户端需要通过 IP-Guard 服务解密本地文件时调用 |

注意：飞书和解密工具不会被 Dashboard 页面自动触发，只有 MCP 客户端明确调用对应工具时才会执行。

## 3. Dashboard 本地接口触发时机

Dashboard 页面统一通过 `public/dashboard/app.js` 请求本地 `/api/*` 接口。除登录页外，页面加载时会先请求 `/api/filters`。

| 本地接口 | 是否使用 | 触发页面或操作 |
| --- | --- | --- |
| `POST /api/login` | 已使用 | 登录页提交用户名和密码 |
| `POST /api/logout` | 已使用 | 点击 Dashboard 退出按钮 |
| `GET /api/session` | 基本未使用 | 服务端有实现，目前前端页面中未看到实际调用，偏预留 |
| `GET /health` | 运维使用 | 健康检查访问 |
| `GET /api/filters` | 已使用 | 任意 Dashboard 页面初始化时加载筛选项 |
| `GET /api/summary` | 已使用 | 总览页加载、刷新或筛选变化 |
| `GET /api/requirements` | 已使用 | 总览页、需求统计页加载、刷新或筛选变化 |
| `GET /api/models` | 已使用 | 总览页、模型页加载、刷新或筛选变化 |
| `GET /api/timeline` | 已使用 | 趋势页加载、刷新或筛选变化 |
| `GET /api/rounds` | 已使用 | 对话明细页加载、刷新或筛选变化 |
| `GET /api/sync-status` | 已使用 | 仅总览页加载自动同步状态卡片 |
| `GET /api/requirement-records` | 已使用 | 打开需求维护页 |
| `PUT /api/requirement-records/:id` | 已使用 | 需求维护页保存需求信息 |
| `DELETE /api/requirement-records/:id` | 已使用 | 需求维护页删除需求维护信息 |
| `GET /api/local-logs/files` | 已使用 | 打开本地日志页，或点击加载日志 |
| `GET /api/local-logs/file` | 已使用 | 本地日志页点击某个日志文件进行预览 |
| `GET /api/corrections` | 已使用 | 打开修正记录页，或点击加载修正记录 |
| `PUT /api/rounds/:id` | 已使用 | 对话明细页编辑 round 后保存 |
| `DELETE /api/rounds/:id` | 已使用 | 对话明细页删除 round |
| `POST /api/rounds/:id/ignore` | 已使用 | 对话明细页点击忽略 |
| `POST /api/rounds/:id/restore` | 已使用 | 对话明细页点击恢复 |
| `POST /api/rounds/:id/token-reset` | 已使用 | 对话明细页点击重置 token |
| `POST /api/rounds/:id/token-sync` | 已使用 | 对话明细页点击重新同步 token |
| `GET /api/rounds/:id/token-candidates` | 已使用 | 对话明细页选择某条 round 后自动加载 token 候选 |
| `POST /api/rounds/:id/token-candidates/:candidateId/bind` | 已使用 | token 候选表点击 Bind 进行人工绑定 |

## 4. 页面与接口对应关系

| 页面 | `data-page` | 页面加载时主要接口 |
| --- | --- | --- |
| `index.html` | `overview` | `/api/filters`、`/api/summary`、`/api/requirements`、`/api/models`、`/api/sync-status` |
| `requirements.html` | `requirements` | `/api/filters`、`/api/requirements` |
| `models.html` | `models` | `/api/filters`、`/api/models` |
| `timeline.html` | `timeline` | `/api/filters`、`/api/timeline` |
| `rounds.html` | `rounds` | `/api/filters`、`/api/rounds`，选择 round 后请求 token 候选 |
| `requirement-maintenance.html` | `requirement-maintenance` | `/api/filters`、`/api/requirement-records` |
| `corrections.html` | `corrections` | `/api/filters`、`/api/corrections` |
| `local-logs.html` | `local-logs` | `/api/filters`、`/api/local-logs/files` |

## 5. 线上同步写接口触发时机

线上写接口不是浏览器页面直接触发，而是由同步脚本触发：

- 手动同步：`npm run sync:online`
- 自动同步：`npm run auto-sync`
- 单次自动同步：`npm run auto-sync:once`

| 线上接口 | 是否使用 | 触发时机 |
| --- | --- | --- |
| `PUT /api/ai-coding/requirements/:requirementId` | 已使用 | 同步本地需求维护记录到线上 |
| `POST /api/ai-coding/rounds` | 已使用 | 同步本地 round 记录到线上 |
| `POST /api/ai-coding/round-reverts` | 已使用 | 同步本地 revert 记录到线上 |
| `POST /api/ai-coding/token-usage-events` | 已使用 | 同步 token usage event 到线上 |
| `POST /api/ai-coding/rounds/:roundId/tokens` | 当前未看到触发 | 文档中曾提到该形式，但现有同步脚本使用 `token-usage-events` 路径 |

同步脚本会跳过测试数据，并通过本地记录的 `_sync` 字段判断是否已同步、失败重试或跳过。

## 6. 远端 Dashboard 查询接口触发时机

本地 Dashboard server 对以下本地查询接口支持远端代理：

| 本地接口 | 远端接口 |
| --- | --- |
| `/api/filters` | `/filters` |
| `/api/summary` | `/summary` |
| `/api/requirements` | `/requirements`，失败后尝试 `/by-requirement` |
| `/api/models` | `/models`，失败后尝试 `/by-model` |
| `/api/timeline` | `/timeline` |
| `/api/rounds` | `/rounds` |

触发条件：

1. 配置了 `AI_CODING_DASHBOARD_API_BASE_URL`，默认值为 `http://localhost:9906/api/ai-coding/dashboard`。
2. 浏览器请求本地 `/api/summary`、`/api/requirements` 等 Dashboard 查询接口。
3. 本地服务优先请求远端 Dashboard API。
4. 如果远端失败，且配置允许本地 fallback，则回退读取本地数据。

`/api/sync-status` 是本地同步 worker 状态接口，不属于远端 Dashboard 统计接口。

## 7. 当前看起来较像预留或低频的接口

| 接口 | 判断 |
| --- | --- |
| `GET /api/session` | 服务端实现了，但前端页面当前基本没有调用 |
| `POST /api/ai-coding/rounds/:roundId/tokens` | 文档中存在，但当前同步脚本没有走该路径 |
| `record_ai_coding_round_revert` | 已实现且符合协议，但只有用户要求撤销代码变更时才会触发 |
| 飞书 MCP 工具 | 已注册，但只在用户请求飞书文档能力时触发 |
| `decrypt_file` | 已注册，但只在用户请求 IP-Guard 文件解密时触发 |

## 8. 排查建议

如果要判断某个接口是否真正被触发，可以按下面顺序排查：

1. 前端页面接口：搜索 `public/dashboard/app.js` 中的 `api("...")` 或 `fetch("...")`。
2. 本地服务实现：搜索 `src/dashboard-server.ts` 中对应路由。
3. 线上同步接口：搜索 `scripts/sync-to-online.ts` 中的 `request(...)`。
4. MCP 工具：搜索 `src/tools/*.ts` 中的 `server.tool(...)`。
5. 远端代理：查看 `src/dashboard-server.ts` 中 `dashboardProxyRoutes`。

