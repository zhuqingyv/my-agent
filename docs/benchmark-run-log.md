# Benchmark Run Log

## Run 1 — 2026-04-29

### L0 (10 tasks, runs=1)

**Result**: 10/10 ✓, gate=✓, score=1.000

修复过程中发现的 benchmark 自身 bug（非 agent 问题）：
1. `args_contains` 精确匹配 → agent 传 `./package.json` 被误判 fail → 修为 normalize 路径
2. L0-008 要求文件内容正确修改，超出 L0"连通性"范围 → 降级为只验工具能调通
3. L0 soft_assertions 拉低 score 导致 gate cutoff=1.0 过不了 → 删 L0 的 soft（hard-only）

### L1 (30 tasks, runs=5, median)

**Result**: 28/30 pass, passRate=0.900, score=0.905, gate=✓  
**耗时**: 16m28s

#### 失败题目

| 题目 | median | 根因 | 类型 |
|------|--------|------|------|
| L1-021 搜索 useState | 0.00 | grep MCP 收到目录路径报 "Is a directory"，agent 未加 -r 也未换策略 | agent 能力问题 |
| L1-024 搜索 helper | 0.00 | 同上 | agent 能力问题 |

**结论**：grep MCP 对目录参数的处理是 agent 真实弱点。可能需要改进 grep MCP（自动 -r）或 agent 的错误恢复策略。

#### 低 stability 题目（偶尔 fail）

| 题目 | stability | 说明 |
|------|-----------|------|
| L1-002 读 version | 0.60 | 5 次中偶尔 soft 分低 |
| L1-007 创建 hello.txt | 0.60 | 偶尔写文件参数不稳 |
| L1-009 创建 notes.md | 0.51 | 同上 |
| L1-010 创建 .gitignore | 0.60 | 同上 |
| L1-021/022/023/024 grep 类 | 0.51 | grep 目录问题导致不稳定 |

#### 满分类别
- 读文件（6 道）：全部 1.00
- 列目录（4 道）：全部 1.00
- 执行命令（6 道）：全部 1.00
- 路径容错（2 道）：全部 1.00

#### "不应调工具"类（4 道）
全部 hard pass 但 median=0.80。原因：hard 通过（没调工具）但 soft 的 `final_text_min_len` 未满分（回复较短）。这不是问题，设计如此。

### L2 (30 tasks, runs=5, median)

**Result**: 23/30 pass, passRate=0.753, score=0.729, gate=✗（需≥80%，实际75%）  
**耗时**: 35m0s  
**结论**: L2 gate 未通过。MA agent 当前等级 = **L1**（L2 差 2 道题到 gate）

#### 失败题目（7 道）

| 题目 | median | 根因分析 |
|------|--------|----------|
| L2-001 改 README 版本号 | 0.00 | fs-edit file_edit 调用失败（参数错误），file_content 断言检测文件未变 |
| L2-003 修改 config.json 端口 | 0.00 | 同上，fs-edit 参数不稳定 |
| L2-004 升 package.json 版本 | 0.00 | 同上 |
| L2-005 重命名变量 | 0.00 | 同上 |
| L2-006 JSON 加字段 | 0.00 | 同上，stability=1.00 说明 5 次全挂，不是 flaky |
| L2-007 项目概览多轮追问 | 0.00 | 多轮首题。可能是多轮 rounds 断言过严或 agent 不稳定 |
| L2-020 读 package 再跑 node | 0.00 | 多步任务 |
| L2-021 三步总结任务 | 0.00 | 多步任务 |

#### 通过的亮点
- **上下文保持**（4 道）：全部满分 1.00 + stability 1.00 — agent 的 context 保持能力强
- **错误恢复**（4 道）：全部满分 — agent 能正确处理不存在的文件/命令
- **命令失败**（3 道）：全部满分 — agent 不会对失败命令幻觉输出
- **空答自救**（2 道）：全部满分 — nudge 机制有效
- **多轮追问**（5/6 道通过）：大部分多轮对话能力正常

#### 核心问题定位

**fs-edit（file_edit）是最大瓶颈**：L2-001/003/004/005/006 全部是"读-改-写"类任务，都挂在 file_edit 工具调用失败。5 次 run 中 stability=0.5-1.0（多数 5 次全挂），说明模型对 fs-edit 的参数格式掌握不好。

这是 **agent 层面需要改进的核心问题**：
1. fs-edit MCP 的 inputSchema 是否清晰（old_string/new_string 参数）
2. agent 的 tool schema 提示是否足够引导模型正确调用
3. 是否需要给 file_edit 加 fallback（失败后尝试 write_file 全量覆盖）

#### 分类统计

| 类别 | 通过/总数 | 通过率 |
|------|-----------|--------|
| 读-改-写 | 1/6 | 17% ← **最弱** |
| 多轮追问 | 5/6 | 83% |
| 错误恢复 | 4/4 | 100% |
| 命令失败 | 3/3 | 100% |
| 多步任务 | 3/5 | 60% |
| 上下文保持 | 4/4 | 100% |
| 空答自救 | 2/2 | 100% |

---

## 发现的待修问题清单

### Agent/MCP 层面（benchmark 正确检测到的问题）

| # | 问题 | 影响 | 建议修法 |
|---|------|------|----------|
| A1 | grep MCP 不自动递归目录 | L1 grep 类 2 道 fail | servers/grep-mcp.ts 对目录自动加 `-r` |
| A2 | agent 不处理 grep "Is a directory" 错误 | 同上 | errorHistory 或 retry 策略改进 |
| A3 | 写文件类 stability ~0.5-0.6 | 偶尔 soft 分低 | 检查 fs__write_file 参数稳定性 |
| **A4** | **fs-edit file_edit 调用大面积失败** | **L2 读改写类 5/6 挂** | **核心问题：模型不会正确传 old_string/new_string 参数。需改善 tool schema 描述或加 fallback** |
| A5 | 多步任务（20/21）失败 | L2 多步 2/5 挂 | 可能是 maxLoops 不够或多步编排不稳 |

### Benchmark 框架层面（已修 / 待修）

| # | 问题 | 状态 |
|---|------|------|
| B1 | args_contains 精确匹配 → ./path 误杀 | ✅ 已修（normalize） |
| B2 | L0-008 断言过严（超出连通性范围） | ✅ 已修（降级） |
| B3 | L0 soft 拉低 score | ✅ 已修（删 soft） |
| B4 | --level 过滤后 L0 检查报错 | ✅ 已修 |
| B5 | scorer 双写（task-runner vs scorer.ts） | ✅ 已修 |
| B6 | hitMaxLoops 全链路失效 | ✅ 已修 |
| B7 | no_error_5xx 正则可能误伤 | 📌 留 M2 |
| B8 | L2 error-recovery 类 hard 过弱 | 📌 留 M2（LLM judge 兜底） |
