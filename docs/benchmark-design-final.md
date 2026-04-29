# MA Agent Benchmark — Final Design

> Merged from Plan A (YAML tasks + hard/soft assertions + milestones) and Plan B (AUS uplift + 6 dimensions + stability metrics).
>
> One-line summary: **5-level graded task bank (110 YAML tasks: 10 L0 + 100 L1–L5) with 6-dimension continuous scoring, Agent Uplift Score as north-star metric, 5-run median for stability, and Claude Code baseline comparison.**

---

## 0. Core Metrics (What You See After a Run)

```
MA v0.3.1 @ Qwen3-30B → Level 2.6/5.0 | Score 58/100 | AUS 57% | LocalEdge +12%
```

| Metric | What It Measures | Formula |
|--------|-----------------|---------|
| **Level** | Highest tier where all prerequisites pass (with decimal progress into next) | `max{L: pass(L0)∧...∧pass(L)} + nextLevel_passRate` |
| **Score** | Weighted sum across all levels, 0–100 | `Σ α_L × score(L)` |
| **AUS** | How much MA lifts 30B toward Claude Code | `(MA30B − Raw30B) / (MAClaude − Raw30B) × 100%` |
| **LocalEdge** | Cost-efficiency advantage of local over cloud | `MA30B_score/cost − MAClaude_score/cost` |

---

## 1. Level Structure (L0–L5)

Each level gates on the previous — no skipping. L0 failure = `invalid_run`.

| Level | Name | New Capability | Tasks | Gate Threshold | Weight (α) |
|-------|------|----------------|-------|----------------|------------|
| **L0** | Connectivity | Model responds, tools connect | 10 | 100% pass rate | 0 (prerequisite) |
| **L1** | Stable Tool Calls | Single-turn single-tool accuracy | 30 | ≥ 90% pass rate + score ≥ 0.75 | 15 |
| **L2** | Multi-turn Work | Context retention, error recovery | 30 | ≥ 80% pass rate + score ≥ 0.65 | 20 |
| **L3** | Complex Workflows | Compact, plan, cross-file ops | 20 | ≥ 70% pass rate + score ≥ 0.55 | 25 |
| **L4** | Autonomous Planning | Self-directed task decomposition | 15 | ≥ 60% pass rate + score ≥ 0.45 | 25 |
| **L5** | Near Claude Code | Ambiguous instructions, long sessions | 5 | ≥ 50% pass rate + score ≥ 0.40 | 15 |

**Score center points**: L1=15, L2=35, L3=60, L4=85, L5=100. Total 0–100.

**Level with decimal**: `final_level = max_passed_L + next_level_passRate`. Example: L2 passed, L3 at 55% → Level = 2.55.

### 1.1 Per-Level New Capability (Diagnostic Value)

| Upgrade | What's New | If Fail, Fix This |
|---------|-----------|-------------------|
| L0→L1 | Stable tool_call + valid args | Tool schema prompting, temperature |
| L1→L2 | Multi-turn context + no repeated errors | foldMessages, errorHistory, nudge |
| L2→L3 | Long context / compact + planning | Token estimation, summarize quality, task stack |
| L3→L4 | Cross-file reasoning + tool composition | Model reasoning depth, AGENT.md usage |
| L4→L5 | Ambiguity clarification + long-horizon stability | Agentic loop design, long-term memory |

---

## 2. Six-Dimension Scoring

Every task scores on 6 dimensions (0–1 continuous), not just pass/fail. This is the diagnostic layer.

| Dimension | Abbrev | 0 Score | 1 Score | Default Weight |
|-----------|--------|---------|---------|----------------|
| **Tool Accuracy** | ToolAcc | Wrong tool / bad args / shouldn't have called | Correct tool, args, timing | 0.25 |
| **Task Completion** | TaskDone | User goal unmet | User goal 100% met | 0.30 |
| **Answer Quality** | AnsQual | Empty / hallucinated / irrelevant | Accurate, specific, grounded in tool results | 0.15 |
| **Context Retention** | CtxKeep | Forgets by turn 2 | References turn 1 facts in turn 3+ | 0.10 |
| **Error Recovery** | ErrRec | Infinite retry / crash on error | Detect error → change strategy → reach goal | 0.10 |
| **Efficiency** | Eff | >3× reference rounds/tokens | ≤ reference value | 0.10 |

