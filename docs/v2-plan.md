# my-agent v2 架构设计

> 范围：为 my-agent 补齐与 Claude Code 的 5 个核心差距。所有方案以"本地模型 + 200 行代码红线"为约束，参考 Claude Code 但不照抄。
> 代码入口：`src/agent.ts`（主循环）、`src/cli/App.tsx`（UI）、`servers/*-mcp.ts`（工具）。

---

## 一、总览

### 5 个功能
| # | 功能 | 触达文件 | 预估代码 |
|---|---|---|---|
| F1 | Context 压缩（auto-compact） | `src/agent.ts` + `src/agent/compact.ts` + 新 `src/agent/tokenCount.ts` + 新 `src/agent/summarize.ts` | ~180 行 |
| F2 | FileEdit 工具（精确字符串替换） | `servers/fs-mcp.ts`（扩工具） | ~120 行 |
| F3 | CLAUDE.md 注入（项目上下文） | 新 `src/agent/memdir.ts` + `src/agent.ts`（system prompt 拼接） | ~100 行 |
| F4 | 会话持久化（resume） | 新 `src/session/store.ts` + `src/cli.ts`（--resume） + `src/agent.ts`（注入历史） | ~180 行 |
| F5 | 危险命令确认 | 新 `src/agent/dangerGuard.ts` + `src/agent.ts`（tool call 拦截） + `src/cli/App.tsx`（确认框） | ~160 行 |

### 依赖 / 并行度
```
F1 ─┐
F2 ─┼─ 互相无依赖，可完全并行
F3 ─┘
F4 ── 依赖 F1 的 token 估算（用来剪旧 session）；F1 完成后开始
F5 ── 依赖 agent.ts 的 tool call 分发口，和 F1 可能在同一处改 ─> F1 先合，F5 在其上 rebase
```
最小关键路径：F1 → F4/F5。F2、F3 独立。
**5 人并行方案**：F1、F2、F3 同时起，F4 等 F1 出了 tokenCount 模块就可以起，F5 等 F1 合入 agent.ts 改动。

### 总体架构（v2 新增）
```
 user input
    │
    ▼
  App.tsx ──────── ConfirmDialog (F5)
    │                  ▲
    ▼                  │ (danger)
 agent.chat()          │
    │                  │
    ├─► buildSystem() ─┴── memdir.load() (F3)  ── CLAUDE.md
    │                                              项目 CLAUDE.md
    │                                              ~/.my-agent/AGENT.md
    ├─► resume? ◄── session/store.load() (F4)
    │
    ▼ loop
  llm.chat ──► shouldCompact?  ──(F1)──► summarize → replace old messages
                    │
                    ▼
                 tool call ── dangerGuard? (F5) ── 确认通过？
                    │                                │
                    ▼                                ▼ no → tool result: denied
                fs-mcp (+FileEdit F2) / exec-mcp
                    │
                    ▼
          session/store.append() (F4, 每轮持久化)
```

---

## 二、功能 1：Context 压缩

**参考**：`claude源码/src/services/compact/autoCompact.ts`（阈值）、`compact.ts`（prompt）。Claude Code 做的是"让模型生成 summary 替换所有历史消息"。

### 2.1 Token 估算
本地模型场景不用 tiktoken（依赖重、本地 tokenizer 也不同）。采用字符数粗估，`CHARS_PER_TOKEN=3.5`（中英混合经验值，宁大勿小）。

```ts
// src/agent/tokenCount.ts
export function estimateTokens(messages: ChatCompletionMessageParam[]): number;
// 规则：string.length；text part 算 text.length；image_url 按 1000 计；tool_calls 按 JSON.stringify 长度计；最后 /3.5 向上取整。
```

### 2.2 阈值与触发
- 从 `config.model.contextWindow`（新增字段，默认 32768，用户按本地模型改）读取 ctx 窗口。
- 阈值 75%：`threshold = Math.floor(contextWindow * 0.75)`。
- 触发点：`agent.ts` 的 `runTask` 循环，每轮 LLM 调用**前**检查 `estimateTokens(messages) > threshold`，若触发则先 compact。
- 失败熔断：连续 compact 失败 ≥2 次后本会话停用（避免死循环）。

