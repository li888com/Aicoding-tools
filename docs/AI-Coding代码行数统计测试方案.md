# AI-Coding 代码行数统计测试方案

## 1. 测试目标

本方案用于验证 AI Coding 每轮记录的代码变更统计是否准确。

重点验证：

1. 本轮没有文件改动时，是否记录为 0。
2. 新增文件是否能正确统计新增行数。
3. 未跟踪文件是否能被统计。
4. 多轮不提交时，是否只统计本轮增量。
5. 不同文件类型是否能正确归类。
6. 删除行数是否能正确统计。
7. Dashboard 展示是否与 MCP 记录一致。

## 2. 测试前准备

正式测试前需要确认基线。

建议先处理当前工作区已有改动：

```bash
git status --short
```

如果存在历史未提交改动，有三种选择：

1. 提交当前改动，形成干净基线。
2. 暂存当前改动，避免影响测试。
3. 使用 baseline 快照机制，只计算本轮增量。

推荐使用第 3 种方式。

## 3. 核心统计字段

每轮需要检查这些字段：

| 字段 | 含义 |
| --- | --- |
| `filesChanged` | 本轮变化的文件数量 |
| `linesAdded` | 本轮新增行数 |
| `linesDeleted` | 本轮删除行数 |
| `codeLinesChanged` | `linesAdded + linesDeleted` |
| `metadata.fileCategorySummary.sourceLinesChanged` | 源码类变更行数 |
| `metadata.fileCategorySummary.docLinesChanged` | 文档类变更行数 |
| `metadata.fileCategorySummary.configLinesChanged` | 配置类变更行数 |
| `metadata.fileCategorySummary.testLinesChanged` | 测试类变更行数 |
| `metadata.fileCategorySummary.generatedLinesChanged` | 生成文件类变更行数 |
| `metadata.fileCategorySummary.otherLinesChanged` | 其他类变更行数 |

## 4. 测试用例总览

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| TC-01 | 只问答，不改文件 | 记录 0 |
| TC-02 | 新增文档文件 | 只统计本轮新增文档行数 |
| TC-03 | 修改已有文档 | 只统计本轮追加/删除行数 |
| TC-04 | 新增源码文件 | 分类为 source |
| TC-05 | 修改源码文件 | 正确统计新增和删除 |
| TC-06 | 新增配置文件 | 分类为 config |
| TC-07 | 新增测试文件 | 分类为 test |
| TC-08 | 修改 generated 文件 | 分类为 generated |
| TC-09 | 连续多轮不提交 | 每轮只记录本轮增量 |
| TC-10 | 未跟踪文件跨轮 | 第二轮不重复统计上一轮文件 |
| TC-11 | 删除文件 | 统计删除行数 |
| TC-12 | Dashboard 展示校验 | 页面数据与 MCP 记录一致 |

## 5. 详细测试用例

### TC-01 只问答不改文件

操作：

```text
用户只提问，不要求生成或修改文件。
```

预期：

```json
{
  "filesChanged": 0,
  "linesAdded": 0,
  "linesDeleted": 0,
  "codeLinesChanged": 0
}
```

### TC-02 新增文档文件

操作：

新增文件：

```text
docs/test-code-stats-doc.md
```

内容示例为 5 行。

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 5,
  "linesDeleted": 0,
  "codeLinesChanged": 5,
  "metadata": {
    "fileCategorySummary": {
      "docLinesChanged": 5
    }
  }
}
```

### TC-03 修改已有文档

操作：

在 `docs/test-code-stats-doc.md` 追加 2 行。

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 2,
  "linesDeleted": 0,
  "codeLinesChanged": 2
}
```

注意：

不能记录为 7。7 是累计行数，不是本轮增量。

### TC-04 新增源码文件

操作：

新增文件：

```text
scripts/test-code-stats-source.ts
```

内容为 10 行 TypeScript。

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 10,
  "linesDeleted": 0,
  "codeLinesChanged": 10,
  "metadata": {
    "fileCategorySummary": {
      "sourceLinesChanged": 10
    }
  }
}
```

### TC-05 修改源码文件

操作：

修改 `scripts/test-code-stats-source.ts`：

- 新增 3 行
- 删除 1 行

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 3,
  "linesDeleted": 1,
  "codeLinesChanged": 4
}
```

### TC-06 新增配置文件

操作：

新增文件：

```text
docs/test-code-stats-config.json
```

内容为 4 行 JSON。

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 4,
  "linesDeleted": 0,
  "codeLinesChanged": 4,
  "metadata": {
    "fileCategorySummary": {
      "configLinesChanged": 4
    }
  }
}
```

### TC-07 新增测试文件

操作：

新增文件：

```text
scripts/verify-code-stats-sample.ts
```

内容为 8 行。

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 8,
  "linesDeleted": 0,
  "codeLinesChanged": 8,
  "metadata": {
    "fileCategorySummary": {
      "testLinesChanged": 8
    }
  }
}
```

### TC-08 修改 generated 文件

操作：

修改：

```text
package-lock.json
```

预期：

```json
{
  "metadata": {
    "fileCategorySummary": {
      "generatedLinesChanged": 变化行数
    }
  }
}
```

### TC-09 连续多轮不提交

操作：

1. 第 1 轮新增 5 行文档。
2. 不提交。
3. 第 2 轮新增 2 行源码。

预期：

```text
第 1 轮记录 5。
第 2 轮记录 2。
```

不能出现：

```text
第 2 轮记录 7。
```

### TC-10 未跟踪文件跨轮

操作：

1. 第 1 轮新建未跟踪文档 5 行。
2. 第 2 轮只问答，不改文件。

预期：

```text
第 1 轮记录 5。
第 2 轮记录 0。
```

### TC-11 删除文件

操作：

删除 `docs/test-code-stats-doc.md`。

预期：

```json
{
  "filesChanged": 1,
  "linesAdded": 0,
  "linesDeleted": 原文件行数,
  "codeLinesChanged": 原文件行数
}
```

### TC-12 Dashboard 展示校验

操作：

1. 打开 Dashboard round 详情页。
2. 找到对应 round。
3. 对比 MCP 记录中的：
   - `filesChanged`
   - `linesAdded`
   - `linesDeleted`
   - `codeLinesChanged`

预期：

页面展示与 MCP 本地记录一致。

## 6. 验证命令

查看当前工作区统计：

```bash
tsx scripts/code-change-stats.ts --metadata --files
```

查看 Git 已跟踪文件累计 diff：

```bash
git diff --numstat
```

查看未跟踪文件：

```bash
git ls-files --others --exclude-standard
```

查看最近 round：

```bash
node scripts/print-recent-rounds.js
```

如果没有该脚本，可直接查看：

```text
.mcp-toolbox/data.json
```

## 7. 通过标准

测试通过需要满足：

1. 每轮统计只包含本轮实际改动。
2. 只问答轮次记录 0。
3. 未跟踪新文件只在创建轮次统计一次。
4. 后续确认轮次不重复统计旧文件。
5. 文件分类正确。
6. Dashboard 与 MCP 记录一致。

## 8. 建议测试顺序

建议按以下顺序逐项测试：

1. TC-01
2. TC-02
3. TC-03
4. TC-09
5. TC-10
6. TC-04
7. TC-05
8. TC-06
9. TC-07
10. TC-11
11. TC-12

先验证最容易出错的“跨轮累计问题”，再验证文件分类。