**Task score** = `Σ(dim_score × dim_weight)` → 0–1.

**PASS** = task_score ≥ 0.7 AND ToolAcc ≥ 0.5 AND TaskDone ≥ 0.5 (two core dimensions have floors).

Dimension weights can be overridden per-task in YAML (e.g., L5 tasks: TaskDone=0.50, Eff=0.05).

### 2.1 Dimension Calculation Rules

- **ToolAcc**: `correct_calls / total_calls`. "Correct" = right tool name, key args, timing. LLM-as-judge with reference tool sequence.
- **TaskDone**: Programmatic check when objective anchor exists (file content, exit code). LLM judge (0/0.5/1) otherwise.
- **AnsQual**: Average of 3 sub-scores (relevance, specificity, factual accuracy). LLM judge with rubric.
- **CtxKeep**: Multi-turn tasks only. Can later turns reference earlier tool results without re-calling? Skip for single-turn.
- **ErrRec**: Error-scenario tasks only. `1 - (same_error_retries / 3)` clamped [0,1]. Must acknowledge failure in final text.
- **Eff**: `min(1, reference_rounds / actual_rounds)`. Does NOT affect pass/fail, only total score.

---

## 3. Task Format (YAML)

Every task is one YAML file. The benchmark runner reads these — no hardcoded tasks in code.

```yaml
# test/benchmark/tasks/L2-003-fix-readme.yaml
id: L2-003
title: Change README version number
level: L2
category: file-edit
weight: 1.0

# Environment
fixture:
  project: simple-node-project
  setup:
    - echo "VERSION: 1.0.0" > README.md

# Input
user_input: |
  Change the version in README to 2.0.0

# Multi-turn (optional, for L2+ tasks)
rounds:
  - user: "Change the version in README to 2.0.0"
    expect:
      tool_calls_include: [fs__read_file]

# Hard assertions (all must pass for PASS)
hard_assertions:
  - type: tool_called
    tool: fs__read_file
    args_contains: { path: "README.md" }
  - type: tool_called
    tool_matches: "fs(-edit)?__(write|edit)_file"
  - type: file_content
    path: README.md
    contains: "VERSION: 2.0.0"
    not_contains: "VERSION: 1.0.0"
  - type: no_error_5xx
  - type: tool_retry_max
    max_same_error: 2

# Soft assertions (0–1 scores, weighted)
soft_assertions:
  - type: final_text_min_len
    chars: 20
    weight: 0.3
  - type: tool_call_count_max
    max: 3
    weight: 0.3
  - type: llm_judge
    rubric: "Is the response concise and confirms the change was made?"
    weight: 0.4

# Dimension weight overrides (optional)
dim_weights:
  TaskDone: 0.35
  ToolAcc: 0.25
  AnsQual: 0.15
  CtxKeep: 0.0
  ErrRec: 0.10
  Eff: 0.15

# Reference
reference:
  claude_code_score: 0.95
  reference_rounds: 3
  human_time_sec: 30

# Runtime
runtime:
  timeout_sec: 120
  runs: 5              # 5-run median (default)
  max_rounds: null     # null = no limit beyond timeout
  layer: L2            # which e2e layer helper to use
```

### 3.1 Hard Assertion Types

| Type | Implementation | Notes |
|------|---------------|-------|
| `tool_called` | Scan agent events for `tool:call` | Supports `args_contains`, `args_matches` regex |
| `tool_not_called` | Verify absence | For "shouldn't use tool" tasks |
| `tool_retry_max` | Count same-tool same-error retries | Default max=2 |
| `file_content` | Read disk after task | contains / not_contains / regex / exact |
| `file_exists` | `fs.existsSync` | |
| `no_error_5xx` | No 5xx in event stream | |
| `final_text_contains` | Regex/keyword in last assistant message | |
| `final_text_min_chars` | Min length | Chinese chars via `[一-鿿]` |
| `event_sequence` | Ordered event assertion | e.g., `tool:call → tool:result → task:done` |
| `messages_count_max` | Cap on messages array length | Prevents infinite loops |
| `not_file_modified` | File unchanged after task | For "don't modify tests" checks |
| `exit_code` | Post-task command exits 0 | `npm test` verification |

