#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { bootstrap, shutdown } from './index.js';
import type { BootstrapResult } from './index.js';
import type { Agent, McpConnection } from './mcp/types.js';
import type { Task } from './task-stack.js';

let activeConnections: McpConnection[] = [];

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function color(code: string, text: string): string {
  return `${code}${text}${C.reset}`;
}

const VERSION = '1.0.0';

function fmtTask(t: Task): string {
  return `${t.id}  ${t.prompt}`;
}

function printStack(agent: Agent): void {
  const stack = agent.getTaskStack();
  const current = stack.current();
  const pending = stack.pending();
  const recent = stack.history(5).slice().reverse();

  if (!current && pending.length === 0 && recent.length === 0) {
    console.log(color(C.dim, 'Task stack is empty'));
    return;
  }

  if (current) {
    console.log(color(C.bold, 'current:'));
    console.log('  ' + color(C.cyan, fmtTask(current)));
  }
  if (pending.length > 0) {
    console.log(color(C.bold, `pending (${pending.length}):`));
    for (let i = pending.length - 1; i >= 0; i--) {
      console.log('  ' + color(C.yellow, fmtTask(pending[i])));
    }
  }
  if (recent.length > 0) {
    console.log(color(C.bold, `completed (last ${recent.length}):`));
    for (const t of recent) {
      console.log('  ' + color(C.dim, fmtTask(t)));
    }
  }
}

async function runChat(configPath?: string): Promise<void> {
  let boot: BootstrapResult;
  try {
    boot = await bootstrap(configPath);
  } catch (err) {
    console.error(color(C.red, `[error] ${(err as Error).message}`));
    process.exit(1);
  }

  const { config, configPath: resolved, connections, agent } = boot;
  activeConnections = connections;

  console.log(color(C.bold, 'my-agent') + color(C.dim, ` v${VERSION}`));
  if (resolved) console.log(color(C.dim, `config: ${resolved}`));
  console.log(color(C.dim, `model:  ${config.model.model} @ ${config.model.baseURL}`));

  const serverSummary = connections
    .map((c) => `${c.name}(${c.tools.length})`)
    .join(', ') || '(none)';
  console.log(color(C.dim, `mcp:    ${serverSummary}`));
  console.log(color(C.dim, `commands: /quit /tools /clear /stack /abort /archive <id>`));
  console.log('');

  const rl = readline.createInterface({ input, output });

  let stopping = false;
  const cleanup = async (code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    rl.close();
    await shutdown(connections);
    process.exit(code);
  };

  const onSigint = (): void => {
    console.log('\n' + color(C.dim, '[interrupt] shutting down...'));
    void cleanup(0);
  };
  process.on('SIGINT', onSigint);

  while (!stopping) {
    let line: string;
    try {
      line = await rl.question(color(C.cyan, '> '));
    } catch {
      break;
    }
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === '/quit' || trimmed === '/exit') {
      break;
    }
    if (trimmed === '/tools') {
      for (const conn of connections) {
        console.log(color(C.bold, conn.name) + color(C.dim, `  (${conn.tools.length} tools)`));
        for (const t of conn.tools) {
          const desc = t.description ? ` — ${t.description}` : '';
          console.log(color(C.dim, `  - ${t.name}${desc}`));
        }
      }
      continue;
    }
    if (trimmed === '/clear') {
      agent.reset();
      console.log(color(C.dim, '[cleared]'));
      continue;
    }
    if (trimmed === '/stack') {
      printStack(agent);
      continue;
    }
    if (trimmed === '/abort') {
      const n = agent.abortAll();
      console.log(color(C.dim, `Aborted ${n} pending tasks`));
      continue;
    }
    if (trimmed.startsWith('/archive')) {
      const id = trimmed.slice('/archive'.length).trim();
      if (!id) {
        console.log(color(C.dim, 'usage: /archive <id>'));
        continue;
      }
      const archive = agent.getArchive(id);
      if (!archive) {
        console.log(color(C.dim, `No archive for task ${id}`));
      } else {
        console.log(color(C.bold, `archive ${id}`));
        console.log(JSON.stringify(archive, null, 2));
      }
      continue;
    }

    try {
      let wrote = false;
      let inTask = false;
      let wroteGreen = false;
      for await (const chunk of agent.chat(trimmed)) {
        if (chunk.startsWith('[task]')) {
          if (wroteGreen) {
            process.stdout.write(C.reset);
            wroteGreen = false;
          }
          const prefix = C.dim + (chunk.startsWith('[task] ✗') ? C.red : C.cyan);
          process.stdout.write(prefix + chunk + C.reset);
          inTask = true;
        } else {
          if (inTask || !wroteGreen) {
            process.stdout.write(C.green);
            wroteGreen = true;
            inTask = false;
          }
          process.stdout.write(chunk);
        }
        wrote = true;
      }
      if (wroteGreen) process.stdout.write(C.reset);
      if (wrote) process.stdout.write('\n');
    } catch (err) {
      process.stdout.write(C.reset);
      console.error(color(C.red, `[error] ${(err as Error).message}`));
    }
  }

  await cleanup(0);
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('my-agent').description('CLI agent with local model + MCP').version(VERSION);

  program
    .command('chat')
    .description('Start interactive chat session')
    .option('-c, --config <path>', 'path to config file')
    .action(async (opts: { config?: string }) => {
      await runChat(opts.config);
    });

  program
    .command('version')
    .description('Show version')
    .action(() => {
      console.log(VERSION);
    });

  if (process.argv.length <= 2) {
    await runChat();
    return;
  }

  await program.parseAsync(process.argv);
}

main().catch(async (err) => {
  console.error(color(C.red, `[fatal] ${(err as Error).stack ?? (err as Error).message}`));
  try {
    await shutdown(activeConnections);
  } catch {
    /* ignore shutdown errors during fatal cleanup */
  }
  process.exit(1);
});
