# AI-Coding 代码变更统计规则

## 1. 背景

AI Coding 每轮结束时会记录代码变更统计：

```json
{
  "filesChanged": 0,
  "linesAdded": 0,
  "linesDeleted": 0,
  "codeLinesChanged": 0
}
```

这些字段用于 Dashboard 展示“代码改动量”“代码/token 比例”“文件分类统计”等指标。

当前容易混淆的点是：

- 工作区累计变更
- 本轮 AI Coding 实际变更

如果工作区多轮不提交，直接用当前 `git diff --numstat` 会把之前轮次的改动也重复算进来。

例如当前工作区累计可能是：

```text
package-lock.json                                7
package.json                                     1
public/dashboard/app.js                         50
scripts/code-change-stats.ts                    46
scripts/sync-token-usage.ts                    124
docs/AI-Coding-token-ambiguous治理方案.md       295
docs/AI-Coding总览页英文指标说明.md              54
docs/AI-Coding接口触发时机说明.md               133
合计                                           710
```

这里的 `710` 是当前工作区累计变更，不代表最近一轮单独改了 710 行。

## 2. 统计口径定义

### 2.1 工作区累计口径

含义：

```text
从 Git HEAD 到当前工作区的全部未提交变更
```

特点：

- 适合看当前工作区总变更。
- 不适合记录单轮 AI Coding 成果。
- 多轮不提交时会重复累计。

来源：

```bash
git diff --numstat
git ls-files --others --exclude-standard
```

### 2.2 单轮口径

含义：

```text
从本轮 AI Coding 开始时的工作区基线，到本轮结束时的增量变更
```

特点：

- 适合写入 `record_ai_coding_round`。
- 不会重复计算前几轮未提交改动。
- 能准确回答“这一轮改了多少”。

推荐作为 MCP 记录的最终口径。

## 3. 当前统计脚本规则

统计脚本：

```bash
tsx scripts/code-change-stats.ts --metadata --files
```

当前统计来源：

1. 已跟踪文件：

```bash
git diff --numstat
```

2. 未跟踪新文件：

```bash
git ls-files --others --exclude-standard
```

未跟踪文件会按文本行数计为新增行：

```text
linesAdded = 文件文本行数
linesDeleted = 0
codeLinesChanged = linesAdded
```

二进制文件跳过。

## 4. 文件分类规则

统计脚本会把文件分为：

| 分类 | 说明 | 示例 |
| --- | --- | --- |
| `source` | 源码、脚本、页面、SQL 等 | `.ts`、`.js`、`.html`、`.css`、`.sql` |
| `doc` | 文档 | `.md`、`.txt`、`docs/` 下文件 |
| `config` | 配置 | `.json`、`.yml`、`.env`、`Dockerfile` |
| `test` | 测试或验证文件 | `tests/`、`*.test.ts`、`verify-*` |
| `generated` | 生成物或锁文件 | `package-lock.json`、`dist/`、`build/` |
| `other` | 其他无法归类文件 | 其他文件 |

输出中的 `fileCategorySummary` 示例：

```json
{
  "sourceLinesChanged": 220,
  "docLinesChanged": 482,
  "configLinesChanged": 1,
  "testLinesChanged": 0,
  "generatedLinesChanged": 7,
  "otherLinesChanged": 0
}
```

## 5. MCP 记录推荐规则

### 5.1 本轮开始时记录基线

在处理用户请求前记录 baseline：

```json
{
  "startedAt": "ISO time",
  "baseline": {
    "trackedNumstat": "git diff --numstat 输出",
    "untrackedFiles": ["..."],
    "untrackedFileLineCounts": {}
  }
}
```

### 5.2 本轮结束时再次统计

结束时再次读取：

```bash
git diff --numstat
git ls-files --others --exclude-standard
```

然后计算：

```text
本轮变更 = 结束快照 - 开始快照
```

### 5.3 新文件处理

如果某个未跟踪文件在本轮开始时不存在，结束时存在：

```text
本轮新增行 = 文件当前行数
```

如果某个未跟踪文件在本轮开始时已经存在，结束时仍存在：

```text
本轮新增行 = 结束行数 - 开始行数
```