### 3.2 Soft Assertion Types

| Type | Output | Notes |
|------|--------|-------|
| `final_text_min_len` | 0–1 scale | |
| `tool_call_count_max` | `min(1, max/actual)` | Fewer = better |
| `token_usage_max` | `min(1, max/actual)` | |
| `duration_max` | `min(1, max/actual)` | |
| `llm_judge` | 0–1 from judge model | See §5 |
| `reference_match_ratio` | Embedding cosine similarity | |

---

## 4. Task Bank (100 Tasks, v1)

### 4.1 Distribution

```
L0: ██████████                     10 (10%)   Connectivity baseline
L1: ██████████████████████████████ 30 (30%)   Stable tool calls
L2: ██████████████████████████████ 30 (30%)   Multi-turn work
L3: ████████████████████           20 (20%)   Complex workflows
L4: ███████████████                15 (15%)   Autonomous planning
L5: █████                           5 ( 5%)   Near Claude Code
```

### 4.2 L0 — Connectivity (10 tasks, gate: 100%)

| ID | Input | Key Assertion |
|----|-------|---------------|
| L0-001 | "Hello" | finalText non-empty |
| L0-002 | "1+1=" | finalText contains "2" |
| L0-003 | "List current directory files" | tool_called: fs__list_directory, ok=true |
| L0-004 | "Read package.json" | tool_called: fs__read_file, ok=true |
| L0-005 | "Run `echo hello`" | tool_called: exec__execute_command, ok=true |
| L0-006 | "Search for 'TODO' in src/" | tool_called: grep__grep, ok=true |
| L0-007 | "Create /tmp/test.txt with content 'test'" | tool_called: fs__write_file or fs-edit, ok=true |
| L0-008 | "Edit config.json: change port to 8080" | tool_called: fs-edit__*, ok=true |
| L0-009 | "Add a todo: review PR" | tool_called: todo_write, ok=true |
| L0-010 | "{{10K chars meaningless text}}" | not_crashed, reasonable response |

### 4.3 L1 — Stable Tool Calls (30 tasks, gate: 90%)

Single-turn, single-tool, clear instructions. Categories:

| Category | Count | Examples |
|----------|-------|---------|
| Read file | 6 | "Read package.json, tell me `name`" / "Read README first 5 lines" |
| Write file | 4 | "Create hello.txt with content 'hi'" |
| List directory | 4 | "What's in src/?" |
| Execute command | 6 | "Run `node -v`" / "Run `git branch --show-current`" |
| Search | 4 | "Find files containing 'useState' in src/" |
| Should NOT call tool | 4 | "What's 1+1?" / "Hello" / "Introduce yourself" |
| Tool name tolerance | 2 | "Read 'package.json'" (with quotes) / "Read ./package.json" |

### 4.4 L2 — Multi-turn Work (30 tasks, gate: 80%)

Multi-tool, multi-turn, error recovery. Categories:

| Category | Count | Examples |
|----------|-------|---------|
| Read-modify-write | 6 | Change README version / append line / replace config value |
| Multi-turn follow-up | 6 | Q1: "What's this project?" → Q2: "Tell me more" (no redundant tool calls) |
| Error recovery | 4 | Read nonexistent path → acknowledge failure, don't retry >2× |
| Command failure | 3 | Run `nonexistent-cmd` → don't hallucinate output |
| Multi-step task | 5 | Read package.json, then run `npm test`, report results |
| Context persistence | 4 | 3–4 turn conversation, still reference turn 1 facts |
| Empty answer self-rescue | 2 | Trigger empty-content scenario, eventually produce answer |

### 4.5 L3 — Complex Workflows (20 tasks, gate: 70%)

Long context, compact, cross-file, plan decomposition:

| Category | Count | Examples |
|----------|-------|---------|
| Long context survival | 5 | 10-turn conversation, compact triggers, still answers turn 1 question |
| Task decomposition | 4 | "Analyze project architecture" → triggers create_task / 3+ different tools |
| Precise file edit | 3 | Use file_edit to change 2 non-unique strings |
| Small feature implementation | 4 | Add a parameter to existing function / add an output field |
| Run tests and report | 2 | "Run tests and tell me how many pass" → no re-runs |
| Error injection | 2 | fs__write_file returns "disk quota exceeded" → agent adapts |

