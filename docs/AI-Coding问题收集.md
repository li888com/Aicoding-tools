# AI Coding 问题收集

## 1. MCP 记录中文 prompt 出现 `????`

### 现象

Dashboard 的对话详情页中，部分 `promptText` 显示为连续问号，例如：

```text
??????????????? http://localhost:3000/rounds.html ????
```

页面现在会把这类内容兜底显示为：

```text
内容不可读
```

### 原因

本地 PowerShell 环境存在编码不一致：

```text
[Console]::OutputEncoding = UTF-8
$OutputEncoding = US-ASCII
Active code page = 936
```

当通过 PowerShell here-string 或管道把中文脚本传给 `node` 时，中文在进入 Node 之前已经被 US-ASCII 编码替换成 `?`。MCP 只是保存了收到的字符串，所以 `.mcp-toolbox/data.json` 中的历史记录已经不可逆地变成了问号。

### 影响

- Dashboard 无法展示这些 round 的原始中文 prompt。
- 线上同步后，线上数据也会携带已损坏的 prompt。
- 历史记录无法仅靠本地 JSON 自动恢复，需要从 Codex / Claude 原始日志或对话上下文回填。

### 已处理

- `public/dashboard/app.js` 已增加兜底：连续问号或问号占比过高时显示“内容不可读”。
- `scripts/call-record-round-via-mcp.ts` 已支持 `--payload-file`，从 UTF-8 JSON 文件读取 payload，避免中文经过 PowerShell 命令字符串。
- 新增 `npm run test:record-utf8` 验证中文 prompt 能完整写入。

### 后续建议

1. 所有自动记录 MCP round 的脚本都改用 UTF-8 JSON payload 文件。
2. 避免在 PowerShell 命令行或管道中直接拼接中文 prompt。
3. 对历史 `promptText` 为连续问号的数据，增加回填工具，从原始日志或人工输入修正。

## 2. Dashboard 显示“内容不可读”

### 现象

`http://localhost:3000/rounds.html` 中部分 Prompt 列显示“内容不可读”。

### 原因

这是前端的保护性展示，不是浏览器解码失败。触发条件是原始 `promptText` 已经包含连续 `????` 或问号占比过高。

### 影响

- 页面避免直接展示大片乱码。
- 但用户无法直接看到原始 prompt，需要回填数据。

### 后续建议

1. 在编辑对话记录时标记这类数据为“需要修复”。
2. 增加批量扫描接口，列出所有 `promptText` 不可读的 round。
3. 增加人工修正入口，保存修正审计。

## 3. 代码变更行数统计口径不一致

### 现象

某些轮次记录的 `codeLinesChanged` 与后续重新核算结果不一致。

### 原因

`git diff --numstat` 默认只统计已跟踪文件，不包含未跟踪新文件。若本轮新增了未跟踪文件，需要额外统计新文件行数。

另一个原因是记录时如果使用人工估算，容易把“感觉改了多少”误当成统计结果。比如曾经记录过：

```text
82 added / 4 deleted / 86 changed
```

这组数字没有来自可复现命令，也没有完整列出参与计算的文件，因此不能作为可信统计。

示例：

```text
git diff --numstat
1   0   package.json
48  13  scripts/call-record-round-via-mcp.ts
```

同时新增未跟踪文件：

```text
scripts/verify-record-round-utf8.ts  69 行
```

正确估算应为：

```text
linesAdded = 49 + 69 = 118
linesDeleted = 13
codeLinesChanged = 131
```

### 影响

- 手工估算时容易漏掉未跟踪文件。
- 统计报表中的代码变更量可能偏小。
- 无法审计某一轮统计数字从何而来。
- 后续发现错误时，只能通过 metadata 追加修正说明，不能直接覆盖原始 round 记录。

### 解决方案

记录行数时必须使用可复现口径，不再使用无依据的人工估算。

优先级规则：

1. 如果 Codex 当前轮次界面已经显示“本轮文件改动”，优先按 Codex 面板里的每个文件 `+新增 -删除` 统计。
2. 如果没有 Codex 面板数据，但本轮开始时有 baseline，使用 `--since-snapshot` 统计。
3. 如果没有 Codex 面板数据，也没有 baseline，只能记录 `0` 或明确标记为估算，不能把工作区累计 diff 当成本轮统计。

Codex 面板统计示例：