### 2.3 压缩方式
轻量版 Claude Code 思路：**模型生成 summary 替换旧消息**。
1. 保留 system prompt（index 0）和最近 `KEEP_LAST_N=6` 条消息。
2. 中间消息拼成 `role: content.slice(0,500)` 形式，喂给同一模型，带专用 compact prompt。
3. summary 作为一条 `role: 'system'` 消息，替换原来中间段。

```ts
// src/agent/summarize.ts
export async function summarizeRange(client: OpenAI, model: string, msgs: ChatCompletionMessageParam[], signal?: AbortSignal): Promise<string>;
```
Compact prompt 要求输出 4 点：① 用户关键需求 ② 已完成结论 ③ 悬挂问题 ④ 工具调用重要产出。不客套，只输出摘要，≤300 字。调用参数：`temperature=0.2`，**不带** `frequency_penalty`（高 penalty 会让摘要更乱）。

### 2.4 保留策略
```
[system prompt]             ← 永远保留
[... 中间部分被压成 summary ...]   ← system: "[compact summary] ..."
[最近 6 条消息]               ← 永远保留（可能含 tool_call/tool_result，不能截断配对）
```
**关键细节**：截断时不能把 `assistant(tool_calls)` 和对应的 `tool` 消息拆开——OpenAI 协议里这两个必须成对。切分点需向后扫到一对完整结束。

### 2.5 对外接口
```ts
// src/agent.ts 里新增
async function maybeCompact(): Promise<boolean> {
  const ctx = config.model.contextWindow ?? 32768;
  if (estimateTokens(messages) <= Math.floor(ctx * 0.75)) return false;
  // ...找切分点、调 summarizeRange、替换 messages[1..cutIdx]
}
```
`runTask` 每轮开头调一次 `await maybeCompact()`，事件层抛 `{ type: 'compact:done', freed: number }`（新增到 `agent/events.ts`，UI 显示一条 hint）。

---

## 三、功能 2：FileEdit 工具

**参考**：`claude源码/src/tools/FileEditTool/`（精确字符串替换 + replace_all）。

### 3.1 选址：**作为 fs-mcp 内置工具**
理由：
- fs-mcp 本就是文件工具集合，`read_file` / `write_file` 已在此；FileEdit 天然属于同一域。
- 独立 MCP 会多一个进程、多一组启动配置，不划算。
- 和 `write_file` 的关系：**write_file 用于新建/整文件覆盖**；**file_edit 用于已有文件的精确修改**。两者共存，分工明确。系统提示里加一句"修改已存在文件优先用 file_edit"。

### 3.2 Schema
```ts
{
  name: 'file_edit',
  description: '对已存在文件做精确字符串替换。必须先用 read_file 读过目标文件。old_string 必须在文件中唯一（除非 replace_all=true）。',
  inputSchema: {
    type: 'object',
    required: ['path', 'old_string', 'new_string'],
    properties: {
      path: { type: 'string', description: '目标文件路径' },
      old_string: { type: 'string', description: '要被替换的原始文本（必须完整、包含足够上下文以保证唯一）' },
      new_string: { type: 'string', description: '替换为的新文本（可为空串，表示删除）' },
      replace_all: { type: 'boolean', description: '替换所有出现，默认 false', default: false },
    },
  },
}
```

### 3.3 匹配与安全
核心逻辑（伪码）：
```
不存在 → 报错；old_string === new_string → 报错；
count = 子串出现次数
count === 0 → 报错 "请先 read_file 核对内容"
count > 1 且 !replace_all → 报错 "出现 N 次不唯一，扩大上下文或 replace_all=true"
否则：replace_all ? split+join : 首个 replace；写回。
```
- **只做精确匹配，不做模糊匹配**（本地模型常吐脏差异，模糊匹配会越界）。
- 不强制 read-before-edit（没有跨进程会话状态），描述里要求模型先读。
- **不做 CRLF 归一化**，保持文件原样。提示模型行尾要对齐。

### 3.4 `write_file` 的边界调整
在 `write_file` 描述里加一句"新文件优先 write_file；改已存在文件优先 file_edit（更安全、不会误删内容）"。