### 4.6 L4 — Autonomous Planning (15 tasks, gate: 60%)

Agent decides its own strategy. User gives no instructions on HOW.

| Category | Count | Examples |
|----------|-------|---------|
| Architecture analysis | 3 | "Analyze this project's architecture" → self-directed exploration |
| Cross-file tracing | 3 | "Where is useState called and do they share state?" |
| Small refactor | 3 | "Replace all console.log with logger.info in this file" |
| Root cause diagnosis | 3 | Given bug symptoms + logs → point to file:line |
| Multi-MCP composition | 3 | grep → read → edit → exec (verify) chained |

### 4.7 L5 — Near Claude Code (5 tasks, gate: 50%)

Full sessions, 15+ minutes, multi-compact. **Max rounds unlocked** (limit = reference × 5). Eff weight drops to 0.05, TaskDone rises to 0.50.

| ID | Description | Reference Rounds | Max Rounds |
|----|-------------|-----------------|------------|
| L5-001 | Pre-planted bug fix (off-by-one) | 15 | 75 |
| L5-002 | Unfamiliar project onboarding doc | 15 | 75 |
| L5-003 | Add `--verbose` flag to CLI | 20 | 100 |
| L5-004 | Ambiguous instruction clarification | 10 | 50 |
| L5-005 | 30+ turn conversation, 3× compact, recall turn 1 detail | 30 | 150 |

### 4.8 Cross-cutting Coverage

| Dimension | ~Tasks | Notes |
|-----------|--------|-------|
| fs tools | ~35 | Read/write/edit/list |
| exec tools | ~20 | Commands, git, npm |
| grep tools | ~10 | Search |
| web tools | ~5 | Can skip (network instability) |
| Pure conversation | ~10 | "Should it call a tool?" judgment |
| Multi-tool combo | ~20 | L3+ primary |

---

## 5. Judge System

### 5.1 Layered Judging

1. **Programmatic anchors first** (~60% of assertions): file content, exit codes, tool call sequences, round counts. No LLM involved.
2. **LLM-as-judge for fuzzy dimensions**: AnsQual (relevance, specificity, factuality) and TaskDone when no objective anchor.
3. **Human spot-check**: 10% random sample per run. If judge errors found → fix prompt or add anchors.

### 5.2 Judge Model

- **Fixed**: Claude Sonnet 4.6 (never the model being tested).
- **3 judge runs per task, take median** — counters judge LLM variance.
- **Red line**: LLM judge NEVER decides hard_pass/fail. Only soft scoring and dimension scoring for fuzzy criteria.

### 5.3 Judge Prompt Template (AnsQual)

```
You are a strict agent output reviewer. Score each sub-dimension 0 / 0.5 / 1.

User question: {{user_prompt}}
Reference answer key points (cover ≥N for full score):
{{rubric_points}}

Agent final answer:
{{agent_final_text}}

Agent tool results (for hallucination check):
{{tool_results_summary}}

Sub-dimensions:
- Relevance: Is the answer addressing the user's question?
- Specificity: Does it cite concrete data/filenames/error messages from tool results?
- Factual: Can key claims be verified against tool results or fixture?

Output JSON: {"relevance": 0/0.5/1, "specificity": 0/0.5/1, "factual": 0/0.5/1, "reason": "one line"}
```

### 5.4 Anti-gaming Rules

| Condition | Result |
|-----------|--------|
| No tool calls but claims completion | ToolAcc=0, TaskDone=0 |
| finalText contains `<think>` / `<\|channel\|>` thinking leaks | AnsQual capped at 0.3 |
| Same error retry >3× | ErrRec=0 |
| Exceeds reference_rounds × 5 without completion | Force stop, Eff=0, other dims scored at current state |

---

## 6. Scoring Algorithm

### 6.1 Task Score

