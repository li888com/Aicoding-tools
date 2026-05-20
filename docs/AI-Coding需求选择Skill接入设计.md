# AI Coding 需求选择 Skill 接入设计

## 1. 背景

当前 AI Coding 统计通过 `record_ai_coding_round` 的 `promptText` 解析需求编号。

现有规则：

- prompt 中包含 `#12` 时，本轮绑定需求 `12`，来源为 `prompt`。
- prompt 中没有需求编号时，沿用同一个 `conversationId` 最近一次绑定的需求，来源为 `context`。
- prompt 和会话上下文都没有需求编号时，本轮不关联需求，来源为 `empty`。

这个规则适合做底层协议，但日常使用时仍然需要人工记住需求编号。为了降低使用成本，新增一个 AI Coding 需求选择 skill，让用户通过 `/req` 之类的命令调出需求列表，再选择编号完成会话绑定。

## 2. 目标

实现一个可被 Codex / Claude Code 等 AI Coding 客户端调用的 skill，用于通过公司自有需求 API 查询、选择、绑定需求。

目标能力：

1. 输入 `/req` 时展示最近或活跃需求列表。
2. 输入 `/req 123` 时把当前 AI Coding 会话绑定到需求 `123`。
3. 输入 `/req 关键词` 时按标题、项目、GPM、描述搜索需求。
4. 输入 `/req clear` 时清空当前会话的需求上下文。
5. 绑定完成后，后续普通 AI Coding 轮次不需要再写 `#123`，仍可通过 `conversationId` 自动继承。
6. 底层继续兼容 `#123` prompt 标记，避免破坏现有记录协议。

## 3. 非目标

本方案不替代 `record_ai_coding_round`。

本方案不要求用户每轮都主动选择需求。

本方案不强依赖某一个客户端的斜杠命令实现。客户端不支持 `/` 命令时，也可以通过自然语言触发 skill，例如“选择需求 123”。

## 4. 推荐交互

### 4.1 查看需求

```text
/req
```

返回示例：

```text
请选择要绑定的需求：

1. #123 登录页验证码优化 | CRM | GPM-202605-001 | active
2. #124 订单导出性能优化 | OMS | GPM-202605-002 | active
3. #125 报表权限修复 | BI | GPM-202605-003 | done

输入 /req 123 或直接回复 123 完成绑定。
```

### 4.2 搜索需求

```text
/req 登录
```

返回与关键词匹配的需求列表。

### 4.3 绑定需求

```text
/req 123
```

绑定成功后返回：

```text
已将当前会话绑定到 #123 登录页验证码优化。
后续 AI Coding 轮次会自动沿用该需求。
```

### 4.4 清空绑定

```text
/req clear
```

清空成功后返回：

```text
已清空当前会话需求绑定。后续轮次如果没有 #编号，将记录为未关联需求。
```

## 5. 总体架构

```text
AI Coding Client
        |
        | user: /req 登录
        v
AI Coding Requirement Skill
        |
        | MCP tool: list_ai_coding_requirements
        v
MCP Toolbox
        |
        | HTTP API
        v
Company Requirement API

AI Coding Client
        |
        | user: /req 123
        v
AI Coding Requirement Skill
        |
        | MCP tool: select_ai_coding_requirement
        v
MCP Toolbox
        |
        | update conversation currentRequirementId
        v
.mcp-toolbox/data.json / online sync
```

## 6. 职责划分

### 6.1 Skill 职责

Skill 负责用户交互和命令解释：

- 识别 `/req`、`/req 123`、`/req keyword`、`/req clear`。
- 调用 MCP tool 查询需求列表。
- 将需求列表整理成适合用户选择的短列表。
- 在用户选择编号后调用 MCP tool 绑定当前会话。
- 返回清晰的绑定结果。

Skill 不直接读写本地统计文件，也不直接修改 round 记录。

### 6.2 MCP Toolbox 职责

MCP Toolbox 负责稳定的数据操作：

- 封装公司自有需求 API。
- 校验需求是否存在。
- 保存当前 `conversationId` 的 `currentRequirementId`。
- 提供需求查询、需求选择、清空选择等 MCP tools。
- 后续 `record_ai_coding_round` 沿用现有上下文继承逻辑。