---

## 四、功能 3：CLAUDE.md 注入

**参考**：`claude源码/src/memdir/memdir.ts`、`paths.ts`。Claude Code 做的是分层注入：家目录 → 项目 → 子目录，层层叠加。

### 4.1 命名选择：**`AGENT.md`**
- `CLAUDE.md` 是 Claude Code 的约定，用它会混淆（同一个项目同时被两套工具读）。
- `MA.md` 太缩写。
- 选 **`AGENT.md`**：通用、表意清、和 Claude Code 不打架。
- 全局兜底：`~/.my-agent/AGENT.md`（用户放个人偏好）。

### 4.2 查找路径（从内到外）
```
cwd/AGENT.md
cwd/../AGENT.md
...一路向上到 cwd 所在的 git 根（有 .git/）或 home，停
~/.my-agent/AGENT.md    ← 全局兜底
```
不穿过 home 上面，避免读进无关目录。

### 4.3 合并策略：**拼接，近者在下**
原则：越近越优先 → 越近的放越后面（后面的指令覆盖前面）。
```
<SYSTEM_PROMPT>
{原 systemPrompt}
</SYSTEM_PROMPT>

<AGENT_MD source="~/.my-agent/AGENT.md">
{内容}
</AGENT_MD>

<AGENT_MD source="/Users/me/project/AGENT.md">
{内容}
</AGENT_MD>

<AGENT_MD source="/Users/me/project/sub/AGENT.md">
{内容}
</AGENT_MD>
```
每段有 XML 包围，模型不会把它们当成对话。

### 4.4 注入时机：**启动时一次**
- 运行时不重新扫描（避免每轮 IO + 模型困惑）。
- 用户改了 AGENT.md 需要重启会话生效。
- `/reload` 命令（新增，可选）触发重扫。

### 4.5 接口
```ts
// src/agent/memdir.ts
export interface AgentMdFile { path: string; content: string; }
export function loadAgentMdFiles(cwd: string): AgentMdFile[];
export function buildSystemPrompt(base: string, files: AgentMdFile[]): string;
```
实现要点：
- 先读 `~/.my-agent/AGENT.md`（若存在）。
- 从 cwd 向上走，遇到 `.git` 或到达 home 停；沿途每层 `AGENT.md` 都收集（外层在前、内层在后）。
- 单文件 >32KB 截断并加 `[...truncated]`；最多保留 5 层。
- `buildSystemPrompt` 用 `<SYSTEM_PROMPT>` + 多个 `<AGENT_MD source="...">` 块拼接。
- `createAgent` 调一次：`systemPrompt = buildSystemPrompt(originalSystem, loadAgentMdFiles(process.cwd()))`。

---

## 五、功能 4：会话持久化

**参考**：`claude源码/src/utils/sessionStorage.ts`（JSONL + 每轮 append）。

### 5.1 存储格式：**JSONL**
理由：
- JSONL 对追加友好（open+append，不用读整文件）。
- 损坏容忍好（读到一行 parse 失败就跳过，不丢整个文件）。
- 单 JSON：每轮整体重写，几十 K 消息时 IO 开销大。
- SQLite：超纲，维护一个 DB schema 不值得。

### 5.2 存什么：**messages 数组增量（push 一条）+ 元信息**
不存 AgentEvent 流——事件是瞬时 UI 层的东西，resume 只需要还原 LLM 上下文。
```jsonl
{"type":"meta","sessionId":"s_2026042201","startedAt":...,"cwd":"/...","model":"qwen3-30b-a3b"}
{"type":"msg","data":{"role":"user","content":"..."}}
{"type":"msg","data":{"role":"assistant","content":"...","tool_calls":[...]}}
{"type":"msg","data":{"role":"tool","tool_call_id":"...","content":"..."}}
```
每 push 一条 message 就 append 一行；system prompt 跳过（resume 时重新构造以应用最新 AGENT.md）。

### 5.3 存储路径
```
~/.my-agent/sessions/<sessionId>.jsonl
```
`sessionId = s_YYYYMMDD_HHmmss_<rand4>`。