```text
scripts/code-change-stats.ts                   +133 -5
package.json                                   +1   -0
scripts/verify-code-change-stats-snapshot.ts   +59  -0
docs/AI-Coding问题收集.md                      +58  -0
```

应记录为：

```text
filesChanged = 4
linesAdded = 133 + 1 + 59 + 58 = 251
linesDeleted = 5 + 0 + 0 + 0 = 5
codeLinesChanged = 251 + 5 = 256
```

标准计算流程：

1. 先记录本轮开始前的 worktree 基线。
2. 结束时运行 `git diff --numstat` 统计已跟踪文件。
3. 再运行 `git ls-files --others --exclude-standard` 找出未跟踪新文件。
4. 对未跟踪文本文件统计行数，并计入 `linesAdded`。
5. `codeLinesChanged = linesAdded + linesDeleted`。
6. 在 `metadata` 中写入：
   - `codeStatsSource`
   - `trackedDiffNumstat`
   - `untrackedFiles`
   - `codeStatsPrecision`

推荐将流程固化到脚本中，例如：

```bash
npm run code:stats -- --metadata --files
```

如果统计脚本暂时不能覆盖某些场景，必须在 metadata 中写清楚：

```json
{
  "codeStatsSource": "manual",
  "codeStatsPrecision": "estimated",
  "codeStatsLimitation": "untracked files were counted by line count manually"
}
```

但对于正常实现轮次，原则上不应再使用 `estimated`。

### 后续建议

1. 记录 round 时优先使用 `scripts/code-change-stats.ts --metadata`。
2. 让统计脚本明确包含未跟踪文件。
3. 在 metadata 中保存 `codeStatsSource`、文件分类和是否包含 untracked。
4. 增加记录前校验：当存在未跟踪文件且未写入 `untrackedFiles` 时，提示统计不完整。
5. 对已发现的错误 round，不覆盖原始记录，新增 correction metadata 或修正审计记录。

### 测试结果

已执行：

```bash
npm run test:code-stats
npm run code:stats -- --metadata --files
```

结果：通过。

当前统计脚本输出中已经包含：

```json
{
  "codeStatsPrecision": "workspace-cumulative",
  "trackedDiffNumstat": "1\\t0\\tpackage.json\\n57\\t13\\tscripts/call-record-round-via-mcp.ts\\n24\\t7\\tscripts/code-change-stats.ts\\n20\\t0\\tscripts/verify-code-change-stats.ts",
  "includesUntracked": true,
  "trackedFiles": [
    "package.json",
    "scripts/call-record-round-via-mcp.ts",
    "scripts/code-change-stats.ts",
    "scripts/verify-code-change-stats.ts"
  ],
  "untrackedFiles": [
    "docs/AI-Coding问题收集.md",
    "scripts/verify-record-round-utf8.ts"
  ]
}
```

本次验证证明：统计结果已经能区分 Git 已跟踪文件和未跟踪新文件，后续不需要再用无依据的人工估算。

### 新发现：工作区累计统计不能代表本轮统计

如果一个对话轮次没有修改 `docs/AI-Coding问题收集.md` 或 `scripts/verify-record-round-utf8.ts`，但这两个文件已经处于未提交状态，那么直接运行工作区累计统计会把它们也算进去。

这说明：

```text
当前工作区累计 diff != 当前对话轮次 diff
```

原因：

- Git 只知道工作区相对 HEAD 的累计变化。
- 如果多轮对话之间没有提交或没有保存 baseline，后续轮次无法仅凭当前 `git diff` 区分哪些行属于本轮。
- 因此，`docs/AI-Coding问题收集.md`、`scripts/verify-record-round-utf8.ts` 这类历史未提交文件会被错误算入当前轮次。

解决方案：

1. 在每轮开始时创建 baseline：

```bash
npm run code:stats -- --snapshot > .mcp-toolbox/round-baseline.json
```

2. 在每轮结束时按 baseline 计算：

```bash
npm run code:stats -- --since-snapshot .mcp-toolbox/round-baseline.json --metadata --files
```

3. 只有 `codeStatsPrecision = "snapshot-diff"` 的结果，才能作为严格的本轮统计。
4. `codeStatsPrecision = "workspace-cumulative"` 只能作为当前工作区累计状态，不能当作本轮贡献。

处理结果：

- `scripts/code-change-stats.ts` 已新增 `--snapshot`。
- `scripts/code-change-stats.ts` 已新增 `--since-snapshot <file>`。
- 新增 `scripts/verify-code-change-stats-snapshot.ts` 验证 baseline 统计。

