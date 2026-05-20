# AI Coding 数据存储与统计接口实现方案

本文基于当前 MCP Toolbox 的本地记录、Token 回填、撤销轮次、需求维护和线上同步能力，给出一套可落地的实现方案，用于支撑《AI Coding 数据存储与统计接口文档》的后端接口与统计页面。

## 0. 决策摘要

本方案当前建议采用“本地优先记录 + 异步 Token 回填 + 定时同步线上”的路线。

当前先做：

1. 每轮 AI Coding 结束时先写本地 round，token 可以为 0。
2. 后台定时执行 `tokens:sync`，从 Codex / Claude 日志回填 token。
3. 后台定时执行 `sync:online`，把本地数据上传线上。
4. Dashboard 展示需求统计、Token 数据质量、异常状态和 round 明细。
5. 对 `ambiguous`、需求归属错误、测试数据混入等问题提供人工修正入口。

当前暂不做：

1. 不要求脱敏，`promptText`、`metadata`、必要的 `rawEvent` 可以按原始字段保存。
2. 不做实时阻塞式 token 同步，避免拖慢 AI 回复。
3. 不做全量历史日志高频扫描，历史修复由人工或低频任务触发。

核心风险：

| 风险 | 处理策略 |
| --- | --- |
| Token 错配 | 优先 `turnId` / tool call 精确匹配；时间窗口只允许唯一候选自动回填 |
| 测试数据污染 | 所有测试脚本使用临时 storage，线上同步跳过测试 prompt |
| 需求归属错误 | Dashboard 支持修改和批量调整 round 的 requirementId |
| 自动任务卡顿 | 限频、限时间窗口、加锁、单次限制处理数量 |
| 线上重复数据 | 所有写接口设计幂等键或唯一键 |

上线验收标准：

1. `#555` 这类需求能看到 round、代码行数和 token。
2. `totalTokens=0` 的 round 能通过 `tokens:sync` 回填。
3. `ambiguous` 能被筛选出来，并能人工绑定 token event。
4. 重复执行 `sync:online` 不会重复创建线上 round。
5. `test:tokens` 不写入真实统计数据。

## 1. 建设目标

实现一套统一的 AI Coding 数据链路：

1. AI 客户端在每轮编码结束时写入一条 round 记录。
2. 本地先保存完整原始统计，避免网络不可用导致数据丢失。
3. Token 不可用时先记为 pending，后续通过 Codex / Claude 日志回填。
4. 支持需求编号、需求标题、项目名、GPM 编号维护。
5. 支持撤销轮次，不删除原始记录，只在有效统计中排除。
6. 支持同步到线上接口，供 Dashboard 和全局报表统计。
7. 测试数据与真实数据隔离，避免验证脚本污染业务统计。

## 2. 总体架构

推荐采用“本地采集 + 本地补全 + 线上汇总”的架构。

```text
Claude Code / Codex
        |
        | MCP tool: record_ai_coding_round
        v
本地 MCP Toolbox
        |
        | .mcp-toolbox/data.json
        v
本地原始记录
        |
        | scripts/sync-token-usage.ts
        v
Token 回填与证据记录
        |
        | scripts/sync-to-online.ts
        v
线上 AI Coding API
        |
        v
Dashboard / 统计报表
```

关键原则：

- 本地记录是第一落点，优先保证“每轮都能记下来”。
- 线上接口是汇总层，负责跨人员、跨项目、跨需求统计。
- Token 同步是异步补偿，不阻塞每轮记录。
- 撤销通过单独事件表达，原始 round 不覆盖、不删除。

## 3. 核心数据模型

### 3.1 ai_coding_rounds

保存每轮 AI Coding 明细。

核心字段：

| 字段 | 说明 |
| --- | --- |
| id | 线上 round 主键 |
| idempotency_key | 幂等键，建议使用 `local-round-${localRoundId}` 或客户端生成 UUID |
| conversation_id | 会话稳定 ID，例如 `codex:C:/Users/xxx/project` |
| requirement_id | 需求编号，来自 `#555` 或会话上下文继承 |
| requirement_source | `prompt` / `context` / `empty` |
| model_name | 模型名称 |
| started_at / ended_at | 本轮开始与结束时间 |
| duration_ms | 后端计算耗时 |
| prompt_text | 用户原始 prompt |
| files_changed | 变更文件数 |
| lines_added / lines_deleted | 新增 / 删除行数 |
| code_lines_changed | 代码变更总行数 |
| input_tokens / output_tokens / total_tokens | Token 统计 |
| token_source | `mcp_payload` / `codex_log` / `claude_jsonl` / `unavailable` |
| token_sync_status | `pending` / `synced` / `not_found` / `ambiguous` / `failed` |
| token_synced_at | Token 回填时间 |
| token_sync_note | Token 回填说明 |
| metadata_json | 扩展 JSON，保存 client、projectPath、threadId、turnId 等 |
| created_at / updated_at | 审计时间 |

### 3.2 ai_coding_requirements

保存需求维护信息。

| 字段 | 说明 |
| --- | --- |
| requirement_id | 需求编号 |
| title | 需求标题 |
| project_name | 项目名 |
| gpm_number | GPM 编号 |
| status | `active` / `done` / `archived` |
| description | 备注 |
| created_at / updated_at | 审计时间 |

需求编号可以由 prompt 中 `#555` 自动解析，但标题、项目名、GPM 编号建议通过 Dashboard 或接口维护，避免从自然语言中误抽取。

### 3.3 ai_coding_round_reverts

保存撤销事件。

| 字段 | 说明 |
| --- | --- |
| id | 撤销事件 ID |
| target_round_id | 被撤销的 round |
| conversation_id | 会话 ID |
| reverted_at | 撤销完成时间 |
| reason | 撤销原因 |
| files_changed / lines_added / lines_deleted | 撤销本身产生的代码变更 |
| metadata_json | 扩展信息 |

有效统计时排除存在撤销事件的 `target_round_id`。

### 3.4 ai_coding_token_usage_events

保存 Token 回填证据，便于排查“为什么这条 round 是这个 token 数”。

| 字段 | 说明 |
| --- | --- |
| id | 证据 ID |
| round_id | 关联 round |
| client | `codex` / `claude-code` |
| source_path | 日志来源路径 |
| source_event_id | 日志事件 ID 或 tool call ID |
| conversation_id | 日志中的线程 / 会话 ID |
| turn_id | 日志中的 turn ID |
| model_name | 日志中的模型 |
| started_at / ended_at | 日志事件时间 |
| input_tokens / output_tokens / total_tokens | 回填 Token |
| raw_event_json | 精简后的原始证据 |

## 4. 写入链路

### 4.1 每轮正常记录

AI 客户端每轮结束前调用：

```text
record_ai_coding_round
```

MCP 本地写入字段：