```
score(T) = hard_pass(T) × (w_h + w_s × soft_score(T))

hard_pass ∈ {0, 1}     — all hard_assertions pass → 1, else → 0
soft_score ∈ [0, 1]    — weighted average of soft_assertions
w_h = 0.6, w_s = 0.4   — hard floor 60%, soft adds up to 40%
```

No hard_pass → 0 points. No "effort credit."

### 6.2 5-Run Median (Stability)

Each task runs **5 times** (not 3). Take **median** score as official task score.

Additionally compute **stability** = `1 - std(5_scores)`. Reported per-task but does not enter total score — it's a diagnostic signal.

| Pattern | Interpretation |
|---------|---------------|
| All 5 runs > 0.9 | Stable strong |
| Scores bounce 0.3–0.9 | Unstable — mark `stability=low` |
| All 5 runs < 0.5 | Stable weak (genuine inability, not flaky) |

Why 5 not 3: With 30B models, 3 runs often produce 1 pass + 2 fail, making median == fail which is identical to "never passed." 5 runs give enough signal to distinguish "usually works" from "got lucky once."

### 6.3 Level Score

```
score(L) = Σ(w_T × score(T)) / Σ(w_T)    for T ∈ level L
```

### 6.4 Level Pass Judgment (Dual Gate)

```
pass(L) = (score(L) ≥ cutoff_L) AND (hard_pass_rate(L) ≥ rate_L)
```

Both gates must pass — score gate prevents soft scores masking hard failures; rate gate prevents a few perfect tasks masking many zeroes.

### 6.5 Total Benchmark Score

```
Benchmark Score = Σ(α_L × score(L))    for L=1..5
```

Only levels where all prerequisites pass contribute. If L2 fails, L3–L5 scores are recorded in detail but excluded from total.

### 6.6 Level Determination

```
final_level = max{L : pass(L0) ∧ pass(L1) ∧ ... ∧ pass(L)}
decimal_level = final_level + score(final_level + 1)   (progress into next)
```

---

## 7. Agent Uplift Score (AUS) — North Star

### 7.1 Three Configurations

Same tasks, same scoring, three runs:

| Config | Description | Variable |
|--------|------------|----------|
| **Raw30B** | Raw HTTP to 30B model, system prompt + user prompt only, no agent loop, no MCP | Baseline |
| **MA30B** | MA agent + 30B model (normal usage) | Target |
| **MAClaude** | MA agent + Claude Sonnet 4.6 | Ceiling |

### 7.2 Formula

```
AUS = (MA30B − Raw30B) / (MAClaude − Raw30B) × 100%
```

Meaning: **MA agent lifts 30B from "bare hands" to X% of "Claude Code level."**

Example: Raw30B=22, MA30B=58, MAClaude=85 → AUS = (58-22)/(85-22) = **57%**.

### 7.3 Why AUS Is the Right Metric

- **Model-agnostic**: Upgrading Qwen3→Qwen4 moves both Raw30B and MAClaude, so AUS only changes if agent layer improves.
- **Attributable**: AUS rise = agent genuinely improved, not just riding a better model.
- **Bounded**: 100% = agent makes 30B as good as Claude. Clear ceiling, clear gap.

### 7.4 LocalEdge (Companion Metric)

```
LocalEdge = (MA30B_score / MA30B_cost) - (MAClaude_score / MAClaude_cost)
cost = token_count × price_per_1k + latency_seconds
```

For local models, price_per_1k = 0 (or near-zero electricity), so LocalEdge reflects the "infinite free tokens" advantage. Prevents benchmark from blindly favoring "more like Claude = better" when local has a legitimate cost edge.

### 7.5 AUS Red Line

All three configs must run on the **exact same tasks and fixtures** in the same run. No reusing stale baseline data across runs — it invalidates the ratio.

---

## 8. Output Report

### 8.1 One-screen Dashboard

