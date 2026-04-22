#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { bootstrap, shutdown } from './index.js';
import type { BootstrapResult } from './index.js';

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

async function runChat(configPath?: string): Promise<void> {
  let boot: BootstrapResult;
  try {
    boot = await bootstrap(configPath);
  } catch (err) {
    console.error(color(C.red, `[error] ${(err as Error).message}`));
    process.exit(1);
  }

  const { config, configPath: resolved, connections, agent } = boot;

  console.log(color(C.bold, 'my-agent') + color(C.dim, ` v${VERSION}`));
  if (resolved) console.log(color(C.dim, `config: ${resolved}`));
  console.log(color(C.dim, `model:  ${config.model.model} @ ${config.model.baseURL}`));

  const serverSummary = connections
    .map((c) => `${c.name}(${c.tools.length})`)
    .join(', ') || '(none)';
  console.log(color(C.dim, `mcp:    ${serverSummary}`));
  console.log(color(C.dim, `commands: /quit /tools /clear`));
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

    try {
      process.stdout.write(C.green);
      let wrote = false;
      for await (const chunk of agent.chat(trimmed)) {
        process.stdout.write(chunk);
        wrote = true;
      }
      if (wrote) process.stdout.write('\n');
      process.stdout.write(C.reset);
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

main().catch((err) => {
  console.error(color(C.red, `[fatal] ${(err as Error).stack ?? (err as Error).message}`));
  process.exit(1);
});
