# Benchmark Results

These are early alpha benchmark results for MA running a local Qwen3-30B model through LM Studio.

The benchmark is intentionally small and reproducible rather than broad marketing fluff:

- **Model:** Qwen3-30B local model
- **Runtime:** LM Studio, OpenAI-compatible local endpoint
- **Agent:** MA
- **Task set:** 70 tasks total
  - L0 Connectivity: 10 tasks
  - L1 Stable Tools: 30 tasks
  - L2 Multi-turn: 30 tasks
- **Scoring:** hard assertions plus simple soft assertions
- **Gates:** L0 100%, L1 90%, L2 80%

## Public Summary

Latest repeated runs:

| Run | L0 Connectivity | L1 Stable Tools | L2 Multi-turn | Result |
| --- | ---: | ---: | ---: | --- |
| 2026-04-29 | 100% | 98.7% | 95.3% | Passed L0-L2 gates |
| 2026-04-30 | 100% | 98.7% | 95.3% | Passed L0-L2 gates |

Short claim for README/social posts:

> MA passed its L0-L2 internal benchmark with a local Qwen3-30B model: 100% L0, 98.7% L1, 95.3% L2 across 70 coding-agent tasks.

## What The Levels Mean

| Level | Meaning | Tasks |
| --- | --- | ---: |
| L0 | basic connectivity and simple tool use | 10 |
| L1 | stable file/search/shell tool use | 30 |
| L2 | multi-turn local project work | 30 |

This benchmark is not a universal coding-agent leaderboard. It is a regression gate for MA's local-agent loop: tool calls, file edits, command execution, context handling, and multi-turn recovery.

## Why This Matters

The point is not that a local 30B model beats frontier hosted models. The point is that MA can make a local 30B model useful enough for real project workflows by adding:

- stronger tool-call normalization
- retry and recovery around bad tool arguments
- file-edit tooling
- context preservation
- MCP tool routing
- local-model sampling controls

## Caveats

- Results are from an internal benchmark, not an independent third-party eval.
- L3+ complex-flow tasks are not part of this alpha claim.
- Local model quality varies by quantization, runtime, prompt template, and sampling config.
- The benchmark should be treated as a release gate and regression signal, not as a final product score.

## Reproduction

Run:

```bash
npm run benchmark
```

Or inspect the benchmark runner under:

```text
test/benchmark/
```