```json
{
  "conversationId": "codex:C:/Users/00232924/Desktop/mcp",
  "startedAt": "2026-05-19T07:00:00.000Z",
  "endedAt": "2026-05-19T07:10:00.000Z",
  "modelName": "gpt-5.5",
  "promptText": "#555 实现 AI Coding 数据存储与统计接口",
  "filesChanged": 3,
  "linesAdded": 180,
  "linesDeleted": 20,
  "codeLinesChanged": 200,
  "inputTokens": 0,
  "outputTokens": 0,
  "totalTokens": 0,
  "metadata": {
    "client": "codex",
    "projectPath": "C:/Users/00232924/Desktop/mcp",
    "threadId": "optional-thread-id",
    "turnId": "optional-turn-id",
    "codeStatsSource": "git diff --numstat",
    "tokenStatsUnavailable": true
  }
}
```

处理规则：

1. 从 `promptText` 解析 `#555`。
2. 如果本轮没有编号，沿用同一 `conversationId` 的上一个需求编号。
3. 如果 token 为 0，写入 `tokenSyncStatus=pending`。
4. 如果 token 大于 0，写入 `tokenSyncStatus=synced`，`tokenSource=mcp_payload`。

### 4.2 撤销记录

用户要求撤销时，先回滚代码，再调用：

```text
record_ai_coding_round_revert
```

处理规则：

1. 不删除原始 round。
2. 新增一条 revert 事件。
3. Dashboard 的有效统计过滤掉被撤销 round。
4. 审计页面仍可展示原始 round 与 revert 事件。

## 5. Token 回填方案

Token 回填不要依赖用户手动填，应该做异步补偿。

### 5.0 异步 Token 生命周期

必须明确：AI Coding round 写入时，通常还拿不到准确 token。准确 token 往往要等本轮执行结束、Codex / Claude 把日志落盘之后，再通过 `npm run tokens:sync` 扫描日志才能得到。

因此接口和数据状态不能设计成“写 round 时 token 必填”，而应该设计成两步：

```text
第 1 步：本轮结束前记录 round
  record_ai_coding_round
  inputTokens = 0
  outputTokens = 0
  totalTokens = 0
  tokenSource = unavailable
  tokenSyncStatus = pending

第 2 步：本轮结束后扫描客户端日志
  npm run tokens:sync
  或 npm run tokens:sync:codex / npm run tokens:sync:claude

第 3 步：找到唯一匹配 token 后回填 round
  inputTokens / outputTokens / totalTokens 更新为真实值
  tokenSource = codex_log 或 claude_jsonl
  tokenSyncStatus = synced
  tokenUsageEvents 新增一条证据记录
```

如果没找到日志，状态变为 `not_found`；如果找到多个候选，状态变为 `ambiguous`，不能自动写入，避免把别的轮次 token 记到当前需求上。

对应到线上接口，建议也拆成两类写入：

1. `POST /api/ai-coding/rounds`：先写 round，token 可以为 0。
2. `POST /api/ai-coding/rounds/{roundId}/tokens` 或同步后的 `POST /api/ai-coding/token-usage-events`：后续回填 token 和证据。

也就是说，`totalTokens=0` 不是错误，而是一个正常的中间状态。统计页面需要展示 pending 数，并允许后台任务或手动触发补录。

推荐的本地执行顺序：

```bash
# 1. AI 客户端完成一轮后，MCP 自动写入 round，token 先 pending

# 2. 扫描日志并回填本地 data.json
npm run tokens:sync -- --project C:/Users/00232924/Desktop/mcp

# 3. 再把已补全的数据同步线上
npm run sync:online
```

如果要在用户每轮结束后自动化，可以在客户端收尾流程中追加一个异步任务：先返回用户结果，再由后台定时执行 `tokens:sync` 和 `sync:online`。不要阻塞用户最终回复等待 token 扫描。

### 5.0.1 自动化任务性能控制

自动化不建议每轮同步时阻塞 AI 回复，也不建议高频全量扫描历史日志。推荐使用后台补偿任务，并控制扫描范围。

推荐频率：

| 任务 | 建议频率 | 说明 |
| --- | --- | --- |
| `tokens:sync` | 每 2-5 分钟一次 | 只处理 pending / not_found / failed 的 round |
| `sync:online` | 每 5-10 分钟一次 | 上传已记录或已补全的数据 |
| 全量 token 修复 | 手动触发 | 只在排查历史数据时使用 |

推荐策略：

1. 只扫需要处理的 round：`totalTokens=0` 或 `tokenSyncStatus` 为 `pending`、`not_found`、`failed`。
2. 默认限制时间窗口，例如只扫最近 24 小时；日常使用可缩小到最近 2-6 小时。
3. 每轮 AI 结束后延迟 30-60 秒再尝试同步，避免日志尚未落盘导致误判 `not_found`。
4. 后台任务加锁，保证同一时间只有一个 token sync 在执行。
5. 一次任务最多处理固定数量 round，例如 100 或 200 条，避免长时间占用。
6. `ambiguous` 不自动重试高频扫描，应进入人工处理或低频修复流程。

推荐后台循环：

```text
每 3 分钟：
  npm run tokens:sync -- --project C:/Users/00232924/Desktop/mcp --since <最近24小时>

每 10 分钟：
  npm run sync:online
```

这样做不会明显拖慢后台。真正需要避免的是“每分钟递归扫描全部历史 `.codex/sessions` 并全量上传线上”。

### 5.1 Codex 回填

优先级：

1. `metadata.turnId` 精确匹配 `~/.codex/sessions/**/*.jsonl`。
2. MCP record tool call 与 round id / startedAt / endedAt 精确匹配。
3. 时间窗口唯一匹配。
4. SQLite 日志兜底：`~/.codex/logs_2.sqlite`、`~/.codex/state_5.sqlite`。

当前已实现的关键点：

- Windows 不强依赖 `sqlite3` CLI。
- 支持 `C:\path` 与 `C:/path` 归一化匹配。
- `test:tokens` 使用临时存储目录，避免写入真实 `data.json`。
- 如果一个 round 时间窗口命中多个候选 turn，标记 `ambiguous`，不强行写入。

### 5.2 Claude Code 回填

从 `~/.claude/projects/**/*.jsonl` 扫描 assistant 消息：

1. 优先匹配成功的 MCP record tool call。
2. 其次按 prompt / conversation / 时间窗口匹配。
3. Token 总数应包含：
   - `input_tokens`
   - `output_tokens`
   - `cache_creation_input_tokens`
   - `cache_read_input_tokens`

### 5.3 Token 状态语义

| 状态 | 说明 |
| --- | --- |
| `pending` | MCP payload 没有 token，等待回填 |
| `synced` | 已成功回填或 payload 已有 token |
| `not_found` | 扫描日志未找到候选 |
| `ambiguous` | 找到多个候选，不能安全写入 |
| `failed` | 回填过程异常 |

### 5.4 Token 状态流转图