```
═══════════════════════════════════════════════════════════
  MA Agent Benchmark — 2026-04-29 14:32 CST
═══════════════════════════════════════════════════════════

  Config:         MA v0.3.1 + Qwen3-30B
  Total Score:    58.3 / 100
  Level:          L2.6 / 5.0
  AUS (Uplift):   57%
  Local Edge:     +12%

  ─────── Levels ───────
  L0 Connectivity     ██████████ 100%  ✓ (gate 100%)
  L1 Stable Tools     █████████░  92%  ✓ (gate 90%)
  L2 Multi-turn       ████████░░  78%  ✓ (gate 80%)
  L3 Complex Flow     ██████░░░░  60%  × (gate 70%, not met)
  L4 Autonomous Plan  ████░░░░░░  35%  — (locked)
  L5 Near Claude Code ██░░░░░░░░  20%  — (locked)

  ─────── Dimensions ───────
  ToolAcc      ████████░░  0.82
  TaskDone     ███████░░░  0.71
  AnsQual      ██████░░░░  0.63   ← weak
  CtxKeep      ███████░░░  0.74
  ErrRec       █████░░░░░  0.52   ← weakest
  Eff          ████████░░  0.80

  ─────── Top 3 Loss Points ───────
  1. L3-010 disk quota injection → infinite retry (ErrRec 0.1)
  2. L4-001 architecture analysis → vague, no file refs (AnsQual 0.3)
  3. L2-015 search follow-up → repeated grep call (CtxKeep 0.2)

  ─────── vs Last Run ───────
  Total:  +3.2   (55.1 → 58.3)
  AUS:    +5%    (52% → 57%)
  Regression: L5-002 pass→fail (fold strategy side-effect?)

═══════════════════════════════════════════════════════════
```

### 8.2 JSON Output

```json
{
  "runId": "2026-04-29T14:32:00Z-abc",
  "config": {"agent": "MA v0.3.1", "model": "Qwen3-30B"},
  "scores": {
    "total": 58.3,
    "level": 2.6,
    "aus": 0.57,
    "localEdge": 0.12,
    "byLevel": {
      "L0": {"passRate": 1.0, "score": 1.0, "gateOk": true},
      "L1": {"passRate": 0.92, "score": 0.88, "gateOk": true},
      "L2": {"passRate": 0.78, "score": 0.72, "gateOk": true},
      "L3": {"passRate": 0.60, "score": 0.56, "gateOk": true},
      "L4": {"passRate": 0.35, "score": 0.31, "gateOk": false},
      "L5": {"passRate": 0.20, "score": 0.18, "gateOk": false}
    },
    "byDim": {
      "ToolAcc": 0.82, "TaskDone": 0.71, "AnsQual": 0.63,
      "CtxKeep": 0.74, "ErrRec": 0.52, "Eff": 0.80
    }
  },
  "perTask": { "L1-001": {"median": 0.95, "stability": 0.92, "runs": [0.9,1.0,0.95,1.0,0.9]} },
  "weakest": [
    {"id": "L3-010", "dim": "ErrRec", "score": 0.1},
    {"id": "L4-001", "dim": "AnsQual", "score": 0.3}
  ],
  "regressions": [{"id": "L5-002", "prev": "pass", "now": "fail"}],
  "baselineRuns": {"raw30B": 22.1, "ma30B": 58.3, "maClaude": 85.3}
}
```

### 8.3 Trend Tracking

Each run appends to `baselines/history.jsonl`. Generate:
- **Total/AUS line chart** (x=commit, y=score)
- **Level staircase** (L0–L5 pass rates over time)
- **Dimension radar comparison** (this run vs last vs all-time best)
- **Loss heatmap** (task × run) — identifies structural failures vs flaky

---

## 9. Implementation Structure

```
test/benchmark/
  tasks/
    L0/                           # 10 YAML files
    L1/                           # 30 YAML files
    L2/                           # 30 YAML files
    L3/                           # 20 YAML files
    L4/                           # 15 YAML files
    L5/                           # 5 YAML files

  runner/
    index.ts                      # Entry: load YAML → run → report
    task-loader.ts                # Parse YAML + schema validation
    assertions/
      hard.ts                     # All hard assertion implementations
      soft.ts                     # All soft assertion implementations
      llm-judge.ts                # Claude Sonnet judge wrapper
    scorer.ts                     # score(T), score(L), Benchmark Score, AUS
    reporter.ts                   # JSON + MD + ASCII dashboard

  judge/
    claude-judge.ts               # Claude Sonnet 4.6 API client
    judge-prompt.ts               # Prompt templates per dimension

  fixtures/                       # Reuse test/e2e/fixtures/
  
  baselines/
    claude-code.json              # Claude Code baseline
    raw-30b.json                  # Raw 30B baseline (no agent)
    history.jsonl                 # Append-only run history

  reports/
    <run-id>/
      summary.json
      summary.md
      per-task/<task-id>.json
```

