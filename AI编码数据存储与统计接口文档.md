# AI Coding 数据存储与统计接口文档

> **基于Git提交**: `3ac022841` — `feat(ai-coding): 新增AI编码数据存储与统计功能`
> **生成日期**: 2026-05-19
> **变更类型**: 🆕 全部为新增接口

***

## 目录

- [通用说明](#通用说明)
  - [基础路径](#基础路径)
  - [统一响应结构](#统一响应结构)
  - [错误码说明](#错误码说明)
  - [认证方式](#认证方式)
- [一、记录轮次](#一记录轮次)
- [二、维护需求](#二维护需求)
- [三、记录撤销](#三记录撤销)
- [四、补录Token](#四补录token)
- [五、Dashboard总览](#五dashboard总览)
- [六、按需求统计](#六按需求统计)
- [七、按模型统计](#七按模型统计)
- [八、日期趋势](#八日期趋势)
- [九、轮次明细](#九轮次明细)
- [十、筛选项](#十筛选项)
- [附录：数据表结构](#附录数据表结构)

***

## 通用说明

### 基础路径

| 环境 | 地址 |
|------|------|
| 本地环境 | `http://localhost:9906` |
| 线上环境 | `https://ai-test.sbtjt.com` |

接口前缀：

```
/api/ai-coding
```

> 完整请求路径 = `基础路径` + `接口前缀` + 具体路径，例如 `https://ai-test.sbtjt.com/api/ai-coding/rounds`。

### 统一响应结构

所有接口均使用 `R<T>` 作为统一响应包装：

| 字段名  | 类型     | 说明                         |
| ---- | ------ | -------------------------- |
| code | int    | 返回标记：**0** = 成功，**1** = 失败 |
| msg  | String | 返回信息，失败时包含错误描述             |
| data | T      | 业务数据，成功时返回具体数据             |

### 错误码说明

| 错误码 | 含义 | 说明                    |
| --- | -- | --------------------- |
| 0   | 成功 | 请求处理成功                |
| 1   | 失败 | 请求处理失败，具体原因见 `msg` 字段 |

**业务异常场景**：

| 场景              | HTTP状态码 | code | msg示例                                                                    |
| --------------- | ------- | ---- | ------------------------------------------------------------------------ |
| 必填参数缺失          | 200     | 1    | `conversationId不能为空` / `startedAt不能为空` / `endedAt不能为空` / `modelName不能为空` |
| 目标round不存在      | 200     | 1    | `目标round不存在`                                                             |
| 目标round已撤销      | 200     | 1    | `目标round已撤销`                                                             |
| Token补录round不存在 | 200     | 1    | `Token补录找不到可更新的round`                                                    |
| 需求状态不合法         | 200     | 1    | `非法状态值: xxx`                                                             |

### 认证方式

**线上环境**：所有接口需在请求头中携带 Authorization 令牌：

```
Authorization: Bearer <token>
```

**本地环境**：使用 Dashboard 的 session cookie 认证（`ai_coding_dashboard_session`），通过 `/api/login` 登录后自动携带。

***

## 一、记录轮次

记录一轮AI Coding统计数据。支持幂等性：若 `idempotencyKey` 已存在，则返回已有记录。

- **接口名称**: AI Coding记录轮次
- **请求方法**: `POST`
- **URL路径**: `/api/ai-coding/rounds`

### 请求参数

Body - JSON (`AiCodingRoundRequestDTO`):

| 参数名               | 类型                   | 必填    | 说明                                                                         |
| ----------------- | -------------------- | ----- | -------------------------------------------------------------------------- |
| idempotencyKey    | String               | 否     | 幂等键，若已存在则返回已有记录                                                            |
| conversationId    | String               | **是** | 会话ID                                                                       |
| startedAt         | String               | **是** | 开始时间，ISO 8601格式（如 `2026-05-19T10:00:00+08:00`）                             |
| endedAt           | String               | **是** | 结束时间，ISO 8601格式                                                            |
| modelName         | String               | **是** | 模型名称（如 `claude-3-opus`）                                                    |
| promptText        | String               | 否     | 提示词文本                                                                      |
| requirementId     | Long                 | 否     | 关联需求ID                                                                     |
| requirementSource | String               | 否     | 需求来源                                                                       |
| requirementTitle  | String               | 否     | 需求标题（首次创建需求时使用）                                                            |
| projectName       | String               | 否     | 项目名称（首次创建需求时使用）                                                            |
| gpmNumber         | String               | 否     | GPM编号（首次创建需求时使用）                                                           |
| filesChanged      | Integer              | 否     | 变更文件数，默认0                                                                  |
| linesAdded        | Integer              | 否     | 新增行数，默认0                                                                   |
| linesDeleted      | Integer              | 否     | 删除行数，默认0                                                                   |
| codeLinesChanged  | Integer              | 否     | 代码变更行数，默认取 linesAdded + linesDeleted                                       |
| inputTokens       | Long                 | 否     | 输入Token数                                                                   |
| outputTokens      | Long                 | 否     | 输出Token数                                                                   |
| totalTokens       | Long                 | 否     | 总Token数                                                                    |
| tokenSource       | String               | 否     | Token来源，默认 `unavailable`                                                   |
| metadata          | Map\<String, Object> | 否     | 扩展元数据，可包含 `client`、`projectPath`、`threadId`、`turnId`、`codeStatsSource` 等字段 |

### 响应数据结构

`data` 字段类型：`AiCodingRoundVO`

| 字段名               | 类型                    | 说明                                       |
| ----------------- | --------------------- | ---------------------------------------- |
| id                | Long                  | 轮次记录ID                                   |
| conversationId    | String                | 会话ID                                     |
| requirementId     | Long                  | 关联需求ID                                   |
| requirementLabel  | String                | 需求标签（格式：`GPM编号-项目名` 或 `需求ID-项目名`）        |
| title             | String                | 需求标题                                     |
| projectName       | String                | 项目名称                                     |
| gpmNumber         | String                | GPM编号                                    |
| requirementSource | String                | 需求来源                                     |
| modelName         | String                | 模型名称                                     |
| startedAt         | LocalDateTime         | 开始时间                                     |
| endedAt           | LocalDateTime         | 结束时间                                     |
| durationMs        | Long                  | 持续时长（毫秒）                                 |
| client            | String                | 客户端标识（如 `claude-code`、`codex`）           |
| filesChanged      | Integer               | 变更文件数                                    |
| linesAdded        | Integer               | 新增行数                                     |
| linesDeleted      | Integer               | 删除行数                                     |
| codeLinesChanged  | Integer               | 代码变更行数                                   |
| inputTokens       | Long                  | 输入Token数                                 |
| outputTokens      | Long                  | 输出Token数                                 |
| totalTokens       | Long                  | 总Token数                                  |
| tokenSource       | String                | Token来源                                  |
| tokenSyncStatus   | String                | Token同步状态：`synced` / `missing` / `issue` |
| tokenSyncedAt     | LocalDateTime         | Token同步时间                                |
| tokenSyncNote     | String                | Token同步备注                                |
| isReverted        | Boolean               | 是否已撤销                                    |
| promptText        | String                | 提示词文本                                    |
| requirement       | AiCodingRequirementVO | 关联需求详情                                   |

**AiCodingRequirementVO**:

| 字段名           | 类型     | 说明    |
| ------------- | ------ | ----- |
| requirementId | Long   | 需求ID  |
| title         | String | 需求标题  |
| projectName   | String | 项目名称  |
| gpmNumber     | String | GPM编号 |

### 请求示例

```json
POST /api/ai-coding/rounds
Content-Type: application/json
Authorization: Bearer eyJhbGciOi...

{
  "idempotencyKey": "round-20260519-001",
  "conversationId": "conv-abc123",
  "startedAt": "2026-05-19T10:00:00+08:00",
  "endedAt": "2026-05-19T10:15:30+08:00",
  "modelName": "claude-3-opus",
  "promptText": "实现用户登录功能",
  "requirementId": 10001,
  "requirementSource": "jira",
  "requirementTitle": "用户认证模块",
  "projectName": "pigx-ai",
  "gpmNumber": "GPM-2026-001",
  "filesChanged": 5,
  "linesAdded": 120,
  "linesDeleted": 30,
  "inputTokens": 5000,
  "outputTokens": 3000,
  "totalTokens": 8000,
  "tokenSource": "claude-api",
  "metadata": {
    "client": "claude-code",
    "projectPath": "/home/user/pigx-ai",
    "threadId": "thread-001",
    "turnId": "turn-001"
  }
}
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": {
    "id": 1923847651928374,
    "conversationId": "conv-abc123",
    "requirementId": 10001,
    "requirementLabel": "GPM-2026-001-pigx-ai",
    "title": "用户认证模块",
    "projectName": "pigx-ai",
    "gpmNumber": "GPM-2026-001",
    "requirementSource": "jira",
    "modelName": "claude-3-opus",
    "startedAt": "2026-05-19T10:00:00",
    "endedAt": "2026-05-19T10:15:30",
    "durationMs": 930000,
    "client": "claude-code",
    "filesChanged": 5,
    "linesAdded": 120,
    "linesDeleted": 30,
    "codeLinesChanged": 150,
    "inputTokens": 5000,
    "outputTokens": 3000,
    "totalTokens": 8000,
    "tokenSource": "claude-api",
    "tokenSyncStatus": "synced",
    "tokenSyncedAt": null,
    "tokenSyncNote": null,
    "isReverted": false,
    "promptText": "实现用户登录功能",
    "requirement": {
      "requirementId": 10001,
      "title": "用户认证模块",
      "projectName": "pigx-ai",
      "gpmNumber": "GPM-2026-001"
    }
  }
}
```

***

## 二、维护需求

维护需求标题、项目、GPM和状态。若需求不存在则自动创建。

- **接口名称**: AI Coding维护需求
- **请求方法**: `PUT`
- **URL路径**: `/api/ai-coding/requirements/{id}`

### 路径参数

| 参数名 | 类型   | 必填    | 说明   |
| --- | ---- | ----- | ---- |
| id  | Long | **是** | 需求ID |

### 请求参数

Body - JSON (`AiCodingRequirementRequestDTO`):

| 参数名         | 类型     | 必填 | 说明                                                   |
| ----------- | ------ | -- | ---------------------------------------------------- |
| title       | String | 否  | 需求标题                                                 |
| projectName | String | 否  | 项目名称                                                 |
| gpmNumber   | String | 否  | GPM编号                                                |
| status      | String | 否  | 需求状态，合法值：`active`、`completed`、`archived`、`cancelled` |
| description | String | 否  | 需求描述                                                 |

### 响应数据结构

`data` 字段类型：`AiCodingRequirementVO`

| 字段名           | 类型     | 说明    |
| ------------- | ------ | ----- |
| requirementId | Long   | 需求ID  |
| title         | String | 需求标题  |
| projectName   | String | 项目名称  |
| gpmNumber     | String | GPM编号 |

### 请求示例

```json
PUT /api/ai-coding/requirements/10001
Content-Type: application/json
Authorization: Bearer eyJhbGciOi...

{
  "title": "用户认证模块V2",
  "projectName": "pigx-ai",
  "gpmNumber": "GPM-2026-001",
  "status": "completed",
  "description": "完成用户登录、注册、权限校验功能"
}
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": {
    "requirementId": 10001,
    "title": "用户认证模块V2",
    "projectName": "pigx-ai",
    "gpmNumber": "GPM-2026-001"
  }
}
```

***

## 三、记录撤销

记录轮次撤销事件，同时将目标轮次标记为已撤销。

- **接口名称**: AI Coding记录撤销
- **请求方法**: `POST`
- **URL路径**: `/api/ai-coding/round-reverts`

### 请求参数

Body - JSON (`AiCodingRoundRevertRequestDTO`):

| 参数名              | 类型                   | 必填    | 说明                                     |
| ---------------- | -------------------- | ----- | -------------------------------------- |
| conversationId   | String               | **是** | 会话ID                                   |
| targetRoundId    | Long                 | **是** | 目标轮次ID（需存在且未撤销）                        |
| revertedAt       | String               | **是** | 撤销时间，ISO 8601格式                        |
| modelName        | String               | 否     | 执行撤销的模型名称                              |
| promptText       | String               | 否     | 撤销提示词                                  |
| reason           | String               | 否     | 撤销原因                                   |
| filesChanged     | Integer              | 否     | 撤销变更文件数，默认0                            |
| linesAdded       | Integer              | 否     | 撤销新增行数，默认0                             |
| linesDeleted     | Integer              | 否     | 撤销删除行数，默认0                             |
| codeLinesChanged | Integer              | 否     | 撤销代码变更行数，默认取 linesAdded + linesDeleted |
| metadata         | Map\<String, Object> | 否     | 扩展元数据                                  |

### 响应数据结构

`data` 字段类型：`Boolean`，成功返回 `true`

### 请求示例

```json
POST /api/ai-coding/round-reverts
Content-Type: application/json
Authorization: Bearer eyJhbGciOi...

{
  "conversationId": "conv-abc123",
  "targetRoundId": 1923847651928374,
  "revertedAt": "2026-05-19T11:00:00+08:00",
  "modelName": "claude-3-opus",
  "promptText": "撤销上一次修改",
  "reason": "代码逻辑有误，需要回退",
  "filesChanged": 3,
  "linesAdded": 0,
  "linesDeleted": 80,
  "metadata": {}
}
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": true
}
```

***

## 四、补录Token

补录Token使用证据并回填轮次Token数据。

- **接口名称**: AI Coding补录Token
- **请求方法**: `POST`
- **URL路径**: `/api/ai-coding/token-usage-events`

### 请求参数

Body - JSON (`AiCodingTokenUsageEventRequestDTO`):

| 参数名            | 类型                   | 必填    | 说明                                             |
| -------------- | -------------------- | ----- | ---------------------------------------------- |
| roundId        | Long                 | **是** | 关联轮次ID（需存在）                                    |
| client         | String               | 否     | 客户端标识（如 `claude-code`、`codex`），用于推断tokenSource |
| sourcePath     | String               | 否     | 数据来源路径                                         |
| sourceEventId  | String               | 否     | 来源事件ID                                         |
| conversationId | String               | 否     | 会话ID                                           |
| turnId         | String               | 否     | 轮次Turn ID                                      |
| modelName      | String               | 否     | 模型名称                                           |
| startedAt      | String               | 否     | 开始时间，ISO 8601格式                                |
| endedAt        | String               | 否     | 结束时间，ISO 8601格式                                |
| inputTokens    | Long                 | 否     | 输入Token数                                       |
| outputTokens   | Long                 | 否     | 输出Token数                                       |
| totalTokens    | Long                 | 否     | 总Token数                                        |
| rawEvent       | Map\<String, Object> | 否     | 原始事件数据                                         |

### 响应数据结构

`data` 字段类型：`Boolean`，成功返回 `true`

> **补充说明**：补录成功后，目标轮次的 `tokenSyncStatus` 将更新为 `synced`，`tokenSyncedAt` 更新为当前时间，`tokenSyncNote` 记录来源路径。

### 请求示例

```json
POST /api/ai-coding/token-usage-events
Content-Type: application/json
Authorization: Bearer eyJhbGciOi...

{
  "roundId": 1923847651928374,
  "client": "claude-code",
  "sourcePath": "/api/usage/2026-05-19",
  "sourceEventId": "evt-001",
  "conversationId": "conv-abc123",
  "turnId": "turn-001",
  "modelName": "claude-3-opus",
  "startedAt": "2026-05-19T10:00:00+08:00",
  "endedAt": "2026-05-19T10:15:30+08:00",
  "inputTokens": 5200,
  "outputTokens": 3100,
  "totalTokens": 8300,
  "rawEvent": {
    "eventId": "evt-001",
    "apiVersion": "v1"
  }
}
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": true
}
```

***

## 五、Dashboard总览

获取AI Coding Dashboard总览统计数据。

- **接口名称**: AI Coding Dashboard总览
- **请求方法**: `GET`
- **URL路径**: `/api/ai-coding/dashboard/summary`

### 请求参数

Query参数 (`AiCodingDashboardQueryDTO`):

| 参数名             | 类型      | 必填 | 默认值     | 说明                                        |
| --------------- | ------- | -- | ------- | ----------------------------------------- |
| from            | String  | 否  | -       | 起始日期（如 `2026-05-01`），筛选 startedAt >= from |
| to              | String  | 否  | -       | 截止日期（如 `2026-05-19`），筛选 startedAt <= to   |
| model           | String  | 否  | -       | 模型名称筛选                                    |
| requirementId   | String  | 否  | -       | 需求ID筛选，传 `null` 筛选未关联需求的轮次                |
| client          | String  | 否  | -       | 客户端标识筛选                                   |
| includeReverted | Boolean | 否  | `false` | 是否包含已撤销轮次                                 |
| limit           | Integer | 否  | `200`   | 返回记录数上限                                   |

### 响应数据结构

`data` 字段类型：`AiCodingDashboardSummaryVO`

| 字段名                  | 类型         | 说明                       |
| -------------------- | ---------- | ------------------------ |
| requirementCount     | Integer    | 关联需求数量（去重）               |
| roundCount           | Integer    | 有效轮次数（不含已撤销）             |
| revertedRounds       | Integer    | 已撤销轮次数                   |
| unlinkedRounds       | Integer    | 未关联需求的轮次数                |
| totalTokens          | Long       | 总Token消耗                 |
| tokenMissingRounds   | Integer    | Token缺失的轮次数              |
| codeLinesChanged     | Integer    | 总代码变更行数                  |
| codeLinesPerKTokens  | BigDecimal | 每千Token代码行数              |
| tokensPerCodeLine    | BigDecimal | 每代码行Token数               |
| tokenSyncedRounds    | Integer    | Token已同步的轮次数             |
| claudeTokenRounds    | Integer    | Claude Code客户端有Token的轮次数 |
| codexTokenRounds     | Integer    | Codex客户端有Token的轮次数       |
| tokenSyncIssueRounds | Integer    | Token同步异常的轮次数            |

### 请求示例

```
GET /api/ai-coding/dashboard/summary?from=2026-05-01&to=2026-05-19&model=claude-3-opus
Authorization: Bearer eyJhbGciOi...
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": {
    "requirementCount": 12,
    "roundCount": 85,
    "revertedRounds": 5,
    "unlinkedRounds": 8,
    "totalTokens": 680000,
    "tokenMissingRounds": 10,
    "codeLinesChanged": 3200,
    "codeLinesPerKTokens": 4.71,
    "tokensPerCodeLine": 212.50,
    "tokenSyncedRounds": 70,
    "claudeTokenRounds": 55,
    "codexTokenRounds": 15,
    "tokenSyncIssueRounds": 5
  }
}
```

***

## 六、按需求统计

获取按需求维度分组的统计数据。

- **接口名称**: AI Coding Dashboard按需求统计
- **请求方法**: `GET`
- **URL路径**: `/api/ai-coding/dashboard/requirements`

### 请求参数

Query参数同 [Dashboard总览](#五dashboard总览) 的 `AiCodingDashboardQueryDTO`。

### 响应数据结构

`data` 字段类型：`List<AiCodingRequirementStatsVO>`

| 字段名                 | 类型            | 说明                   |
| ------------------- | ------------- | -------------------- |
| requirementId       | Long          | 需求ID（未关联时为 null）     |
| requirementLabel    | String        | 需求标签（未关联时显示 `未关联需求`） |
| title               | String        | 需求标题                 |
| projectName         | String        | 项目名称                 |
| gpmNumber           | String        | GPM编号                |
| roundCount          | Integer       | 轮次数                  |
| durationMs          | Long          | 总持续时长（毫秒）            |
| firstStartedAt      | LocalDateTime | 最早开始时间               |
| lastEndedAt         | LocalDateTime | 最晚结束时间               |
| codeLinesChanged    | Integer       | 代码变更行数               |
| totalTokens         | Long          | 总Token消耗             |
| codeLinesPerKTokens | BigDecimal    | 每千Token代码行数          |

> 结果按 `lastEndedAt` 降序排列。

### 请求示例

```
GET /api/ai-coding/dashboard/requirements?from=2026-05-01&to=2026-05-19
Authorization: Bearer eyJhbGciOi...
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": [
    {
      "requirementId": 10001,
      "requirementLabel": "GPM-2026-001-pigx-ai",
      "title": "用户认证模块",
      "projectName": "pigx-ai",
      "gpmNumber": "GPM-2026-001",
      "roundCount": 15,
      "durationMs": 45000000,
      "firstStartedAt": "2026-05-01T09:00:00",
      "lastEndedAt": "2026-05-18T17:30:00",
      "codeLinesChanged": 580,
      "totalTokens": 120000,
      "codeLinesPerKTokens": 4.83
    },
    {
      "requirementId": null,
      "requirementLabel": "未关联需求",
      "title": null,
      "projectName": null,
      "gpmNumber": null,
      "roundCount": 8,
      "durationMs": 12000000,
      "firstStartedAt": "2026-05-02T14:00:00",
      "lastEndedAt": "2026-05-15T11:00:00",
      "codeLinesChanged": 200,
      "totalTokens": 40000,
      "codeLinesPerKTokens": 5.00
    }
  ]
}
```

***

## 七、按模型统计

获取按模型维度分组的统计数据。

- **接口名称**: AI Coding Dashboard按模型统计
- **请求方法**: `GET`
- **URL路径**: `/api/ai-coding/dashboard/models`

### 请求参数

Query参数同 [Dashboard总览](#五dashboard总览) 的 `AiCodingDashboardQueryDTO`。

### 响应数据结构

`data` 字段类型：`List<AiCodingModelStatsVO>`

| 字段名                 | 类型         | 说明           |
| ------------------- | ---------- | ------------ |
| modelName           | String     | 模型名称         |
| effectiveRounds     | Integer    | 有效轮次数（不含已撤销） |
| codeLinesChanged    | Integer    | 代码变更行数       |
| totalTokens         | Long       | 总Token消耗     |
| averageDurationMs   | BigDecimal | 平均持续时长（毫秒）   |
| revertRate          | BigDecimal | 撤销率          |
| codeLinesPerKTokens | BigDecimal | 每千Token代码行数  |

> 结果按 `totalTokens` 降序排列。

### 请求示例

```
GET /api/ai-coding/dashboard/models?from=2026-05-01&to=2026-05-19
Authorization: Bearer eyJhbGciOi...
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": [
    {
      "modelName": "claude-3-opus",
      "effectiveRounds": 60,
      "codeLinesChanged": 2400,
      "totalTokens": 520000,
      "averageDurationMs": 950000,
      "revertRate": 0.05,
      "codeLinesPerKTokens": 4.62
    },
    {
      "modelName": "claude-3-sonnet",
      "effectiveRounds": 25,
      "codeLinesChanged": 800,
      "totalTokens": 160000,
      "averageDurationMs": 600000,
      "revertRate": 0.08,
      "codeLinesPerKTokens": 5.00
    }
  ]
}
```

***

## 八、日期趋势

获取按日期维度的时间线统计数据。

- **接口名称**: AI Coding Dashboard日期趋势
- **请求方法**: `GET`
- **URL路径**: `/api/ai-coding/dashboard/timeline`

### 请求参数

Query参数同 [Dashboard总览](#五dashboard总览) 的 `AiCodingDashboardQueryDTO`。

### 响应数据结构

`data` 字段类型：`List<AiCodingTimelineStatsVO>`

| 字段名              | 类型      | 说明                 |
| ---------------- | ------- | ------------------ |
| day              | String  | 日期（如 `2026-05-19`） |
| roundCount       | Integer | 当日轮次数（不含已撤销）       |
| totalTokens      | Long    | 当日总Token消耗         |
| codeLinesChanged | Integer | 当日代码变更行数           |

> 结果按日期升序排列。

### 请求示例

```
GET /api/ai-coding/dashboard/timeline?from=2026-05-15&to=2026-05-19
Authorization: Bearer eyJhbGciOi...
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": [
    {
      "day": "2026-05-15",
      "roundCount": 8,
      "totalTokens": 64000,
      "codeLinesChanged": 320
    },
    {
      "day": "2026-05-16",
      "roundCount": 12,
      "totalTokens": 96000,
      "codeLinesChanged": 480
    },
    {
      "day": "2026-05-19",
      "roundCount": 5,
      "totalTokens": 40000,
      "codeLinesChanged": 200
    }
  ]
}
```

***

## 九、轮次明细

获取轮次明细列表。

- **接口名称**: AI Coding Dashboard轮次明细
- **请求方法**: `GET`
- **URL路径**: `/api/ai-coding/dashboard/rounds`

### 请求参数

Query参数同 [Dashboard总览](#五dashboard总览) 的 `AiCodingDashboardQueryDTO`，其中 `limit` 参数控制返回数量。

### 响应数据结构

`data` 字段类型：`List<AiCodingRoundVO>`

各字段同 [一、记录轮次](#一记录轮次) 中的 `AiCodingRoundVO` 结构。

> 结果按 `startedAt` 降序排列，默认最多返回200条。

### 请求示例

```
GET /api/ai-coding/dashboard/rounds?from=2026-05-19&limit=10
Authorization: Bearer eyJhbGciOi...
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": [
    {
      "id": 1923847651928374,
      "conversationId": "conv-abc123",
      "requirementId": 10001,
      "requirementLabel": "GPM-2026-001-pigx-ai",
      "title": "用户认证模块",
      "projectName": "pigx-ai",
      "gpmNumber": "GPM-2026-001",
      "requirementSource": "jira",
      "modelName": "claude-3-opus",
      "startedAt": "2026-05-19T10:00:00",
      "endedAt": "2026-05-19T10:15:30",
      "durationMs": 930000,
      "client": "claude-code",
      "filesChanged": 5,
      "linesAdded": 120,
      "linesDeleted": 30,
      "codeLinesChanged": 150,
      "inputTokens": 5000,
      "outputTokens": 3000,
      "totalTokens": 8000,
      "tokenSource": "claude-api",
      "tokenSyncStatus": "synced",
      "tokenSyncedAt": null,
      "tokenSyncNote": null,
      "isReverted": false,
      "promptText": "实现用户登录功能",
      "requirement": {
        "requirementId": 10001,
        "title": "用户认证模块",
        "projectName": "pigx-ai",
        "gpmNumber": "GPM-2026-001"
      }
    }
  ]
}
```

***

## 十、筛选项

获取Dashboard可用的筛选项列表。

- **接口名称**: AI Coding Dashboard筛选项
- **请求方法**: `GET`
- **URL路径**: `/api/ai-coding/dashboard/filters`

### 请求参数

Query参数同 [Dashboard总览](#五dashboard总览) 的 `AiCodingDashboardQueryDTO`。

### 响应数据结构

`data` 字段类型：`AiCodingDashboardFiltersVO`

| 字段名          | 类型                            | 说明               |
| ------------ | ----------------------------- | ---------------- |
| models       | List\<String>                 | 可用模型名称列表（去重、排序）  |
| requirements | List\<AiCodingFilterOptionVO> | 可用需求列表           |
| clients      | List\<String>                 | 可用客户端标识列表（去重、排序） |

**AiCodingFilterOptionVO**:

| 字段名   | 类型     | 说明                        |
| ----- | ------ | ------------------------- |
| id    | Long   | 需求ID（首项 `null` 代表"未关联需求"） |
| label | String | 需求标签                      |

### 请求示例

```
GET /api/ai-coding/dashboard/filters
Authorization: Bearer eyJhbGciOi...
```

### 响应示例

```json
{
  "code": 0,
  "msg": null,
  "data": {
    "models": [
      "claude-3-opus",
      "claude-3-sonnet"
    ],
    "requirements": [
      {
        "id": null,
        "label": "未关联需求"
      },
      {
        "id": 10001,
        "label": "GPM-2026-001-pigx-ai"
      },
      {
        "id": 10002,
        "label": "GPM-2026-002-data-service"
      }
    ],
    "clients": [
      "claude-code",
      "codex"
    ]
  }
}
```

***

## 附录：数据表结构

本次提交涉及4张数据库表：

### ai\_coding\_rounds — AI编码轮次表

| 字段名               | 数据库列名                | 类型            | 说明        |
| ----------------- | -------------------- | ------------- | --------- |
| id                | id                   | Long          | 主键（雪花ID）  |
| conversationId    | conversation\_id     | String        | 会话ID      |
| idempotencyKey    | idempotency\_key     | String        | 幂等键       |
| startedAt         | started\_at          | LocalDateTime | 开始时间      |
| endedAt           | ended\_at            | LocalDateTime | 结束时间      |
| durationMs        | duration\_ms         | Long          | 持续时长（毫秒）  |
| modelName         | model\_name          | String        | 模型名称      |
| promptText        | prompt\_text         | String        | 提示词       |
| requirementId     | requirement\_id      | Long          | 关联需求ID    |
| requirementSource | requirement\_source  | String        | 需求来源      |
| client            | client               | String        | 客户端标识     |
| projectPath       | project\_path        | String        | 项目路径      |
| threadId          | thread\_id           | String        | 线程ID      |
| turnId            | turn\_id             | String        | 轮次Turn ID |
| codeStatsSource   | code\_stats\_source  | String        | 代码统计来源    |
| filesChanged      | files\_changed       | Integer       | 变更文件数     |
| linesAdded        | lines\_added         | Integer       | 新增行数      |
| linesDeleted      | lines\_deleted       | Integer       | 删除行数      |
| codeLinesChanged  | code\_lines\_changed | Integer       | 代码变更行数    |
| inputTokens       | input\_tokens        | Long          | 输入Token数  |
| outputTokens      | output\_tokens       | Long          | 输出Token数  |
| totalTokens       | total\_tokens        | Long          | 总Token数   |
| tokenSource       | token\_source        | String        | Token来源   |
| tokenSyncStatus   | token\_sync\_status  | String        | Token同步状态 |
| tokenSyncedAt     | token\_synced\_at    | LocalDateTime | Token同步时间 |
| tokenSyncNote     | token\_sync\_note    | String        | Token同步备注 |
| isReverted        | is\_reverted         | Boolean       | 是否已撤销     |
| metadata          | metadata             | String(JSON)  | 扩展元数据     |
| delFlag           | del\_flag            | String        | 逻辑删除标记    |
| createBy          | create\_by           | String        | 创建人       |
| updateBy          | update\_by           | String        | 更新人       |
| createTime        | create\_time         | LocalDateTime | 创建时间      |
| updateTime        | update\_time         | LocalDateTime | 更新时间      |

### ai\_coding\_requirements — AI编码需求表

| 字段名           | 数据库列名           | 类型            | 说明       |
| ------------- | --------------- | ------------- | -------- |
| id            | id              | Long          | 主键（雪花ID） |
| requirementId | requirement\_id | Long          | 需求ID     |
| title         | title           | String        | 需求标题     |
| projectName   | project\_name   | String        | 项目名称     |
| gpmNumber     | gpm\_number     | String        | GPM编号    |
| status        | status          | String        | 需求状态     |
| description   | description     | String        | 需求描述     |
| delFlag       | del\_flag       | String        | 逻辑删除标记   |
| createBy      | create\_by      | String        | 创建人      |
| updateBy      | update\_by      | String        | 更新人      |
| createTime    | create\_time    | LocalDateTime | 创建时间     |
| updateTime    | update\_time    | LocalDateTime | 更新时间     |

### ai\_coding\_round\_reverts — AI编码轮次撤销表

| 字段名              | 数据库列名                | 类型            | 说明       |
| ---------------- | -------------------- | ------------- | -------- |
| id               | id                   | Long          | 主键（雪花ID） |
| conversationId   | conversation\_id     | String        | 会话ID     |
| targetRoundId    | target\_round\_id    | Long          | 目标轮次ID   |
| revertedAt       | reverted\_at         | LocalDateTime | 撤销时间     |
| modelName        | model\_name          | String        | 模型名称     |
| promptText       | prompt\_text         | String        | 提示词      |
| reason           | reason               | String        | 撤销原因     |
| filesChanged     | files\_changed       | Integer       | 变更文件数    |
| linesAdded       | lines\_added         | Integer       | 新增行数     |
| linesDeleted     | lines\_deleted       | Integer       | 删除行数     |
| codeLinesChanged | code\_lines\_changed | Integer       | 代码变更行数   |
| metadata         | metadata             | String(JSON)  | 扩展元数据    |
| delFlag          | del\_flag            | String        | 逻辑删除标记   |
| createBy         | create\_by           | String        | 创建人      |
| updateBy         | update\_by           | String        | 更新人      |
| createTime       | create\_time         | LocalDateTime | 创建时间     |
| updateTime       | update\_time         | LocalDateTime | 更新时间     |

### ai\_coding\_token\_usage\_events — AI编码Token使用事件表

| 字段名            | 数据库列名             | 类型            | 说明        |
| -------------- | ----------------- | ------------- | --------- |
| id             | id                | Long          | 主键（雪花ID）  |
| roundId        | round\_id         | Long          | 关联轮次ID    |
| client         | client            | String        | 客户端标识     |
| sourcePath     | source\_path      | String        | 数据来源路径    |
| sourceEventId  | source\_event\_id | String        | 来源事件ID    |
| conversationId | conversation\_id  | String        | 会话ID      |
| turnId         | turn\_id          | String        | 轮次Turn ID |
| modelName      | model\_name       | String        | 模型名称      |
| startedAt      | started\_at       | LocalDateTime | 开始时间      |
| endedAt        | ended\_at         | LocalDateTime | 结束时间      |
| inputTokens    | input\_tokens     | Long          | 输入Token数  |
| outputTokens   | output\_tokens    | Long          | 输出Token数  |
| totalTokens    | total\_tokens     | Long          | 总Token数   |
| rawEvent       | raw\_event        | String(JSON)  | 原始事件数据    |
| delFlag        | del\_flag         | String        | 逻辑删除标记    |
| createBy       | create\_by        | String        | 创建人       |
| updateBy       | update\_by        | String        | 更新人       |
| createTime     | create\_time      | LocalDateTime | 创建时间      |
| updateTime     | update\_time      | LocalDateTime | 更新时间      |