```text
record_ai_coding_round
        |
        | token = 0
        v
    pending
        |
        | tokens:sync 找到唯一候选
        v
    synced

    pending
        |
        | tokens:sync 未找到候选
        v
    not_found
        |
        | 后续日志落盘后重新扫描
        v
    synced / not_found

    pending
        |
        | tokens:sync 找到多个候选
        v
    ambiguous
        |
        | 人工选择正确 token event
        v
    synced

    pending
        |
        | 扫描过程异常
        v
    failed
        |
        | 修复异常后重试
        v
    synced / failed
```

状态处理原则：

1. `pending` 是正常中间状态，不代表错误。
2. `not_found` 可以自动低频重试，因为日志可能延迟落盘。
3. `ambiguous` 不自动高频重试，必须人工确认或等待更强匹配信息。
4. `failed` 需要记录错误原因，修复后可重新触发同步。
5. `synced` 默认不重复回填，除非用户手动清空 token 或重新绑定。

## 6. 线上 API 设计

线上统一前缀：

```text
/api/ai-coding
```

### 6.1 记录 round

```http
POST /api/ai-coding/rounds
```

要求：

- 支持 `idempotencyKey`。
- 如果相同幂等键已存在，直接返回原 round。
- 后端自动计算 `durationMs`。
- `codeLinesChanged` 缺省时取 `linesAdded + linesDeleted`。
- `totalTokens` 缺省时取 `inputTokens + outputTokens`。

### 6.2 维护需求

```http
PUT /api/ai-coding/requirements/{requirementId}
GET /api/ai-coding/requirements
DELETE /api/ai-coding/requirements/{requirementId}
```

用途：

- 补充需求标题、项目名、GPM 编号。
- 控制需求状态。
- Dashboard 下拉筛选与统计聚合使用。

### 6.3 记录撤销

```http
POST /api/ai-coding/round-reverts
```

要求：

- 校验目标 round 存在。
- 同一目标 round 只能撤销一次。
- 返回撤销事件，并在有效统计中排除目标 round。

### 6.4 Token 补录

```http
POST /api/ai-coding/rounds/{roundId}/tokens
POST /api/ai-coding/token-usage-events
```

建议分两层：

1. `rounds/{roundId}/tokens` 更新 round 汇总 token。
2. `token-usage-events` 保存证据。

这样 Dashboard 看汇总快，排查问题也能追溯来源。

### 6.5 统计查询

建议提供：

```http
GET /api/ai-coding/dashboard/summary
GET /api/ai-coding/dashboard/by-requirement
GET /api/ai-coding/dashboard/by-model
GET /api/ai-coding/dashboard/timeline
GET /api/ai-coding/rounds
```

当前后端联调时已经采用并验证以下 Dashboard 展示接口：

```text
GET /api/ai-coding/dashboard/filters
GET /api/ai-coding/dashboard/summary
GET /api/ai-coding/dashboard/requirements
GET /api/ai-coding/dashboard/models
GET /api/ai-coding/dashboard/timeline
GET /api/ai-coding/dashboard/rounds
```

其中 `requirements/models` 是当前推荐命名；`by-requirement/by-model` 可以作为历史兼容别名保留，但不再作为前端首选路径。

通用筛选参数：

| 参数 | 说明 |
| --- | --- |
| `from` / `to` | 时间范围 |
| `requirementId` | 需求筛选 |
| `projectName` | 项目筛选 |
| `modelName` | 模型筛选 |
| `client` | 客户端筛选 |
| `includeReverted` | 是否包含已撤销 round |
| `tokenSyncStatus` | Token 状态筛选 |

## 7. 统计口径

### 7.1 有效 round

默认统计只包含：

- 未被撤销的 round。
- 正常写入的 round。

不排除 token pending 的 round，因为代码行数、轮次数仍然有效；但 token 相关指标需要明确 pending 数量。

### 7.2 核心指标

Dashboard 顶部建议展示：

- 总轮次
- 有效轮次
- 需求数
- 变更文件数
- 新增行数
- 删除行数
- 代码变更总行数
- 总 token
- 平均每轮 token
- 每代码行 token
- Token pending / ambiguous / failed 数量

### 7.3 按需求统计

每个需求展示：

- 需求编号与标题
- 项目名 / GPM 编号
- round 数
- 模型分布
- 代码变更行数
- token 总量
- 最近活动时间
- pending token 数

### 7.4 按模型统计

每个模型展示：

- round 数
- token 总量
- 输入 / 输出 token
- 代码变更行数
- 平均耗时
- 每千 token 产出代码行数

## 8. 本地到线上同步

本地同步脚本职责：

```bash
npm run sync:online
```

推荐流程：

1. 同步 requirements。
2. 同步 rounds，拿到线上 round id。
3. 同步 round reverts，把本地 targetRoundId 映射成线上 id。
4. 同步 tokenUsageEvents。
5. 每项写 `_sync.status`、`_sync.onlineId`、`_sync.syncedAt`、`_sync.error`。

环境变量：

```env
SYNC_API_BASE_URL=https://ai-test.sbtjt.com/api/ai-coding
SYNC_API_TOKEN=xxx
MCP_TOOLBOX_STORAGE_DIR=.mcp-toolbox
```

同步必须支持断点续传。某一条失败不能影响后续记录，失败项保留 `_sync.status=failed`，并记录：

```text
_sync.failedAttempts
_sync.lastAttemptAt
_sync.nextRetryAt
_sync.error
```

默认失败重试使用指数退避，避免后台任务高频重复撞同一条失败数据。需要立即重试时可执行：

```bash
npm run sync:online -- --retry-failed-now
```

## 9. 实施步骤

### 第一阶段：本地链路稳定

1. 固化 MCP tool 入参和本地 `data.json` 结构。
2. 保证每轮都调用 `record_ai_coding_round`。
3. Codex / Claude 都写入 `client`、`projectPath`、`threadId`、`turnId`。
4. 完善 `scripts/sync-token-usage.ts`，确保 token 可回填。
5. 测试脚本全部使用临时存储，不能污染真实数据。

交付标准：

- `npm run test:mcp` 通过。
- `npm run test:tokens` 能同步临时记录 token。
- 真实 #需求 round 能通过 `tokens:sync` 回填 token。

### 第二阶段：线上接口落地

1. 创建线上表结构。
2. 实现 rounds / requirements / reverts / token events 写接口。
3. 实现幂等键。
4. 实现统一响应 `R<T>`。
5. 实现鉴权。
6. 用 `sync-to-online.ts --dry-run` 对齐 payload。

交付标准：

- 本地数据可同步到线上。
- 重复同步不会重复创建 round。
- 撤销事件能正确影响有效统计。

### 第三阶段：统计与 Dashboard

1. 实现 summary、by-requirement、by-model、timeline、rounds 明细接口。
2. Dashboard 展示 token 状态和异常原因。
3. 支持按需求、项目、模型、客户端、日期筛选。
4. 支持查看 token usage event 证据。

