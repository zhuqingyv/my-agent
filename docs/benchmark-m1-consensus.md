# Benchmark M1 — Implementation Consensus

> Merged from planner-a and planner-b after adversarial review. 12 binding decisions below.

## Scope

M1 = L0(10) + L1(30) + L2(30) = **70 YAML tasks** + runner + hard/soft assertions + 5-run median + ASCII/JSON report.

NOT in M1: LLM judge, AUS, Raw30B/MAClaude configs, 6-dimension scoring, trend tracking, L3–L5.

## 12 Binding Decisions

1. **Reuse**: `bootstrap/shutdown` from `src/index.ts` + `AgentEvent` types — direct import. Do NOT reuse `runAgent` from `agent-runner.ts` (finalText bug: only reads `text` events, misses `token` events which carry actual streaming content).
2. **Multi-turn unified**: task-runner internally does `bootstrap → loop chat(round) → shutdown`. Same code path for single-turn and multi-turn. No new helpers added to existing e2e.
3. **Event collection**: Standalone `event-collector.ts`. Collects from `token`+`text` dual source. Tracks `hitMaxLoops`, `aborted`, `thinkingMs`.
4. **Wave split**: Wave1 = 6 parallel modules (task-loader / fixture-manager / event-collector / hard / soft / reporter). Wave2 = scorer + task-runner (sequential). Wave3 = CLI entry.
5. **Module split**: `fixture-manager` is standalone. `median` logic is inlined in `scorer` (10 lines, not worth a file).
6. **Schema compat**: YAML uses snake_case → TS uses camelCase (loader does key conversion). Fields `dim_weights`, `llm_judge`, `reference_match_ratio`, `token_usage_max` are allowed in YAML but skipped at runtime (evalSoft returns null → excluded from denominator, no neutral-score pollution).
7. **runtime.layer**: M1 only supports `'L2'`.
8. **Retry semantics**: `tool_retry_max` counts same-key `ok=false` occurrences only (per `agent.ts:513` MAX_SAME_ERROR semantics). Successful calls with same args are NOT counted as retries.
9. **LevelScore.passRate**: Weighted by `TaskDef.weight`, not raw count.
10. **Runs**: Default 5. L0 tasks can use `runs: 1`.
11. **Exit codes**: 0=all gates pass / 1=gate fail / 2=L0 invalid / 99=runtime exception.
12. **Loader errors**: Aggregate all validation errors, print together, block execution but don't throw per-file.

## Module Map

```
test/benchmark/
├── tasks/L0/*.yaml (10)
├── tasks/L1/*.yaml (30)
├── tasks/L2/*.yaml (30)
├── fixtures/ (symlink simple-node-project + new multi-file/with-tests)
├── runner/
│   ├── types.ts              # All shared interfaces
│   ├── task-loader.ts        # YAML → TaskDef[] with validation
│   ├── fixture-manager.ts    # Copy fixture → tmp, run setup, return cwd+cleanup
│   ├── event-collector.ts    # AsyncGenerator<AgentEvent> → RunTrace
│   ├── assertions/hard.ts    # 12 hard assertion types
│   ├── assertions/soft.ts    # 3 soft types (len/count/duration)
│   ├── scorer.ts             # score(T) + median + score(L) + dual gate + total
│   ├── task-runner.ts        # bootstrap → chat → collect → assert → score → shutdown
│   ├── reporter.ts           # JSON + MD + ASCII dashboard
│   └── index.ts              # CLI entry + orchestration
├── reports/<runId>/          # gitignore
└── README.md
```

## Wave Assignment (for dev phase)

**Wave 1** (6 people parallel, no agent dependency):
- task-loader, fixture-manager, event-collector, hard-assertions, soft-assertions, reporter
- All work against `types.ts` contract only, testable with mock data

**Wave 2** (after Wave 1 merges):
- scorer (depends on hard/soft output types)
- task-runner (depends on all Wave 1 + scorer + bootstrap)

**Wave 3** (after Wave 2):
- index.ts CLI entry

**Wave 4** (parallel with all waves):
- 70 YAML task files + fixture directories

## Interface Contract

See `test/benchmark/runner/types.ts` (to be created as first step before Wave 1).

Key types: `TaskDef`, `RoundDef`, `HardAssertion` (12 variants), `SoftAssertion` (3+future), `RunTrace`, `ToolCallRecord`, `TaskScore`, `TaskResult`, `LevelScore`, `BenchmarkReport`, `RunOptions`.

## Agent Init Pattern (task-runner)

```ts
import { bootstrap, shutdown } from '../../../src/index.js';

// Per task per run: fresh agent, no cross-contamination
const { agent, connections } = await bootstrap(configPath);
process.chdir(fixtureCwd);
try {
  // Single-turn
  const gen = agent.chat(userInput, signal);
  const trace = await collectEvents(gen);
  // Multi-turn
  for (const round of task.rounds) {
    const gen = agent.chat(round.user, signal);
    const partialTrace = await collectEvents(gen);
    mergeTrace(trace, partialTrace);
  }
} finally {
  process.chdir(originalCwd);
  await shutdown(connections);
}
```

## Task Serial Constraint

M1 runs tasks **serially** (process.chdir is process-global). Total time ≈ 70×5×30s ≈ 3h. M2 can parallelize via child processes.