Entry points:

```bash
npm run benchmark                          # Full run (all levels)
npm run benchmark -- --level L2            # Single level
npm run benchmark -- --task L2-003         # Single task
npm run benchmark -- --compare baselines/claude-code.json   # Comparison mode
npm run benchmark -- --config raw          # Raw30B mode (no agent)
npm run benchmark -- --config claude       # MAClaude mode
npm run benchmark -- --aus                 # Run all 3 configs + compute AUS
```

### 9.1 Layer Alignment with E2E

Benchmark reuses e2e infrastructure, does NOT rebuild:

| Task Level | E2E Layer Used | Notes |
|-----------|---------------|-------|
| L0–L1 | L1 (API) or L2 (Agent) | Depends on whether agent loop is needed |
| L2–L4 | L2 (Agent) | Main path |
| L5 | L2 (Agent) + L3 (CLI/PTY) for interactive tasks | Only long-session tasks need PTY |

---

## 10. Milestones

### Milestone 1 (2 weeks): L0 + L1 + L2 MVP

- Build `test/benchmark/` skeleton
- 10 L0 + 30 L1 + 30 L2 tasks (reuse e2e scenarios + test/cases/README)
- Runner with hard assertions, simple soft assertions (length, count)
- 5-run median + stability output
- **Deliverable**: First score report — tells us if we're above or below L2

### Milestone 2 (4 weeks): L3 + L4 + Claude Code Baseline

- 20 L3 + 15 L4 tasks
- LLM-as-judge integration (Claude Sonnet 4.6)
- All 6 dimensions fully scored
- Claude Code baseline run + comparison report
- **Deliverable**: First "gap diagnosis card" — where we lag and by how much

### Milestone 3 (6 weeks): L5 + AUS + Trend

- 5 L5 tasks (expensive to build but few)
- Raw30B config + AUS computation
- History tracking + trend charts
- CI integration: PR runs L0–L2 (~10min), release runs L0–L4 (~40min), manual trigger for full L0–L5+AUS
- **Deliverable**: Complete benchmark as release gate + progress dashboard

---

## 11. Red Lines

1. **No mocking** — benchmark runs real local model, real MCP, real judge model.
2. **Judge model fixed** — Claude Sonnet 4.6 as judge. Never the tested model. Never swap mid-run.
3. **Judge 3× median** — every judge call runs 3 times, take median. Non-negotiable.
4. **YAML is single source of truth** — no tasks hardcoded in runner code.
5. **LLM judge = soft only** — pass/fail must be mechanically verifiable. No LLM deciding pass/fail.
6. **No level skipping** — L_n requires L_{n-1} passed. If L2 fails, L3+ scores are informational only.
7. **L0 failure = invalid_run** — the entire report is marked invalid. Fix basics first.
8. **AUS requires same-run triple** — Raw30B, MA30B, MAClaude all run on same tasks same fixtures same session. No stale data mixing.
9. **L5 unlimited rounds** — max_rounds = reference × 5. Local advantage = "grind to victory." Don't cap it.
10. **Baseline refreshed quarterly** — models and code evolve. Stale baselines mislead.

---

## 12. Open Questions (For Leader)

1. **Judge model local-only?** If air-gapped requirement, judge must use local secondary model. Recommendation: allow Claude Sonnet — cost is low, accuracy is high.
2. **L5 human review?** L5 tasks are high-value, LLM judge may misjudge. Recommendation: L5 = LLM judge + human review dual track, quarterly spot-check.
3. **CI integration scope?** Full run = 100 tasks × 5 runs × ~2min = ~16 hours. Recommendation: PR → L0+L1 only (~30min), release → L0–L4 (~8hr overnight), manual → full + AUS.
4. **Multi-model baselines?** Besides Claude Code, also run GPT-4/Gemini? Recommendation: Claude Code only as north star first. Add competitors when competitive data is needed.