交付标准：

- #555 这类需求能看到轮次、代码行数、token。
- pending / ambiguous 能被筛出来。
- 被撤销 round 不进入默认统计。

### 第四阶段：运维与质量

1. 定时执行 token sync。
2. 定时执行 sync online。
3. 对 failed / ambiguous 做告警或页面提示。
4. 对数据文件加备份。
5. 对线上接口增加审计日志。

## 10. 风险与处理

| 风险 | 表现 | 处理 |
| --- | --- | --- |
| 测试脚本污染真实数据 | 出现 `#999 token sync verification` | 测试使用临时 storage |
| 路径格式不一致 | Windows `C:\` 与 `C:/` 匹配失败 | 所有项目路径归一化 |
| 缺少 turnId | token 无法精确匹配 | 使用 MCP tool call 或时间窗口唯一匹配 |
| 时间窗口命中多个候选 | token 可能错配 | 标记 `ambiguous`，人工处理 |
| 用户撤销代码 | 统计虚高 | 记录 revert，默认统计排除 |
| 本地网络不可用 | 线上缺数据 | 本地先落盘，后续断点同步 |
| JSON 文件并发写 | 数据损坏 | 本地锁机制，线上最终替代 JSON |

## 11. 方案不足与补强清单

当前方案已经能支撑 MVP，但如果要长期稳定运行，还需要补齐以下能力。

### 11.1 Round 与 Token 绑定仍需更强

不足：

- 当前可以通过 `turnId`、MCP tool call、时间窗口匹配 token，但真实客户端不一定每次都能传 `turnId`。
- 时间窗口匹配虽然可用，但只适合唯一候选场景；一旦同一时间段有多个 turn，就会进入 `ambiguous`。

补强建议：

1. 把 `metadata.client`、`metadata.projectPath`、`metadata.threadId`、`metadata.turnId` 提升为推荐必填字段。
2. `record_ai_coding_round` 返回后，把 round id 与当前 turn id 写入日志证据，后续优先用 tool call 精确匹配。
3. 对没有 `turnId` 的 round，只允许唯一候选自动回填；多候选必须人工确认。
4. Dashboard 增加“Token 匹配证据”页面，显示候选 turn、时间、模型、token 增量和来源文件。

### 11.2 幂等与唯一键还需要覆盖所有写入

不足：

- round 已规划 `idempotencyKey`，但 revert、token usage event、requirement upsert 的唯一约束还需要明确。
- 如果本地同步脚本重试，可能出现重复 token event 或重复撤销事件。

补强建议：

| 数据 | 推荐唯一键 |
| --- | --- |
| round | `idempotency_key` |
| requirement | `requirement_id` |
| round revert | `target_round_id` |
| token usage event | `client + source_path + source_event_id` |
| 本地到线上映射 | `metadata.localRoundId` / `_sync.onlineId` |

线上接口需要保证重复请求返回已有数据，而不是重复创建。

### 11.3 测试数据隔离需要制度化

不足：

- 如果测试脚本写入真实 `.mcp-toolbox/data.json`，会污染需求统计，例如 `#999 token sync verification`。

补强建议：

1. 所有 `verify-*`、`test:*` 脚本默认使用临时 `MCP_TOOLBOX_STORAGE_DIR`。
2. 临时目录建议放在 `.mcp-toolbox/verify-*`，脚本开始前清理，结束后可保留用于排查。
3. `sync-to-online` 上传前增加过滤策略，默认跳过 `#999 token sync verification` 等测试 prompt。
4. Dashboard 增加“测试数据”标记或过滤条件。

### 11.4 自动同步需要 checkpoint 与锁

不足：

- 当前可通过 `--since` 控制扫描范围，但还没有明确“扫到哪个文件哪一行”的 checkpoint。
- 如果后台任务重复启动，可能多个同步进程同时扫日志或上传线上。

补强建议：

1. 增加本地 `syncState`，记录每个客户端最近扫描的文件、行号、时间和状态。
2. token sync 与 online sync 都加进程锁。
3. 单次任务限制最大 round 数，例如 100 或 200。
4. 自动任务只处理最近 24 小时的 pending / failed / not_found，历史修复单独手动触发。
5. `ambiguous` 不进入高频自动重试，只进入人工队列。

### 11.5 数据质量展示还不够

不足：

- 如果只展示 token 总量，用户不知道哪些数据是已同步、哪些是 pending、哪些是 ambiguous。

解决方案：

把“Token 数据质量”作为 Dashboard 的一等指标，而不是藏在 round 明细里。后端统计接口负责算清楚，前端用卡片、表格和筛选入口展示出来。

后端需要在 `GET /api/ai-coding/dashboard/summary` 增加：

| 字段 | 说明 |
| --- | --- |
| `tokenPendingRounds` | 等待日志回填的 round 数 |
| `tokenNotFoundRounds` | 扫描日志后没找到 token 的 round 数 |
| `tokenAmbiguousRounds` | 找到多个候选，无法自动回填的 round 数 |
| `tokenFailedRounds` | 回填过程异常的 round 数 |
| `tokenSyncedRounds` | 已拿到真实 token 的 round 数 |
| `tokenCompletenessRate` | `tokenSyncedRounds / 需要 token 的 round 数` |
| `lastTokenSyncedAt` | 最近一次 token 回填时间 |
| `lastOnlineSyncedAt` | 最近一次线上同步时间 |

后端需要在 `GET /api/ai-coding/dashboard/by-requirement` 增加：

| 字段 | 说明 |
| --- | --- |
| `tokenPendingRounds` | 当前需求下 pending round 数 |
| `tokenIssueRounds` | 当前需求下 not_found / ambiguous / failed 总数 |
| `tokenCompletenessRate` | 当前需求 token 完整率 |
| `lastTokenSyncedAt` | 当前需求最近 token 回填时间 |

后端需要在 `GET /api/ai-coding/rounds` 支持筛选：

```text
tokenSyncStatus=pending
tokenSyncStatus=not_found
tokenSyncStatus=ambiguous
tokenSyncStatus=failed
```

前端展示方式：

1. 总览页增加一组“数据质量卡片”：
   - Pending
   - Not Found
   - Ambiguous
   - Failed
   - Token 完整率
   - 最近同步时间
2. 需求统计表增加“Token 完整率”列。
3. Round 明细页增加 `tokenSyncStatus` 筛选。
4. 点击 `ambiguous` 卡片时跳转到 Round 明细，并自动筛选 `tokenSyncStatus=ambiguous`。
5. 后续再增加人工处理页：展示候选 token event，用户选择正确候选并绑定到 round。

建议的状态口径：

```text
需要 token 的 round = 有效 round 中 tokenSource = unavailable 或 tokenStatsUnavailable = true 的 round
token 完整率 = tokenSyncedRounds / 需要 token 的 round
```

也可以用更简单的 MVP 口径：