### 5.4 接口
```ts
// src/session/store.ts
export interface SessionMeta { sessionId: string; startedAt: number; cwd: string; model: string; summary?: string; }
export interface SessionStore {
  sessionId: string;
  appendMessage(msg: ChatCompletionMessageParam): void;
  close(): void;
}
export function openSession(meta: Omit<SessionMeta, 'startedAt'>): SessionStore;
export function loadSession(sessionId: string): { meta: SessionMeta; messages: ChatCompletionMessageParam[] };
export function listSessions(limit?: number): Array<SessionMeta & { mtime: number; lastUser?: string }>;
export function pruneSessions(keepN: number): number;
```

### 5.5 Agent 集成
`createAgent` 接收可选 `resumeFrom?: string` 参数：
- 无 → 开新 session，meta + 空 messages。
- 有 → `loadSession(id)` 取历史 messages，**跳过原 system**，用新算的 system prompt（AGENT.md 可能变了），追加到 `messages`。
- `agent.ts` 里每次 `messages.push(...)` 之后立刻 `store.appendMessage(msg)`。

### 5.6 CLI
```bash
ma                      # 新 session（会自动保存）
ma --resume             # 恢复最近一个 session
ma --resume <id>        # 恢复指定 session
ma sessions             # 列出最近 20 个 session
ma sessions --all       # 列出全部
```
`ma sessions` 输出：
```
s_20260422_152301_a3f1  2h ago   qwen3-30b  "帮我看一下 agent.ts 的压栈逻辑"
s_20260422_102100_9b2c  5h ago   qwen3-30b  "写一个 FileEdit 工具"
```

### 5.7 自动清理
- 策略：按 mtime 保留最近 20 个，多出来的删掉。
- 触发：每次 `openSession` 时顺便 `pruneSessions(20)`。
- 用户可在 `config.json` 设 `session.keepCount`。

---

## 六、功能 5：危险命令确认

**参考**：`claude源码/src/utils/permissions/dangerousPatterns.ts`（黑名单思路，但 Claude Code 那套太重）。

### 6.1 范围限定
只拦 **`exec-mcp` 的命令执行**（现有 `exec-mcp.ts` 里提供 `execute_command` / shell 执行类工具）。文件工具（`write_file`、`file_edit`）默认不拦——模型改代码就是它的日常。

### 6.2 黑名单（起步版）
按**正则子串匹配**（简单、可审计）。模块：`src/agent/dangerGuard.ts`。
```ts
export function classifyCommand(cmd: string): { dangerous: boolean; reason?: string };
```
模式清单（命中任意一条就算危险）：
| 正则 | 原因 |
|---|---|
| `\brm\s+(-[rRfF]+\s+)?\/(?:\s\|$)` | 删除根目录 |
| `\brm\s+-[rRfF]+\s+~` | 删除 HOME |
| `\brm\s+-[rRfF]+\s+\*` | rm -rf 通配符 |
| `\bgit\s+push\s+.*(--force\|-f)\b` | force push |
| `\bgit\s+reset\s+--hard\b` | 硬重置 |
| `\bgit\s+clean\s+-[fFdD]+` | git clean 强制 |
| `\bchmod\s+-?R?\s*777\b` | 777 权限 |
| `\b(curl\|wget)\s+[^\|]*\|\s*(bash\|sh\|zsh)\b` | 管道执行远端脚本 |
| `>\s*\/dev\/sd[a-z]` | 写入磁盘设备 |
| `\bmkfs\.` | 格式化文件系统 |
| `\bdd\s+.*of=\/dev\/sd` | dd 写磁盘 |
| `\bsudo\b` | sudo 提权 |
| 同时含 `$` 和 `rm -rf` | 变量扩展 rm（见 §8） |

### 6.3 白名单（用户配置）
`config.json` 新增：
```json
"danger": {
  "allow": [
    "git reset --hard HEAD",
    "rm -rf ./dist"
  ],
  "mode": "confirm"   // "confirm" | "deny" | "off"
}
```
逻辑：命令字符串如果精确等于（trim 后）`allow` 里某项，放行；否则按 `mode`：
- `confirm`（默认）：UI 弹确认框
- `deny`：直接拦截，返回 tool result: "该命令被策略拦截"
- `off`：不拦

