#!/usr/bin/env tsx
/**
 * Benchmark CLI entry point.
 *
 * Usage:
 *   npm run benchmark                   # full run (L0+L1+L2)
 *   npm run benchmark -- --level L1     # single level
 *   npm run benchmark -- --task L1-005  # single task
 *   npm run benchmark -- --dry-run      # load + validate only
 */

import * as path from 'node:path';
import { loadTasks } from './task-loader.js';
import { runTask } from './task-runner.js';
import { scoreLevel, scoreBenchmark } from './scorer.js';
import { writeReport, formatDashboard } from './reporter.js';
import type { TaskDef, TaskResult, LevelScore, BenchmarkReport, Level } from './types.js';
import { LEVEL_ORDER, EXIT_OK, EXIT_GATE_FAIL, EXIT_L0_INVALID, EXIT_RUNTIME_ERROR } from './types.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const TASKS_DIR = path.join(ROOT, 'tasks');
const FIXTURES_DIR = path.join(ROOT, 'fixtures');
const E2E_FIXTURES_DIR = path.resolve(ROOT, '..', 'e2e', 'fixtures');
const REPORTS_DIR = path.join(ROOT, 'reports');

function parseArgs(argv: string[]): {
  level?: Level;
  task?: string;
  dryRun: boolean;
  configPath?: string;
} {
  let level: Level | undefined;
  let task: string | undefined;
  let dryRun = false;
  let configPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--level' && argv[i + 1]) {
      level = argv[++i] as Level;
    } else if (arg === '--task' && argv[i + 1]) {
      task = argv[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--config' && argv[i + 1]) {
      configPath = argv[++i];
    }
  }
  return { level, task, dryRun, configPath };
}

async function main() {
  const args = parseArgs(process.argv);

  // 1. Load tasks
  console.log(`Loading tasks from ${TASKS_DIR}...`);
  const { tasks, errors } = loadTasks({
    tasksDir: TASKS_DIR,
    fixturesDir: FIXTURES_DIR,
    e2eFixturesDir: E2E_FIXTURES_DIR,
    filterLevel: args.level,
    filterTask: args.task,
  });

  if (errors.length > 0) {
    console.error('\n❌ Task validation errors:\n');
    for (const e of errors) console.error(`  • ${e}`);
    process.exit(EXIT_L0_INVALID);
  }

  console.log(`Loaded ${tasks.length} tasks.`);
  if (args.dryRun) {
    console.log('Dry run — validation passed, no execution.');
    process.exit(EXIT_OK);
  }

  // 2. Group by level
  const byLevel = new Map<Level, TaskDef[]>();
  for (const t of tasks) {
    const arr = byLevel.get(t.level) || [];
    arr.push(t);
    byLevel.set(t.level, arr);
  }

  // L0 必须存在题目（除非用 --level/--task 过滤了特定级别）
  if (!byLevel.has('L0') && !args.level && !args.task) {
    console.error('\n❌ No L0 tasks found — L0 gate cannot be evaluated.');
    process.exit(EXIT_L0_INVALID);
  }

  // 3. Run tasks serially, level by level
  const allResults: TaskResult[] = [];
  const levelScores: LevelScore[] = [];
  const startedAt = Date.now();

  for (const level of LEVEL_ORDER) {
    const levelTasks = byLevel.get(level);
    if (!levelTasks || levelTasks.length === 0) continue;

    console.log(`\n── Running ${level} (${levelTasks.length} tasks) ──`);
    const results: TaskResult[] = [];
    const weights: Record<string, number> = {};

    for (let i = 0; i < levelTasks.length; i++) {
      const task = levelTasks[i];
      const progress = `[${i + 1}/${levelTasks.length}]`;
      process.stdout.write(`  ${progress} ${task.id} ${task.title}...`);

      try {
        const result = await runTask(task, { configPath: args.configPath });
        results.push(result);
        weights[task.id] = task.weight;
        const icon = result.passRate >= 0.5 ? '✓' : '✗';
        console.log(` ${icon} median=${result.median.toFixed(2)} stability=${result.stability.toFixed(2)}`);
      } catch (err: any) {
        console.log(` 💥 ${err.message}`);
        results.push({
          taskId: task.id,
          level: task.level,
          runs: [],
          median: 0,
          stability: 0,
          passRate: 0,
        });
        weights[task.id] = task.weight;
      }
    }

    const ls = scoreLevel(results, level, weights);
    levelScores.push(ls);
    allResults.push(...results);

    const icon = ls.gateOk ? '✓' : '✗';
    console.log(`  ${level} result: score=${ls.score.toFixed(3)} passRate=${ls.passRate.toFixed(3)} gate=${icon}`);

    // L0 failure = invalid run
    if (level === 'L0' && !ls.gateOk) {
      console.error('\n❌ L0 gate failed — invalid run. Fix basic connectivity first.');
      process.exit(EXIT_L0_INVALID);
    }
  }

  // 4. Score benchmark
  const { totalScore, level: finalLevel } = scoreBenchmark(levelScores);
  const elapsedMs = Date.now() - startedAt;

  // 5. Build report
  const weakest = allResults
    .filter(r => r.median < 0.7)
    .sort((a, b) => a.median - b.median)
    .slice(0, 5)
    .map(r => ({ taskId: r.taskId, median: r.median, reason: r.passRate === 0 ? 'never passed' : 'low score' }));

  const report: BenchmarkReport = {
    runId: new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6),
    config: { agent: 'MA', model: 'local', baseURL: 'http://localhost' },
    totalScore,
    level: finalLevel,
    byLevel: Object.fromEntries(levelScores.map(ls => [ls.level, ls])) as any,
    weakest,
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs,
  };

  // 6. Output
  console.log('\n' + formatDashboard(report));

  await writeReport(report, REPORTS_DIR);
  console.log(`\nReport written to ${REPORTS_DIR}/${report.runId}/`);

  // 7. Exit code
  const allGatesPass = levelScores.every(ls => ls.gateOk);
  process.exit(allGatesPass ? EXIT_OK : EXIT_GATE_FAIL);
}

main().catch((err) => {
  console.error('Benchmark runtime error:', err);
  process.exit(EXIT_RUNTIME_ERROR);
});