```text
token 完整率 = tokenSyncedRounds / 有效 round 数
```

MVP 推荐先用简单口径，后续再区分“无需 token 的 round”和“待回填的 round”。

落地顺序：

1. 后端 summary 拆分 `pending/not_found/ambiguous/failed`。
2. 前端总览页展示质量卡片。
3. by-requirement 增加完整率字段和列。
4. rounds 增加 `tokenSyncStatus` 筛选。
5. 做 ambiguous 人工绑定入口。

补强建议：

Dashboard 需要增加数据质量指标：

- pending round 数
- not_found round 数
- ambiguous round 数
- failed round 数
- 最近 token sync 时间
- 最近 online sync 时间
- 每个需求的 token 完整率
- 每个项目的同步失败数

需求统计页建议展示“Token 完整率”：

```text
已同步 round 数 / 需要 token 回填的 round 数
```

### 11.6 隐私与脱敏策略暂不实施

当前约定：

- 当前阶段暂不要求脱敏。
- 本地与线上可以按原始字段保存 `promptText`、`metadata` 和必要的 `rawEvent` 证据。
- 只需要保证权限隔离，避免未授权用户查看不属于自己的数据。

后续如果进入多人、多团队或更严格合规场景，再预留以下能力：

1. 线上同步前做字段白名单。
2. `rawEvent` 可配置为只保留必要证据字段。
3. 本地路径可选转为 `projectPathHash`。
4. `promptText` 可配置是否上传全文。
5. 增加按项目、团队、用户维度的访问控制。

### 11.7 接口文档还需要补齐的内容

当前《AI Coding 数据存储与统计接口文档》还建议补充：

1. 所有枚举值统一表：`tokenSyncStatus`、`tokenSource`、`requirementSource`、`requirementStatus`。
2. 每个接口的幂等规则和唯一键。
3. Token 二阶段回填的状态流转图。
4. `ambiguous` 人工处理接口。
5. 线上字段隐私策略说明。当前阶段可标注“暂不脱敏”。
6. 分页、排序、筛选参数的统一规则。
7. 数据库索引建议。
8. 时区规则：入参统一 ISO 8601，存储建议 UTC。
9. 测试脚本不进入真实统计的约定。
10. 本地 JSON 到线上数据库的迁移策略。

### 11.8 数据库索引建议

线上表需要提前设计索引，否则统计接口数据量上来后会慢。

建议索引：

| 表 | 索引 |
| --- | --- |
| `ai_coding_rounds` | `idempotency_key` 唯一索引 |
| `ai_coding_rounds` | `requirement_id, ended_at` |
| `ai_coding_rounds` | `conversation_id, ended_at` |
| `ai_coding_rounds` | `token_sync_status, ended_at` |
| `ai_coding_rounds` | `model_name, ended_at` |
| `ai_coding_requirements` | `requirement_id` 唯一索引 |
| `ai_coding_round_reverts` | `target_round_id` 唯一索引 |
| `ai_coding_token_usage_events` | `client, source_path, source_event_id` 唯一索引 |
| `ai_coding_token_usage_events` | `round_id` |

### 11.9 需求归属仍需可修正

不足：

- 当前主要依赖 prompt 中的 `#555` 和同一 `conversationId` 的上下文继承。
- 如果用户忘写需求编号，或者一个会话中切换多个需求，round 可能被归到错误需求。
- 一旦需求归属错误，后续按需求统计的代码行数、token 和轮次都会偏。

补强建议：

1. Dashboard 的 round 明细页支持修改 `requirementId`。
2. 支持批量调整 round 所属需求，例如勾选多条 round 后统一改到 `#555`。
3. 保存需求调整审计记录，记录调整前后 requirementId、操作人、操作时间和原因。
4. 需求切换时建议客户端显式写入新 `#编号`，减少上下文继承误判。

### 11.10 Token 匹配需要置信度

不足：

- `tokenSyncStatus=synced` 只能说明已经写入 token，但不能说明匹配质量。
- `turnId` 精确匹配、MCP tool call 匹配、时间窗口唯一匹配的可信度不同。

补强建议：

增加字段：

| 字段 | 说明 |
| --- | --- |
| `tokenMatchQuality` | 匹配质量 |
| `tokenMatchConfidence` | 可选，数值化置信度 |

推荐枚举：

| 值 | 说明 | 建议置信度 |
| --- | --- | --- |
| `exact_tool_call` | 通过 MCP record tool call 精确匹配 | 高 |
| `turn_id` | 通过客户端 turnId 精确匹配 | 高 |
| `prompt_tool_call` | 通过 prompt 和 tool call 关联 | 中 |
| `time_window` | 通过时间窗口唯一匹配 | 中低 |
| `manual` | 人工选择 token event 后绑定 | 高，但需保留审计 |

Dashboard 展示 token 时应显示匹配质量。统计报表可以默认纳入所有 `synced` 数据，但数据质量页要能筛选 `time_window`，方便复查。

### 11.11 数据修正能力还不完整

不足：

- 真实使用中一定会遇到需求归错、token 错配、测试数据混入、撤销标错等情况。
- 如果没有修正入口，只能手动改 JSON 或数据库，风险高。

补强建议：

Dashboard 增加“数据修正”能力：

1. 修改 round 的 `requirementId`。
2. 标记 round 为忽略统计。
3. 重新触发某条 round 的 token sync。
4. 手动绑定 token usage event。
5. 清除错误 token 并恢复为 `pending`。
6. 撤销或恢复某条 revert 记录。
7. 所有修正都写审计日志。

当前已落地的修正能力：

- 修改 round 基础字段和需求归属。
- `ambiguous` 候选 token event 人工绑定。
- 清除错误 token 并恢复为 `pending`。
- 重新触发单条 round 的 token sync。
- 标记 round 为忽略统计，并支持恢复。
- 修正操作写入 `aiCodingCorrections` 审计记录。
- Dashboard 已提供“修正审计”页面，可按 roundId 查看修正历史。

忽略统计采用软标记，不删除原始 round：

```json
{
  "metadata": {
    "ignoredForStats": true,
    "ignoredAt": "ISO-8601",
    "ignoredReason": "reason"
  }
}
```

Dashboard 默认排除被忽略 round，可通过 `includeIgnored=true` 查看并恢复。

建议增加修正事件表：

```text
ai_coding_corrections
```

核心字段：

- `id`
- `target_type`
- `target_id`
- `action`
- `before_json`
- `after_json`
- `reason`
- `operator`
- `created_at`

### 11.12 统计口径还需要定稿

不足：

- 代码行数是否包含文档、配置、SQL、生成文件，需要明确。
- 测试脚本、验证脚本、格式化改动是否计入 AI Coding 产出，需要明确。
- 撤销后的代码行数是否抵消，还是只从有效统计中排除原 round，需要明确。

补强建议：

在正式接口文档中增加“统计口径定义”：