### 6.4 拦截位置
`agent.ts` 的 `runTask` 里 `for (const tc of toolCalls)` 分派之前。针对 `exec-mcp__execute_command`（或命令执行类工具 allowlist）：命中 `classifyCommand` 且不在白名单 → 按 `mode` 处理。`deny` 直接填 `toolResult = '[blocked] <reason>'` 并 `isError = true`；`confirm` 走下文 §6.5，用户 deny 后 `toolResult = '[user denied] <reason>'`。

### 6.5 确认 UI
- agent.ts 侧：通过新事件 `{ type: 'tool:confirm'; callId; cmd; reason }` 发给 UI；等待 UI 侧通过 `agent.respondConfirm(callId, approve)` 回复。
- `App.tsx` 侧：监听该事件，state 加一个 `pendingConfirm`；渲染一个 `<ConfirmDialog>`（基于 `useInput` 监听 `y/n`）；用户按键后回传。
- 非 TTY / 非交互模式：默认 `deny`（安全第一）。

### 6.6 事件类型新增
```ts
// src/agent/events.ts
| { type: 'tool:confirm'; requestId: string; cmd: string; reason: string }
| { type: 'compact:done'; freed: number }
```

---

## 七、任务拆解（按可并行性）

| # | 任务 | 触达文件 | 依赖 | 估计 LOC | 可并行 |
|---|---|---|---|---|---|
| T1 | Token 估算模块 | `src/agent/tokenCount.ts`（新） | 无 | ~40 | ✅ |
| T2 | Summarize 模块 + compact 触发 | `src/agent/summarize.ts`（新）、`src/agent.ts`（maybeCompact） | T1 | ~140 | — |
| T3 | FileEdit 工具 | `servers/fs-mcp.ts` | 无 | ~120 | ✅ |
| T4 | AGENT.md 加载与拼接 | `src/agent/memdir.ts`（新）、`src/agent.ts`（createAgent 改一行） | 无 | ~100 | ✅ |
| T5 | Session store | `src/session/store.ts`（新） | 无 | ~120 | ✅ |
| T6 | Session 接入 agent + CLI `--resume` | `src/agent.ts`（resumeFrom 参数 + 每步 append）、`src/cli.ts`（commander 新参数） | T5 | ~60 | 跟 T5 同一人做 |
| T7 | `ma sessions` 列表命令 | `src/cli.ts` + `src/session/store.ts` | T5 | ~40 | ✅（跟 T6 同一人） |
| T8 | dangerGuard 分类器 + 白名单 | `src/agent/dangerGuard.ts`（新） | 无 | ~80 | ✅ |
| T9 | 危险命令拦截 + confirm 事件 | `src/agent.ts`、`src/agent/events.ts` | T8 | ~40 | — |
| T10 | 确认 UI 组件 | `src/cli/components/ConfirmDialog.tsx`（新）、`src/cli/App.tsx` | T9 | ~60 | — |
| T11 | 单元测试：tokenCount、summarize 切分、memdir 合并、danger 分类、session 读写 | `test/*` | 各自模块 | ~200 | ✅ |

**5 人并行建议**（覆盖全部里程碑）：
- 人 A：T1 → T2（F1 Context 压缩全包）
- 人 B：T3（F2 FileEdit）
- 人 C：T4（F3 AGENT.md）
- 人 D：T5 → T6 → T7（F4 Session，链式串行）
- 人 E：T8 → T9 → T10（F5 危险命令，链式串行；T9/T10 需在 T2 合入后 rebase）
- 并行测试：T11 可在功能合入节奏上滚动加（每合入一个模块，一个独立测试人补单测）

**总 LOC**：代码约 ~960、测试 ~200，分摊到 5 人每人约 230 行，**人均不超 200 行红线**（测试行不计）。

---

## 八、风险和边界

### 每个功能的坑