### 6.3 公司需求 API 职责

公司需求 API 负责真实需求数据：

- 按关键词、状态、项目、GPM 查询需求。
- 按需求编号查询详情。
- 返回需求标题、状态、项目、GPM 等展示字段。

## 7. MCP Tool 设计

### 7.1 list_ai_coding_requirements

用途：查询可选择的需求列表。

输入：

```json
{
  "keyword": "登录",
  "status": "active",
  "projectName": "CRM",
  "limit": 10
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `keyword` | 否 | 搜索关键词，可匹配标题、描述、GPM、项目 |
| `status` | 否 | 需求状态，例如 `active` / `done` / `archived` |
| `projectName` | 否 | 项目名称 |
| `limit` | 否 | 返回条数，默认 10，最大 50 |

输出：

```json
{
  "items": [
    {
      "requirementId": 123,
      "title": "登录页验证码优化",
      "projectName": "CRM",
      "gpmNumber": "GPM-202605-001",
      "status": "active",
      "updatedAt": "2026-05-20T10:00:00+08:00"
    }
  ]
}
```

### 7.2 get_ai_coding_requirement

用途：查询单个需求详情，用于绑定前校验或展示确认信息。

输入：

```json
{
  "requirementId": 123
}
```

输出：

```json
{
  "requirementId": 123,
  "title": "登录页验证码优化",
  "projectName": "CRM",
  "gpmNumber": "GPM-202605-001",
  "status": "active",
  "description": "优化登录页验证码交互与错误提示",
  "updatedAt": "2026-05-20T10:00:00+08:00"
}
```

### 7.3 select_ai_coding_requirement

用途：把当前 AI Coding 会话绑定到指定需求。

输入：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "requirementId": 123,
  "selectedBy": "codex"
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `conversationId` | 是 | 当前 AI Coding 会话稳定 ID |
| `requirementId` | 是 | 要绑定的需求编号 |
| `selectedBy` | 否 | 操作来源，例如 `codex` / `claude-code` |

处理规则：

1. 先通过公司需求 API 校验需求存在。
2. 如果需求存在，把本地 conversation 的 `currentRequirementId` 设置为该编号。
3. 如果本地需求维护表没有该需求摘要，可同步保存一份需求快照。
4. 不修改历史 round。
5. 后续 `record_ai_coding_round` 在 prompt 未包含 `#编号` 时，会继承该需求编号。

输出：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "requirementId": 123,
  "requirementLabel": "#123 登录页验证码优化",
  "source": "skill",
  "selectedAt": "2026-05-20T11:30:00+08:00"
}
```

### 7.4 clear_ai_coding_requirement_selection

用途：清空当前会话需求上下文。

输入：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp"
}
```

输出：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "requirementId": null,
  "clearedAt": "2026-05-20T11:35:00+08:00"
}
```

## 8. 公司需求 API 约定

如果公司已有需求 API，MCP Toolbox 只需要适配字段。建议抽象成如下内部接口。

### 8.1 查询需求列表

```http
GET /api/requirements?keyword=登录&status=active&limit=10
```

响应：

```json
{
  "data": [
    {
      "id": 123,
      "title": "登录页验证码优化",
      "projectName": "CRM",
      "gpmNumber": "GPM-202605-001",
      "status": "active",
      "description": "优化登录页验证码交互与错误提示",
      "updatedAt": "2026-05-20T10:00:00+08:00"
    }
  ]
}
```

### 8.2 查询需求详情

```http
GET /api/requirements/123
```

响应：

```json
{
  "data": {
    "id": 123,
    "title": "登录页验证码优化",
    "projectName": "CRM",
    "gpmNumber": "GPM-202605-001",
    "status": "active",
    "description": "优化登录页验证码交互与错误提示",
    "updatedAt": "2026-05-20T10:00:00+08:00"
  }
}
```

## 9. 配置项

建议通过环境变量配置公司需求 API。

```bash
AI_CODING_REQUIREMENT_API_BASE_URL=https://example.com
AI_CODING_REQUIREMENT_API_TOKEN=xxx
AI_CODING_REQUIREMENT_API_TIMEOUT_MS=10000
```

字段说明：

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `AI_CODING_REQUIREMENT_API_BASE_URL` | 是 | 公司需求 API 根地址 |
| `AI_CODING_REQUIREMENT_API_TOKEN` | 否 | 鉴权 token |
| `AI_CODING_REQUIREMENT_API_TIMEOUT_MS` | 否 | 请求超时时间，默认 10000 |

鉴权建议：

- 如果后端需要鉴权，MCP Toolbox 使用 `Authorization: Bearer <token>`。
- 不建议把 token 写入 skill 文档或 prompt。
- skill 只调用 MCP tool，不直接持有 API token。

## 10. Skill 行为规格

### 10.1 命令解析

| 用户输入 | 行为 |
| --- | --- |
| `/req` | 查询活跃需求，返回前 10 条 |
| `/req 123` | 绑定需求 `123` |
| `/req 登录` | 搜索关键词 `登录` |
| `/req clear` | 清空当前会话绑定 |
| `选择需求 123` | 等价于 `/req 123` |

### 10.2 多结果处理

当搜索结果有多条时，skill 只展示必要字段：

```text
找到 3 个需求：