如果无法可靠计算，则在 metadata 里说明：

```json
{
  "codeStatsSource": "estimated from workspace diff",
  "codeStatsPrecision": "estimated"
}
```

## 6. 避免重复统计的关键点

不要在每轮直接把当前工作区累计 diff 当作本轮变更。

错误示例：

```text
第 1 轮：新增 295 行文档
第 2 轮：修改 46 行脚本

如果第 1 轮未提交，第 2 轮直接读工作区累计，就会记录 341 行，而不是 46 行。
```

正确做法：

```text
第 1 轮记录 baseline A -> end B，得到 295
第 2 轮记录 baseline B -> end C，得到 46
```

## 7. Dashboard 展示建议

Dashboard 可同时展示两种指标：

| 指标 | 含义 |
| --- | --- |
| 本轮变更 | 当前 round 自己产生的代码行数 |
| 工作区累计变更 | 当前未提交工作区总改动，仅用于调试 |

默认统计图表应使用：

```text
本轮变更
```

不应使用：

```text
工作区累计变更
```

## 8. metadata 建议

每轮记录建议带上：

```json
{
  "metadata": {
    "codeStatsSource": "baseline diff snapshot",
    "codeStatsPrecision": "exact",
    "workspaceCumulativeChanged": 710,
    "roundChanged": 46,
    "fileCategorySummary": {
      "sourceLinesChanged": 46,
      "docLinesChanged": 0,
      "configLinesChanged": 0,
      "testLinesChanged": 0,
      "generatedLinesChanged": 0,
      "otherLinesChanged": 0
    }
  }
}
```

如果只能拿到累计 diff：

```json
{
  "metadata": {
    "codeStatsSource": "workspace cumulative git diff",
    "codeStatsPrecision": "cumulative"
  }
}
```

## 9. 确认类和问答类轮次

有些用户请求只是确认、解释或追问，例如：

```text
你现在是对的
你确定有 297 行吗
为什么没有跑 MCP
```

这类轮次通常不会产生新的文件改动。

如果上一轮刚创建了未跟踪文件，而这一轮只是确认，不能再次把上一轮的未跟踪文件算进本轮。

错误示例：

```text
第 1 轮：新建统计规则文档，新增 297 行。
第 2 轮：用户说“你现在是对的”，没有任何文件改动。

错误记录：
第 2 轮仍然记录 297 行。
```

正确记录：

```text
第 1 轮：297 行。
第 2 轮：0 行。
```

因此规则是：

1. 如果本轮没有执行文件写入、格式化、生成、删除等操作，应记录 `0`。
2. 如果没有本轮 baseline，不能把当前工作区累计 diff 当作确认类轮次的变更。
3. 对于解释、确认、排查类请求，如果只读文件或只运行查询命令，也应记录 `0`。
4. 只有本轮实际修改了文件，才记录本轮新增/删除行数。

metadata 建议：

```json
{
  "metadata": {
    "codeStatsSource": "no file edits in this round",
    "codeStatsPrecision": "exact",
    "roundChanged": 0
  }
}
```

## 10. 推荐落地步骤

1. 保留当前 `scripts/code-change-stats.ts` 作为“工作区累计统计”能力。
2. 新增 baseline 快照能力：

```bash
tsx scripts/code-change-stats.ts --snapshot > .mcp-toolbox/round-baseline.json
```

3. 新增按 baseline 计算能力：

```bash
tsx scripts/code-change-stats.ts --since-snapshot .mcp-toolbox/round-baseline.json
```

4. MCP 记录脚本 `scripts/call-record-round-via-mcp.ts` 改为使用单轮口径。
5. Dashboard 继续展示 round 中已记录的单轮统计。
6. 如果没有 baseline 且本轮没有文件写入操作，MCP 记录脚本必须记录 `0`，不能使用工作区累计 diff 兜底。

## 11. 结论

代码变更统计必须区分：

```text
工作区累计变更 != 本轮 AI Coding 变更
```

当前 `710` 行是工作区累计变更，包含历史未提交文件和多个轮次的修改。

如果要准确记录每轮贡献，必须引入“本轮开始 baseline”，用结束快照减开始快照。
