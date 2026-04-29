/**
 * task-runner.ts — Wave 2 业务模块
 *
 * 把 Wave1 的独立模块串成完整一条 task 的执行链：
 *   bootstrap → chat (1 or N rounds) → collectEvents → (mergeTraces) →
 *   evaluateHard → evaluateSoft → scoreTask → shutdown → cleanup
 *
 * 按 `task.runtime.runs` 次重复执行后，取 median 得到 TaskResult。
 *
 * 关键约束（见 docs/benchmark-m1-consensus.md 第 1/2/10 条）：
 * - 每 run 重开 agent，避免跨 run 状态污染
 * - process.chdir 与 cleanup 用 try/finally 保证恢复
 * - bootstrap 失败 → 本次 run crashed=true, rawScore=0
 * - 多轮用 mergeTraces 聚合再打断言
 */

import { bootstrap, shutdown } from '../../../src/index.js';
import { prepareFixture } from './fixture-manager.js';
import { collectEvents, mergeTraces } from './event-collector.js';
import { evaluateHard } from './assertions/hard.js';
import { evaluateSoft } from './assertions/soft.js';
import type {
  TaskDef,
  TaskResult,
  TaskScore,
  RunTrace,
  HardAssertionResult,
  SoftResult,
} from './types.js';

export interface RunTaskOptions {
  configPath?: string;
}

/**
 * 执行一条 task，内部循环 runs 次取 median。
 *
 * @param task    — task-loader 产出的 TaskDef
 * @param options — { configPath?: string } 透传给 bootstrap
 * @returns TaskResult（包含每 run 的 TaskScore + median + stability + passRate）
 */
export async function runTask(
  task: TaskDef,
  options: RunTaskOptions = {}
): Promise<TaskResult> {
  const runs: TaskScore[] = [];
  const totalRuns = Math.max(1, task.runtime.runs);

  for (let i = 0; i < totalRuns; i++) {
    const score = await runSingle(task, i, options.configPath);
    runs.push(score);
  }

  const rawScores = runs.map((r) => r.rawScore);
  const median = computeMedian(rawScores);
  const stability = computeStability(rawScores);
  const passCount = runs.filter((r) => r.hardPass).length;
  const passRate = runs.length > 0 ? passCount / runs.length : 0;

  return {
    taskId: task.id,
    level: task.level,
    runs,
    median,
    stability,
    passRate,
  };
}

/**
 * 单次 run：bootstrap → chat → collect → assert → score → shutdown。
 * 任何阶段异常都被捕获并记为 crashed，保证上游循环继续。
 */
