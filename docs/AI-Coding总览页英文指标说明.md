# AI-Coding 总览页英文指标说明

本文说明 Dashboard 总览页面中英文指标的中文含义，便于查看统计面板时快速理解每个数字代表什么。

## 1. Token 质量指标

| 英文 | 中文含义 | 说明 |
| --- | --- | --- |
| `Token completeness` | Token 完整率 | 已成功补齐真实 token 数据的对话轮次占比。比例越高，说明统计越完整。 |
| `synced rounds` | 已同步轮次 | 已经找到并绑定 token 数据的对话轮数。 |
| `Pending` | 待同步 | 还在等待日志扫描或 token 同步的轮次。 |
| `Not found` | 未找到 | 日志中暂时没有找到能匹配该轮对话的 token 记录。 |
| `Ambiguous` | 有歧义 | 找到了多个可能匹配的 token 记录，需要人工选择绑定。 |
| `Failed` | 同步失败 | token 同步脚本执行失败，或同步过程中发生错误。 |
| `Last token sync` | 最近 token 同步时间 | 最近一次成功更新 token 数据的时间。 |
| `Last online sync` | 最近线上同步时间 | 最近一次把本地统计数据上传到线上接口的时间。 |
| `Log sources` | 日志来源 | 展示 token 数据分别来自 Codex 和 Claude 日志的轮次数量。 |
| `Codex / Claude` | Codex / Claude 来源数量 | `Log sources` 中两个数字的顺序，前者是 Codex，后者是 Claude。 |

## 2. 代码文件分类指标

| 英文 | 中文含义 | 说明 |
| --- | --- | --- |
| `Source` | 源码 | 应用代码、业务代码、脚本代码等源代码改动。 |
| `Docs` | 文档 | Markdown、说明文档、方案文档等改动。 |
| `Config` | 配置 | JSON、YAML、env、配置文件等改动。 |
| `Tests` | 测试 | 测试脚本、验证脚本、测试用例等改动。 |
| `Generated` | 生成文件 | 构建产物、lock 文件、自动生成文件等改动。 |
| `Other` | 其他 | 无法归入以上类别的文件改动。 |

## 3. 自动同步状态指标

| 英文 | 中文含义 | 说明 |
| --- | --- | --- |
| `Token Sync` | Token 同步 | 最近一次 token 同步执行或完成的时间。 |
| `Scan Since` | 扫描起点 | token 同步任务从哪个时间点开始扫描日志。 |
| `Batch` | 批次 | 当前或最近一次 token 同步检查的数量，例如 `10 / 50` 表示检查了 10 条，批次上限是 50 条。 |
| `Online Sync` | 线上同步 | 最近一次把本地 AI Coding 统计数据上传到线上 API 的时间。 |
| `Online Batch` | 线上同步批次 | 当前或最近一次线上同步处理的记录数量。 |

## 4. 快速理解

总览页这些英文主要回答三个问题：

1. 对话 token 数据是否完整：看 `Token completeness`、`Pending`、`Not found`、`Ambiguous`、`Failed`。
2. 本轮或累计代码改动属于哪类文件：看 `Source`、`Docs`、`Config`、`Tests`、`Generated`、`Other`。
3. 本地统计数据是否已经同步出去：看 `Last online sync`、`Online Sync`、`Online Batch`。

如果只是日常看统计，最重要的是：

- `Token completeness` 越高越好。
- `Pending`、`Not found`、`Ambiguous`、`Failed` 越少越好。
- `Last online sync` 或 `Online Sync` 有近期时间，说明数据已经正常上传。