| 口径 | 建议 |
| --- | --- |
| 文档变更 | 默认计入 `codeLinesChanged`，但可通过文件类型单独拆分 |
| 生成文件 | 默认计入，除非在 ignore 规则中排除 |
| 构建产物 | 默认排除，例如 `dist/` |
| node_modules | 永远排除 |
| 测试脚本 | 计入代码改动，但测试验证数据不计入业务需求 |
| 撤销 round | 默认从有效统计中排除，不做负数抵消 |
| token pending round | 轮次数和代码行数计入，token 指标按 0 并展示 pending |

本地已提供文件类型维度统计脚本：

```text
npm run code:stats

sourceLinesChanged
docLinesChanged
configLinesChanged
testLinesChanged
generatedLinesChanged
```

`code:stats` 基于 `git diff --numstat` 分类统计 source / doc / config / test / generated / other。执行 `npm run code:stats -- --metadata` 可以输出适合直接写入 MCP metadata 的结构，用于线上按统计口径拆分展示。

当前 `scripts/call-record-round-via-mcp.ts` 已自动读取 `code:stats -- --metadata`，并把 `fileCategorySummary`、`fileCategoryStats` 和文件分类列表写入 round metadata。可用以下命令验证：

```bash
npm run test:record-code-stats
```

Dashboard summary 已聚合 `fileCategorySummary`，总览页展示 Source / Docs / Config / Tests / Generated / Other 拆分；需求统计页也会按需求展示 Source / Docs / Tests 简表。旧 round 没有该 metadata 时按 0 处理，不影响既有统计。

线上同步时，`scripts/sync-to-online.ts` 会把 `metadata.fileCategorySummary` 同步为 `POST /api/ai-coding/rounds` 的顶层字段：

```json
{
  "sourceLinesChanged": 0,
  "docLinesChanged": 0,
  "configLinesChanged": 0,
  "testLinesChanged": 0,
  "generatedLinesChanged": 0,
  "otherLinesChanged": 0
}
```

这样线上 `ai_coding_rounds` 可以在第 7 章原表结构基础上，通过增量列直接聚合代码类型拆分；`metadata` 仍保留完整原始证据。

### 11.13 多用户、多项目隔离还需要细化

不足：

- 当前主要靠 `projectPath` 区分项目，线上场景下还需要用户、团队、项目权限。
- 如果多个用户同步到同一线上服务，需要避免互相看到不该看的 prompt 和统计。

补强建议：

线上模型增加：

| 字段 | 说明 |
| --- | --- |
| `userId` | 提交数据的用户 |
| `teamId` | 团队或组织 |
| `projectKey` | 稳定项目标识 |
| `projectPathHash` | 本地路径 hash，避免暴露完整路径 |
| `client` | `codex` / `claude-code` |

权限建议：

1. 普通用户只能看自己的 round。
2. 项目管理员可以看项目内所有 round。
3. 团队管理员可以看团队汇总。
4. 线上 API token 绑定用户或服务账号，不能所有人共用一个全局 token。

### 11.14 落地优先级与解决路线

这些补强点不建议一次性全部做完，推荐按“先防错、再可修、再自动化、最后平台化”的顺序推进。

#### P0：先保证数据不乱

目标：降低 token 错配、需求误归属和测试污染的概率。

必须做：

1. 标准化 metadata。

   每条 round 都尽量写入：

   ```json
   {
     "client": "codex",
     "projectPath": "C:/Users/00232924/Desktop/mcp",
     "threadId": "current-thread-id",
     "turnId": "current-turn-id"
   }
   ```

2. 增加 `tokenMatchQuality`。

   推荐优先级：

   ```text
   exact_tool_call > turn_id > prompt_tool_call > time_window
   ```

   Dashboard 展示 token 时同步展示匹配质量。

3. 测试数据隔离。

   所有 `test:*`、`verify-*` 脚本默认写临时 storage，不进入真实 `.mcp-toolbox/data.json`。

4. 项目路径归一化。

   写入时就统一 `C:/path` 或统一规范化格式，避免后续 `C:\path` 与 `C:/path` 匹配失败。

#### P1：让数据可以被安全修正

目标：即使出现误归属、错配、混入测试数据，也能通过页面修回来，并保留审计。

必须做：

1. Round 明细页支持修改 `requirementId`。
2. 支持批量调整 round 所属需求。
3. 支持重新触发某条 round 的 token sync。
4. 支持 `ambiguous` 手动绑定 token event。
5. 支持清空错误 token，恢复为 `pending`。
6. 增加修正审计表 `ai_coding_corrections`。

审计至少记录：

```text
target_type / target_id / action / before_json / after_json / reason / operator / created_at
```

#### P2：后台自动化与数据质量可视化

目标：减少人工操作，同时让用户知道数据是否完整可信。

必须做：

1. 后台 token sync 加锁，避免多个进程并发扫描。
2. 增加 checkpoint，记录扫描到哪个文件、哪一行、哪个时间点。
3. 默认只扫最近 24 小时 pending / failed / not_found 的 round。
4. 单次任务限制最大处理数，例如 100 或 200。
5. Dashboard 增加数据质量卡片：
   - pending
   - not_found
   - ambiguous
   - failed
   - token 完整率
   - 最近 token sync 时间
   - 最近 online sync 时间
6. 按需求展示 token 完整率。

#### P3：平台化与权限治理

目标：支持多人、多项目、线上长期使用。

必须做：

1. 线上增加 `userId`、`teamId`、`projectKey`、`projectPathHash`。
2. 线上 API token 绑定用户或服务账号。
3. 统计口径正式定稿，明确文档、配置、测试、构建产物是否计入。
4. 线上 Dashboard 按用户、团队、项目授权展示。
5. 脱敏策略当前不作为必做项，仅保留配置扩展点。

推荐推进顺序：

```text
P0: metadata 标准化 + tokenMatchQuality + 测试隔离 + 路径归一化
P1: 数据修正页 + ambiguous 手动绑定 + 审计记录
P2: checkpoint 后台同步 + 数据质量 Dashboard
P3: 权限隔离 + 完整统计口径 + 脱敏预留
```

这样可以先把“数据可信”立住，再逐步做到“自动化”和“平台化”。

## 12. 推荐改造点

当前项目已经具备核心能力，建议继续补强：

1. 给 `record_ai_coding_round` 增加可选字段：
   - `requirementTitle`
   - `projectName`
   - `gpmNumber`
   - `idempotencyKey`
2. 自动把 `metadata.projectPath` 做路径归一化后保存。
3. 在 Dashboard 的 round 明细页增加 Token 证据入口。
4. 给 `ambiguous` 增加手动绑定功能：选择某个 tokenUsageEvent 回填到目标 round。
5. 增加 `npm run tokens:sync:recent`，默认同步最近 24 小时当前项目。
6. 增加线上同步前校验：发现 `#999 token sync verification` 这类测试数据时默认跳过。

## 13. 最小可行版本