1. #123 登录页验证码优化 | CRM | active
2. #126 登录失败提示优化 | CRM | active
3. #130 单点登录回调修复 | IAM | done

请输入需求编号完成绑定。
```

当搜索结果为空时：

```text
没有找到匹配的需求。可以换一个关键词，或直接输入需求编号。
```

### 10.3 编号歧义处理

如果用户回复 `1`，需要区分它是列表序号还是需求编号。

推荐规则：

1. 用户刚看过列表时，`1` 表示列表第 1 项。
2. `/req 1` 始终表示需求编号 `1`。
3. 为减少歧义，列表中始终展示真实需求编号，例如 `#123`。

## 11. 与现有记录协议的关系

需求选择 skill 只改变当前会话上下文，不改变每轮记录 payload 的结构。

绑定前：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "currentRequirementId": null
}
```

执行：

```text
/req 123
```

绑定后：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "currentRequirementId": 123
}
```

后续记录：

```json
{
  "promptText": "实现验证码错误提示",
  "requirementId": 123,
  "requirementSource": "context"
}
```

如果后续 prompt 显式包含 `#456`，则 `#456` 优先，且会把会话上下文切换到 `456`。

## 12. 错误处理

| 场景 | 返回建议 |
| --- | --- |
| 需求 API 未配置 | “需求 API 未配置，请设置 AI_CODING_REQUIREMENT_API_BASE_URL。” |
| 需求 API 超时 | “需求服务响应超时，请稍后重试。” |
| 需求不存在 | “没有找到 #123 需求，请检查编号。” |
| 鉴权失败 | “需求 API 鉴权失败，请检查 token 配置。” |
| 绑定写入失败 | “需求存在，但当前会话绑定失败，请检查本地存储。” |

所有错误都应该返回给 skill，由 skill 用用户可读的方式说明。

## 13. 落地步骤

建议按以下顺序实现：

1. 新增公司需求 API client。
2. 新增 MCP tools：`list_ai_coding_requirements`、`get_ai_coding_requirement`、`select_ai_coding_requirement`、`clear_ai_coding_requirement_selection`。
3. 扩展本地 conversation 保存逻辑，支持通过 tool 主动更新 `currentRequirementId`。
4. 绑定成功时，把需求摘要同步到本地 requirements 维护表。
5. 编写 skill：识别 `/req` 命令并调用上述 MCP tools。
6. 增加验证脚本，覆盖查询、绑定、清空、后续 round 继承。
7. 更新 AGENTS / 使用说明，让 AI Coding 客户端知道可以用 `/req` 选择需求。

## 14. 验收标准

1. `/req` 能列出需求 API 返回的活跃需求。
2. `/req 123` 能把当前 `conversationId` 绑定到需求 `123`。
3. 绑定后普通 AI Coding 轮次不写 `#123` 也能归属到 `123`。
4. prompt 显式写 `#456` 时，仍然优先绑定 `456`。
5. `/req clear` 后，不写 `#编号` 的新 round 记录为未关联需求。
6. 需求 API 不可用时，skill 返回清楚的错误信息，不影响正常 AI Coding 工作。