已验证：

```bash
npm run build
npm run test:code-stats
npm run test:code-stats:snapshot
```

验证结果：创建 baseline 后新增一个 3 行文件，`--since-snapshot` 只统计该文件：

```json
{
  "filesChanged": 1,
  "linesAdded": 3,
  "codeLinesChanged": 3,
  "precision": "snapshot-diff"
}
```

### 新发现：payload 手工覆盖导致顶层统计仍可能错误

`round id = 180` 暴露了一个新的统计问题。

该轮顶层记录为：

```json
{
  "filesChanged": 3,
  "linesAdded": 52,
  "linesDeleted": 7,
  "codeLinesChanged": 59
}
```

但同一条记录的 metadata 中已经包含自动统计依据：

```text
57  13  scripts/call-record-round-via-mcp.ts
24  7   scripts/code-change-stats.ts
20  0   scripts/verify-code-change-stats.ts
```

仅这 3 个脚本合计就是：

```text
linesAdded = 57 + 24 + 20 = 101
linesDeleted = 13 + 7 + 0 = 20
codeLinesChanged = 121
```

如果再包含同一累计 diff 中的 `package.json`：

```text
linesAdded = 102
linesDeleted = 20
codeLinesChanged = 122
```

问题原因：

- `scripts/call-record-round-via-mcp.ts` 支持 payload 覆盖 `filesChanged / linesAdded / linesDeleted / codeLinesChanged`。
- 当 payload 传入手工估算值时，顶层 round 使用了手工值。
- metadata 仍保留自动统计结果，于是出现“顶层统计”和“metadata 依据”不一致。

解决方案：

1. 默认禁止 payload 覆盖代码统计字段。
2. 只有显式传入 `--allow-code-stats-override` 时，才允许 payload 覆盖。
3. 如果发生覆盖，必须在 metadata 中标记 `payloadCodeStatsOverride: true`。
4. 正常记录流程必须使用 `scripts/code-change-stats.ts --metadata` 的结果作为顶层统计。
5. 增加验证：当 `payloadCodeStatsOverride !== true` 时，顶层统计必须等于自动统计结果。

处理结果：

- `scripts/call-record-round-via-mcp.ts` 已改为默认禁止 payload 覆盖代码统计。
- 只有传入 `--allow-code-stats-override` 才会采用 payload 中的代码统计字段。
- `scripts/verify-record-round-utf8.ts` 已加入验证：即使 payload 传入错误统计值，也不会覆盖自动统计结果。

已验证：

```bash
npm run build
npm run test:record-utf8
npm run test:code-stats
```

## 4. auto-sync:once 被跳过

### 现象

执行：

```bash
npm run auto-sync:once
```

返回：

```json
{
  "ok": false,
  "skipped": true,
  "reason": "auto sync is already running"
}
```

### 原因

已有常驻 `npm run auto-sync` 进程正在运行，并持续更新 `.mcp-toolbox/auto-sync.lock` 和 `autoSyncState.lastHeartbeatAt`。

### 影响

- 单次同步不会重复执行。
- 这是正常保护逻辑，避免多个同步任务并发写本地数据。

### 后续建议

1. Dashboard 的同步状态页展示当前 worker pid、启动时间、心跳时间。
2. 增加“只查看同步状态”的命令或接口。
3. 如果需要手动强制同步，应先安全停止常驻 auto-sync。

## 5. 需求选择 skill 当前只支持本地数据

### 现象

`ai-coding-requirement` skill 现在可以查询和绑定本地维护的需求，但远端公司需求 API 还未真正接入。

### 已处理

- 新增 MCP tools：
  - `list_ai_coding_requirements`
  - `get_ai_coding_requirement`
  - `select_ai_coding_requirement`
  - `clear_ai_coding_requirement_selection`
- 新增配置入口：
  - `AI_CODING_REQUIREMENT_API_MODE`
  - `AI_CODING_REQUIREMENT_API_BASE_URL`
  - `AI_CODING_REQUIREMENT_API_TOKEN`
  - `AI_CODING_REQUIREMENT_API_TIMEOUT_MS`

### 后续建议

1. 实现 remote requirement API client。
2. 远端查询成功后，把需求摘要同步到本地 requirements。
3. 保持 skill 调用 MCP tools 的接口不变，避免后续改 skill。