如果要快速上线，建议先做 MVP：

1. 线上实现 `POST /rounds`、`PUT /requirements/{id}`、`POST /round-reverts`。
2. 本地继续负责 token 回填。
3. 本地同步脚本把回填后的 rounds 上传线上。
4. 线上 Dashboard 先做 summary、by-requirement、rounds 明细。
5. tokenUsageEvents 第二阶段再接入，但本地先保留证据。

这样可以最快把“需求维度统计 AI Coding 投入”跑起来，同时保留后续精确追溯 token 的扩展空间。

## 14. 开发任务拆分

### 14.1 后端任务

1. 实现线上表结构：
   - `ai_coding_rounds`
   - `ai_coding_requirements`
   - `ai_coding_round_reverts`
   - `ai_coding_token_usage_events`
   - `ai_coding_corrections`
2. 实现写接口：
   - `POST /api/ai-coding/rounds`
   - `PUT /api/ai-coding/requirements/{requirementId}`
   - `POST /api/ai-coding/round-reverts`
   - `POST /api/ai-coding/rounds/{roundId}/tokens`
   - `POST /api/ai-coding/token-usage-events`
3. 实现统计接口：
   - `GET /api/ai-coding/dashboard/summary`
   - `GET /api/ai-coding/dashboard/by-requirement`
   - `GET /api/ai-coding/dashboard/by-model`
   - `GET /api/ai-coding/dashboard/timeline`
   - `GET /api/ai-coding/rounds`
4. 实现幂等和唯一约束：
   - round 使用 `idempotencyKey`
   - revert 使用 `targetRoundId`
   - token event 使用 `client + sourcePath + sourceEventId`
5. 实现数据修正接口：
   - 修改 round 的 requirementId
   - 清空 token 并恢复 pending
   - 手动绑定 token event
   - 标记 round 忽略统计
6. 实现权限字段：
   - `userId`
   - `teamId`
   - `projectKey`
   - `projectPathHash`

### 14.2 前端 Dashboard 任务

1. 总览页增加 Token 数据质量卡片：
   - pending
   - not_found
   - ambiguous
   - failed
   - token 完整率
   - 最近同步时间
2. 需求统计页增加：
   - token 完整率
   - token 异常数
   - 最近 token 回填时间
3. Round 明细页增加：
   - `tokenSyncStatus` 筛选
   - `tokenMatchQuality` 展示
   - 修改 requirementId
   - 重新触发 token sync
4. 增加 ambiguous 人工处理入口：
   - 展示候选 token event
   - 支持选择候选并绑定
   - 绑定后写修正审计
5. 增加数据修正记录页面或抽屉。
6. Dashboard 展示接口先通过本地代理接入测试服务：
   - 浏览器仍请求本地 `/api/summary`、`/api/requirements`、`/api/filters` 等路径。
   - 本地 Dashboard server 优先转发到 `AI_CODING_DASHBOARD_API_BASE_URL`，当前默认值为 `http://localhost:9906/api/ai-coding/dashboard`。
   - 后续切线上时只需要改 `AI_CODING_DASHBOARD_API_BASE_URL`，不改前端页面。
   - 代理会兼容展示接口命名差异：本地 `/api/requirements` 优先请求远端 `/requirements`，失败后尝试 `/by-requirement`；本地 `/api/models` 优先请求远端 `/models`，失败后尝试 `/by-model`。
   - 远端如果返回 `{ code, msg, data, ok }` 统一响应壳，代理会自动解包 `data`，让前端继续消费原来的数组或对象结构。
   - 代理会补齐 Dashboard 必需的展示字段默认值，例如 `tokenSyncStatuses`、`tokenPendingRounds`、`tokenCompletenessRate`、`fileCategorySummary`，避免线上测试接口字段暂未完整时页面空白。
   - 测试服务返回 424、5xx、超时或未启动时，默认回退到本地 JSON 汇总，避免 Dashboard 白屏。
   - 可通过 `AI_CODING_DASHBOARD_API_FALLBACK_LOCAL=false` 关闭回退，用于线上强校验。
   - 可通过 `AI_CODING_DASHBOARD_API_TIMEOUT_MS` 调整代理超时时间。

当前 `localhost:9906/api/ai-coding/dashboard` 已完成一次联调验证：

- `filters` 已返回 `tokenSyncStatuses`。
- `summary` 已返回 `tokenPendingRounds`、`tokenNotFoundRounds`、`tokenAmbiguousRounds`、`tokenFailedRounds`、`tokenCompletenessRate`、`lastTokenSyncedAt`、`lastOnlineSyncedAt`、`fileCategorySummary`。
- `requirements` 已返回 `tokenPendingRounds`、`tokenIssueRounds`、`tokenCompletenessRate`、`lastTokenSyncedAt`、`fileCategorySummary`。
- `models`、`timeline`、`rounds` 已可返回 Dashboard 现有页面需要的数据。
- 仍建议后端把 `totalTokens`、`durationMs`、`inputTokens`、`outputTokens` 等数值字段从字符串改为 JSON number，并把时间字段改为 ISO 8601。

### 14.3 脚本与自动化任务

1. 完善 `scripts/sync-token-usage.ts`：
   - 支持 checkpoint
   - 支持进程锁
   - 支持 `tokenMatchQuality`
   - 支持最近 24 小时增量扫描
2. 增加 `npm run tokens:sync:recent`。当前已落地，默认同步当前项目最近 24 小时、最多 200 条 pending / failed / not_found round。
3. 完善 `scripts/sync-to-online.ts`：
   - 上传前跳过测试数据。当前已支持跳过 `#999 token sync verification`、Dashboard API 验证 round、`metadata.skipOnlineSync=true` 和 `metadata.testData=true`
   - 支持 token event 幂等上传
   - 支持失败重试和 `_sync.error`。当前已支持 `failedAttempts`、`lastAttemptAt`、`nextRetryAt` 和 `--retry-failed-now`
4. 增加后台自动同步脚本：
   - 每 2-5 分钟 token sync
   - 每 5-10 分钟 sync online
   - 单次限制处理数量
5. 所有测试脚本默认使用临时 storage。

当前已落地的自动化入口：

```bash
npm run tokens:sync:recent
npm run auto-sync
npm run auto-sync:once
```

`auto-sync` 会循环执行 token 回填和线上同步，并通过 `.mcp-toolbox/auto-sync.lock` 加锁，避免同一项目重复启动多个同步进程。默认参数：

```text
AUTO_SYNC_TOKEN_INTERVAL_MS = 180000
AUTO_SYNC_ONLINE_INTERVAL_MS = 600000
AUTO_SYNC_SINCE_HOURS = 24
AUTO_SYNC_LOOKBACK_MS = 1800000
AUTO_SYNC_TOKEN_LIMIT = 200
AUTO_SYNC_ONLINE_LIMIT = 200
```