- **F1 Context 压缩**
  - 坑：切分点在 `assistant(tool_calls)` 和 `tool(result)` 中间会导致 OpenAI 协议错误。必须保证切分后首条不是孤立 `role: 'tool'`。
  - 坑：本地模型 summarize 能力差，summary 可能很烂。兜底：summary 为空 / <50 字 → 不 compact，下次再试。
  - 坑：frequency_penalty 高（1.15）会让 summary 更混乱，compact 调用应单独用 temperature=0.2、不加 frequency_penalty。
  - 回归风险：`foldMessages`（现有任务栈折叠）与 compact 可能冲突——**compact 只能压 `role !== 'system'` 的消息，栈 fold 产生的 `[stack:completed]` 系统消息不能动**。

- **F2 FileEdit**
  - 坑：old_string 跨越 BOM / 行尾 `\r\n` vs `\n`，模型提供的串和文件实际内容不匹配。不做归一化（保真），提示里警告。
  - 坑：二进制文件——`fs-mcp` 已有 isBinary 检查，沿用：file_edit 前先 binary check，是则拒绝。
  - 坑：超大文件（>256KB，fs-mcp 现有上限）不适合 edit，要么放宽上限要么拒绝。拟定：edit 允许 ≤512KB。

- **F3 AGENT.md**
  - 坑：目录链很长（monorepo）累计内容超 system prompt 合理大小。单文件 32KB 截断 + 总量最多 5 层 AGENT.md。
  - 坑：`.git` 判定在 worktree 里可能是文件不是目录。用 `fs.existsSync`，不区分。
  - 坑：用户更新 AGENT.md 不立即生效。加 `/reload` 提示（后续版本）。

- **F4 Session 持久化**
  - 坑：并发两个 `ma` 实例对同一 sessionId append？sessionId 带时间戳+rand 足以规避，不做锁。
  - 坑：resume 时 tool_call / tool_result 配对断裂（上次异常退出在 tool_call 之后、tool_result 之前）。加载时做一遍配对校验：发现孤立 `tool_calls` 则丢掉它（连同相关 assistant message 的 tool_calls 字段）。
  - 坑：AGENT.md 变了后 resume，system prompt 会和当初不一致——**这是特性不是 bug**，永远用新的。

- **F5 危险命令**
  - 坑：黑名单永远不全。管道/变量/`eval` 可绕过。态度：**本地场景用户信任模型 90%，拦下明显高危的 10%**，不追求全。
  - 坑：模型解释变量的命令（`rm -rf $PROJECT_ROOT`）正则测不到 $ 扩展。额外规则：包含 `$` 和 `rm -rf` 同现也弹确认。
  - 坑：非 TTY（管道调用、CI）没法交互。策略：非 TTY 自动切 `deny` 模式。

### 兼容性
- 现有 `foldMessages`（任务栈归档）与 compact 协作：compact 前把任务栈的 stack-state 系统消息摘掉再评估 token（已经在做 removeLastStackStateMessage）。
- 现有 `compactToolResult`（单条工具结果压缩）保留，和 F1 并存：前者是点压缩（单条太长），F1 是面压缩（整体太长）。
- `agent.reset()` 需要同时关 session store + 开新 session。
- `config.json` 新增字段都有默认值，不破坏现有配置。

### 测试策略（统一）
- **不 mock 模型**：summarize 单测可以跑真实本地 LM（可选 skip），或构造 mock response 只测流程。按用户红线走，**不 mock 数据库/文件系统**。
- **tokenCount**：表驱动（中文 / 英文 / 图片 / tool_calls 各一组）。
- **summarize 切分**：构造 tool_call 配对消息，验证切分不破坏配对。
- **memdir**：真文件 tmpdir 测试多层 AGENT.md 查找与合并顺序。
- **danger**：正则表驱动，含绕过尝试（空格、大小写、换行）。
- **session**：写入后读回相等；损坏行跳过；prune 按 mtime 保留 N 个。
- **集成测试**：一条对话链路跑 20 轮 → compact 触发 → resume → 能看到 summary + 新消息。

---

## 九、交付约定

- 每个功能一个 PR，PR 描述含本文对应章节链接。
- 合并顺序：T1 → T4 / T5 / T3（并行）→ T2 → T6/T7 / T8-T10 （并行）→ T11（贯穿）。
- 每个 PR 要求：diff ≤ 200 行（不含测试）+ 本模块单测 + README 一节说明新增用法。