async function runSingle(
  task: TaskDef,
  runIndex: number,
  configPath?: string
): Promise<TaskScore> {
  const originalCwd = process.cwd();

  let prepared: { cwd: string; cleanup: () => Promise<void> } | null = null;
  let connections: Awaited<ReturnType<typeof bootstrap>>['connections'] | null = null;
  let chdirApplied = false;

  let trace: RunTrace = emptyTrace(task.id, runIndex);
  let hardResults: HardAssertionResult[] = [];
  let softResults: SoftResult[] = [];

  // timeout 用 AbortController 串起整次 run；触发时 trace.aborted=true
  const timeoutMs = Math.max(1, task.runtime.timeoutSec) * 1000;
  const abortCtl = new AbortController();
  const timer = setTimeout(() => abortCtl.abort(), timeoutMs);

  try {
    prepared = await prepareFixture(task.fixture);
    process.chdir(prepared.cwd);
    chdirApplied = true;

    const boot = await bootstrap(configPath);
    connections = boot.connections;
    const agent = boot.agent;

    if (task.rounds && task.rounds.length > 0) {
      // 多轮：逐轮采集 → mergeTraces
      const partials: RunTrace[] = [];
      for (const round of task.rounds) {
        if (abortCtl.signal.aborted) break;
        const gen = agent.chat(round.user, abortCtl.signal);
        const partial = await collectEvents(gen, task.id, runIndex);
        partials.push(partial);
      }
      trace = partials.length > 0 ? mergeTraces(partials) : emptyTrace(task.id, runIndex);
    } else if (task.userInput !== undefined) {
      // 单轮
      const gen = agent.chat(task.userInput, abortCtl.signal);
      trace = await collectEvents(gen, task.id, runIndex);
    } else {
      // task-loader 应该拦住，兜底：空 trace
      trace = emptyTrace(task.id, runIndex);
      trace.crashed = true;
      trace.crashReason = 'task has neither userInput nor rounds';
    }

    if (abortCtl.signal.aborted) {
      trace.aborted = true;
    }

    // 断言评估；cwd 仍在 fixture 目录，file_content/exit_code 才能拿到正确路径
    hardResults = evaluateHard(task.hardAssertions, trace, prepared.cwd);
    softResults = evaluateSoft(task.softAssertions, trace);
  } catch (err) {
    // bootstrap / fixture / chat 任何阶段挂了都进这里
    trace.crashed = true;
    trace.crashReason = err instanceof Error ? err.message : String(err);
    // 已经 prepare 了 fixture 就尝试用当前 trace 跑断言，没 prepare 就只能给空结果
    if (prepared) {
      try {
        hardResults = evaluateHard(task.hardAssertions, trace, prepared.cwd);
      } catch {
        hardResults = [];
      }
    }
    try {
      softResults = evaluateSoft(task.softAssertions, trace);
    } catch {
      softResults = [];
    }
  } finally {
    clearTimeout(timer);
    if (connections) {
      try {
        await shutdown(connections);
      } catch {
        /* ignore */
      }
    }
    if (chdirApplied) {
      try {
        process.chdir(originalCwd);
      } catch {
        /* ignore */
      }
    }
    if (prepared) {
      try {
        await prepared.cleanup();
      } catch {
        /* ignore */
      }
    }
  }

  return buildTaskScore(task.id, trace, hardResults, softResults);
}

/**
 * 组合 hard/soft 结果得到单次 run 的 TaskScore。
 * 公式（scorer 合入前内联）：hardPass ? 0.6 + 0.4*softScore : 0
 * crashed 视为 hardPass=false，rawScore 必 0。
 */
function buildTaskScore(
  taskId: string,
  trace: RunTrace,
  hardResults: HardAssertionResult[],
  softResults: SoftResult[]
): TaskScore {
  const crashedOrAborted = trace.crashed || trace.aborted;
  // 空 hardAssertions 时视为 pass；一旦任何 assertion 失败即整体 fail
  const hardPass =
    !crashedOrAborted && hardResults.every((r) => r.passed);

  const softScore = weightedSoftScore(softResults);
  const rawScore = hardPass ? 0.6 + 0.4 * softScore : 0;

  return {
    taskId,
    hardPass,
    softScore,
    rawScore,
    hardResults,
    softResults,
    trace,
  };
}

/**
 * 软断言加权平均；score=null 的（M1 未实现类型）从分母剔除，避免中性分污染。
 * 全为 null 或没有软断言时返回 1（当 hardPass 时给满的 soft 基线）。
 */
function weightedSoftScore(softResults: SoftResult[]): number {
  let num = 0;
  let den = 0;
  for (const r of softResults) {
    if (r.score === null) continue;
    const w = r.weight > 0 ? r.weight : 0;
    num += r.score * w;
    den += w;
  }
  if (den === 0) return 1;
  return num / den;
}

/**
 * 5 个 run 的 rawScore 取中位数。偶数个取中间两个平均。
 */
function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 稳定性 = 1 - 样本标准差（clamp 到 [0,1]）。
 * 单 run 时稳定性不可测，返回 1。
 */
function computeStability(values: number[]): number {
  if (values.length <= 1) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) /
    values.length;
  const stdev = Math.sqrt(variance);
  return Math.max(0, Math.min(1, 1 - stdev));
}

/**
 * crash 兜底用的空 trace。
 */
function emptyTrace(taskId: string, runIndex: number): RunTrace {
  return {
    taskId,
    runIndex,
    events: [],
    toolCalls: [],
    finalText: '',
    messagesCount: 0,
    thinkingMs: 0,
    apiCalls: 0,
    startedAt: Date.now(),
    elapsedMs: 0,
    hitMaxLoops: false,
    aborted: false,
    crashed: false,
  };
}
