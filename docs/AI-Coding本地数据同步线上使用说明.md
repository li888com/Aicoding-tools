# AI Coding 本地数据同步线上使用说明

本文说明如何把 MCP Toolbox 本地记录的 AI Coding 数据同步到线上后端，并通过 Dashboard 验证同步结果。

## 1. 适用场景

本流程适用于当前架构：

```text
AI 客户端
  -> MCP 本地记录 round
  -> 本地 token 日志回填
  -> scripts/sync-to-online.ts 上传线上
  -> 线上 Dashboard 接口汇总展示
```

当前已验证的本地测试后端地址：

```text
http://localhost:9906/api/ai-coding
```

当前已验证的 Dashboard 查询地址：

```text
http://localhost:9906/api/ai-coding/dashboard
```

## 2. 前置条件

1. 后端服务已启动，并且写接口可访问：
   - `PUT /api/ai-coding/requirements/{requirementId}`
   - `POST /api/ai-coding/rounds`
   - `POST /api/ai-coding/round-reverts`
   - `POST /api/ai-coding/token-usage-events`
2. Dashboard 查询接口已启动：
   - `GET /api/ai-coding/dashboard/filters`
   - `GET /api/ai-coding/dashboard/summary`
   - `GET /api/ai-coding/dashboard/requirements`
   - `GET /api/ai-coding/dashboard/models`
   - `GET /api/ai-coding/dashboard/timeline`
   - `GET /api/ai-coding/dashboard/rounds`
3. 本地已存在 `.mcp-toolbox/data.json`。
4. 已安装依赖：

```bash
npm install
```

## 3. 环境变量

### 3.1 必需配置

本地测试时，建议先指定后端写接口地址：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
```

如果不配置，脚本默认使用：

```text
https://ai-test.sbtjt.com/api/ai-coding
```

### 3.2 可选配置

`SYNC_API_TOKEN` 是可选项。

如果后端要求鉴权，可以配置：

```powershell
$env:SYNC_API_TOKEN = "your-token"
```

脚本会自动带上：

```http
Authorization: Bearer your-token
```

如果后端已经放开写接口鉴权，可以不配置 `SYNC_API_TOKEN`。当前已验证：不配置 token 也可以同步到 `localhost:9906`。

## 4. 推荐执行流程

### 4.1 先检查待上传数据

```bash
npm run sync:online:dry -- --limit 10
```

这个命令只做模拟，不写线上。主要看：

```text
processed
requirements
rounds
roundReverts
tokenUsageEvents
testDataSkipped
failed
```

`failed: 0` 说明 payload 和基本流程没有明显问题。

### 4.2 执行真实上传

PowerShell 示例：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
npm run sync:online -- --limit 10 --retry-failed-now
```

成功示例：

```text
Sync completed for .mcp-toolbox/data.json
API base: http://localhost:9906/api/ai-coding
processed: 10
requirements: 0
rounds: 10
roundReverts: 0
tokenUsageEvents: 0
failed: 0
```

### 4.3 验证 Dashboard 是否读到线上数据

```bash
npm run test:dashboard:remote
```

成功示例：

```json
{
  "ok": true,
  "remoteBaseUrl": "http://localhost:9906/api/ai-coding/dashboard",
  "fallbackLocal": false,
  "summary": {
    "roundCount": 22,
    "totalTokens": 8841384,
    "tokenCompletenessRate": 0.4091
  }
}
```

`fallbackLocal: false` 表示这次验证没有使用本地 JSON 兜底，确实是在验证远端 Dashboard 接口。

## 5. 正常自动流程

每轮 AI Coding 正常结束时，推荐顺序是：

1. 调用 `record_ai_coding_round` 写入本地 MCP round。
2. 立即执行一次 `auto-sync:once`。
3. `auto-sync:once` 会扫描最近 token 日志，并上传本地未同步数据到线上。

如果要手动按完整流程执行一次，可以运行：

```bash
npm run auto-sync:once
```

它会依次执行：

1. token 回填。
2. online sync。
3. 写入本地同步状态。

注意：`auto-sync:once` 使用当前环境变量。若要上传到本地 9906，先设置：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
npm run auto-sync:once
```

当前脚本不会因为缺少 `SYNC_API_TOKEN` 跳过线上同步；后端不要求鉴权时，会直接不带 Authorization header 上传。

## 6. 同步规则

### 6.1 幂等规则

round 上传时会带：

```text
idempotencyKey = local-round-{本地roundId}
```

后端必须保证同一个 `idempotencyKey` 重复提交时返回已有记录，而不是重复创建。

### 6.2 ID 映射

本地 round 上传成功后，会把线上 ID 写回本地：

```json
{
  "_sync": {
    "status": "synced",
    "onlineId": "2056685244702531585",
    "syncedAt": "2026-05-19T10:39:00.000Z"
  }
}
```

线上 ID 可能是雪花 ID，大于 JavaScript safe integer 范围，所以脚本按字符串保存。

### 6.3 测试数据跳过

以下数据默认不会上传线上：

- `#999 token sync verification`
- Dashboard API 验证 round
- `metadata.skipOnlineSync = true`
- `metadata.testData = true`

## 7. 常见问题

### 7.1 `No static resource ai-coding/rounds`

原因：`SYNC_API_BASE_URL` 配错了。

错误示例：

```text
https://ai-test.sbtjt.com/api/ai-coding
```

如果当前后端在本机，应改成：

```powershell
$env:SYNC_API_BASE_URL = "http://localhost:9906/api/ai-coding"
```

### 7.2 `Missing or invalid round response id`

原因：后端返回的 round id 是大整数字符串，旧脚本按 JS safe integer 校验会误判。

当前脚本已兼容字符串 ID。后端返回以下结构即可：

```json
{
  "code": 0,
  "data": {
    "id": "2056685244702531585"
  },
  "ok": true
}
```

### 7.3 Dashboard 看到 `unavailable` 或 `not_found`

如果是“自动同步状态”卡片报错，通常是后端没有 `/api/sync-status`。

这个接口属于 MCP 本地 worker 状态，不是线上后端必须实现的 Dashboard 统计接口。线上后端没有它是正常的，前端应隐藏该卡片或不展示错误。

### 7.4 token 很多 round 是 `ambiguous`

说明本地日志扫描找到了多个候选 token event，脚本不会自动乱绑定。

处理方式：

1. 打开 round 明细。
2. 找到 `ambiguous` 的 round。
3. 查看候选 token event。
4. 人工选择正确候选并绑定。

## 8. 验收清单

上线前建议至少跑完：

```bash
npm run build
npm run test:online-sync-file-categories
npm run sync:online:dry -- --limit 10
npm run sync:online -- --limit 10 --retry-failed-now
npm run test:dashboard:remote
```

验收标准：

1. `sync:online` 输出 `failed: 0`。
2. 本地 `.mcp-toolbox/data.json` 中已同步记录有 `_sync.onlineId`。
3. `test:dashboard:remote` 输出 `ok: true`。
4. Dashboard summary 的 `roundCount`、`totalTokens` 有增长。
5. 重复执行 `sync:online` 不会重复创建 round。