`AUTO_SYNC_SINCE_HOURS` 是兜底扫描窗口。worker 已有上次成功 token sync 时间时，会优先用 checkpoint，并向前回看 `AUTO_SYNC_LOOKBACK_MS`，避免日志落盘延迟导致漏扫。

Windows 本地可用以下脚本后台启动：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-auto-sync.ps1
```

运行状态会写入本地 `autoSyncState`，Dashboard 通过 `/api/sync-status` 展示：

- worker 是否运行
- 本轮 token 扫描起点
- 本轮 token 处理数量和批量上限
- 本轮 online 处理数量和批量上限
- 最近 token sync 时间
- 最近 online sync 时间
- 最近错误
- 未配置 `SYNC_API_TOKEN` 时，online sync 显示为 `skipped`，不按失败处理
- 总览页的业务统计接口不能被同步状态接口阻塞；`/api/sync-status` 失败时只显示同步状态不可用，不影响 KPI 和图表渲染。

### 14.4 运维任务

1. 配置 `SYNC_API_BASE_URL` 和 `SYNC_API_TOKEN`。
2. 配置后台任务运行方式：
   - Windows 任务计划程序
   - PM2
   - Docker
   - 或系统服务
3. 增加本地数据备份。
4. 增加同步失败日志查看入口。
5. 制定线上 API token 更换流程。

## 15. 验收标准

### 15.1 本地记录验收

1. AI 客户端每轮结束后都能写入 round。
2. prompt 包含 `#555` 时，round 自动归属 requirementId `555`。
3. prompt 不包含编号时，能继承同一 conversation 的需求编号。
4. 未拿到 token 时，round 状态为 `pending`，`totalTokens=0`。
5. 撤销操作会写入 revert 事件，原始 round 不被删除。

### 15.2 Token 回填验收

1. `npm run tokens:sync` 能把 pending round 回填为 `synced`。
2. Codex 可以从 `~/.codex/sessions/**/*.jsonl` 回填 token。
3. Claude Code 可以从 `~/.claude/projects/**/*.jsonl` 回填 token。
4. 多候选时状态变为 `ambiguous`，不会自动乱写。
5. 人工绑定 token event 后，round 变为 `synced`。
6. `tokenUsageEvents` 保留来源证据。

### 15.3 线上同步验收

1. `npm run sync:online:dry` 能展示待上传数据，不实际写线上。
2. 配置 `SYNC_API_TOKEN` 后，`npm run sync:online` 能上传数据。
3. 重复执行 `sync:online` 不重复创建 round。
4. round、revert、token event 都能正确映射本地 ID 与线上 ID。
5. 某条数据上传失败时不影响后续数据。

### 15.4 Dashboard 验收

1. 总览页能看到总 round、有效 round、代码行、token。
2. 总览页能看到 pending、not_found、ambiguous、failed 数量。
3. 按需求页能看到每个需求的 round 数、代码行、token、token 完整率。
4. Round 明细支持按 `tokenSyncStatus` 筛选。
5. `ambiguous` 能跳转到人工处理入口。
6. 被撤销 round 默认不进入有效统计。
7. 总览页能看到自动同步状态、最近 token sync 时间、最近 online sync 时间和最近错误。

### 15.5 数据隔离验收

1. `npm run test:tokens` 不写入真实 `.mcp-toolbox/data.json`。
2. 测试数据不会上传线上。
3. 不同项目的数据能按 `projectKey` 或 `projectPath` 区分。
4. 不同用户的数据能按权限隔离查看。

## 16. 当前落地状态与后续收尾

线上同步的具体操作步骤见：[AI-Coding本地数据同步线上使用说明.md](AI-Coding本地数据同步线上使用说明.md)。

### 16.1 已落地

MCP Toolbox 本地侧已完成：

1. 每轮记录、撤销记录、需求维护、本地 Dashboard 汇总。
2. Codex / Claude token 异步回填，支持 `pending`、`synced`、`not_found`、`ambiguous`、`failed` 状态。
3. `tokens:sync:recent`、`auto-sync`、`sync:online`、失败退避和同步状态展示。
4. Dashboard 数据质量卡片、需求维度 token 完整率、round 明细筛选和 ambiguous 人工绑定入口。
5. `code:stats` 分类统计 source / doc / config / test / generated / other，并写入 round metadata。
6. Dashboard 代理接入 `AI_CODING_DASHBOARD_API_BASE_URL`，当前本地测试地址为 `http://localhost:9906/api/ai-coding/dashboard`。

线上后端侧当前已验证：

1. `/dashboard/filters`、`/dashboard/summary`、`/dashboard/requirements`、`/dashboard/models`、`/dashboard/timeline`、`/dashboard/rounds` 返回 200。
2. summary 和 requirements 已返回 token 数据质量字段和 `fileCategorySummary`。
3. 需求 `totalTokens > 0` 且无异常时，`tokenCompletenessRate` 返回 `1.0000`，口径正确。
4. 已在 `线上存储改造方案.md` 第 7 章原始表结构基础上，准备增量 SQL：`ai_coding_dashboard_compat_20260519.sql`，用于补充代码类型拆分列和 Dashboard 查询索引。

### 16.2 还需要收尾

1. 后端数值字段统一返回 JSON number，避免 `"8000"`、`"930000"` 这类字符串数字。
2. 后端时间字段统一返回 ISO 8601，例如 `2026-05-19T10:00:00+08:00`。
3. 执行增量 SQL 后，用真实 MCP 上传一轮带 `fileCategorySummary` 的 round，确认线上 `sourceLinesChanged` 等拆分不再全为 0。
4. 运行 `npm run test:dashboard:remote` 做远端强校验。该脚本会使用 `AI_CODING_DASHBOARD_API_BASE_URL`，并强制关闭本地兜底，确认 Dashboard 不依赖本地 JSON 汇总也能消费线上接口。
5. Maven 编译验证时需要处理 `ai-data-biz/src/main/resources/fonts/msyh.ttc` 被资源过滤导致的 `MalformedInputException`，该问题属于工程资源配置，不是 AI Coding 接口代码逻辑。

### 16.3 推荐下一步

优先完成线上写入闭环：

1. 执行 `ai_coding_dashboard_compat_20260519.sql`。
2. 配置 `SYNC_API_BASE_URL` 和 `SYNC_API_TOKEN`。
3. 运行 `npm run sync:online:dry` 检查 payload。
4. 运行 `npm run test:online-sync-file-categories`，确认本地同步脚本会把文件类型拆分作为顶层字段传给线上后端。
5. 运行 `npm run test:dashboard:remote`，确认 `http://localhost:9906/api/ai-coding/dashboard` 或后续线上地址返回的 summary、requirements、models、timeline、rounds、filters 均符合 Dashboard 需要的数据形状。
6. 运行 `npm run sync:online` 上传真实数据。
7. 打开 Dashboard，验证 `#555` 的 round、代码行、token、数据质量和文件类型拆分。
