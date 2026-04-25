#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import pc from 'picocolors';
import figures from 'figures';
import { bootstrap, shutdown } from '../index.js';
import { writeGlobalConfig } from '../config.js';
import { createSessionStore } from '../session/store.js';
import type { BootstrapResult } from '../index.js';
import type { McpConnection } from '../mcp/types.js';
import { App } from './App.js';

const VERSION = '1.0.0';

let activeConnections: McpConnection[] = [];

function parseResume(raw: string | boolean | undefined): string | true | undefined {
  if (raw === undefined) return undefined;
  if (raw === true || raw === '') return true;
  if (typeof raw === 'string') return raw;
  return true;
}

interface RunChatOptions {
  debug: boolean;
  resume?: string | true;
}

async function runChat(configPath: string | undefined, runOpts: RunChatOptions): Promise<void> {
  const { debug, resume } = runOpts;
  if (debug) {
    const logDir = path.join(os.homedir(), '.my-agent');
    fs.mkdirSync(logDir, { recursive: true });
    console.log(pc.yellow(`${figures.warning} debug mode — logging to ~/.my-agent/debug.log`));
  }

  let boot: BootstrapResult;
  try {
    boot = await bootstrap(configPath, { resume });
  } catch (err) {
    console.error(pc.red(`[error] ${(err as Error).message}`));
    process.exit(1);
  }

  const { config, createdDefault, connections, agent, sessionId, resumed } = boot;
  activeConnections = connections;

  if (createdDefault) {
    console.log(pc.yellow(`Created ~/.my-agent/config.json — edit model settings there.`));
  }
  if (resumed) {
    console.log(pc.dim(`resumed session ${sessionId}`));
  } else {
    console.log(pc.dim(`session ${sessionId}`));
  }

  const { waitUntilExit } = render(
    <App config={config} connections={connections} agent={agent} debug={debug} />,
  );

  const onSigint = (): void => {
    void (async () => {
      await shutdown(connections);
      process.exit(0);
    })();
  };
  process.on('SIGINT', onSigint);

  try {
    await waitUntilExit();
  } finally {
    process.off('SIGINT', onSigint);
    await shutdown(connections);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('my-agent').description('CLI agent with local model + MCP').version(VERSION);

  program
    .command('chat')
    .description('Start interactive chat session')
    .option('-c, --config <path>', 'path to config file')
    .option('--resume [id]', 'resume a saved session (empty = latest)')
    .action(async (opts: { config?: string; resume?: string | boolean }) => {
      const resume = parseResume(opts.resume);
      await runChat(opts.config, { debug: false, resume });
    });

  program
    .command('dev')
    .description('Start chat with debug logging to ~/.my-agent/debug.log')
    .option('-c, --config <path>', 'path to config file')
    .option('--resume [id]', 'resume a saved session (empty = latest)')
    .action(async (opts: { config?: string; resume?: string | boolean }) => {
      const resume = parseResume(opts.resume);
      await runChat(opts.config, { debug: true, resume });
    });

  program
    .command('sessions')
    .description('List saved sessions')
    .option('--prune', 'delete old sessions, keeping the most recent 20')
    .action((opts: { prune?: boolean }) => {
      const store = createSessionStore();
      if (opts.prune) {
        const removed = store.prune(20);
        console.log(pc.green(`${figures.tick} pruned ${removed} session(s)`));
        return;
      }
      const list = store.list(10);
      if (list.length === 0) {
        console.log(pc.dim('no sessions'));
        return;
      }
      for (const m of list) {
        const when = new Date(m.createdAt).toISOString().replace('T', ' ').slice(0, 19);
        console.log(
          `${pc.cyan(m.id)}  ${pc.dim(when)}  ${pc.dim(m.model)}  ${pc.dim(`${m.messageCount} msg`)}  ${m.cwd}`
        );
      }
    });

  program
    .command('init')
    .description('Initialize global config with model settings')
    .argument('<baseURL>', 'Model API base URL (e.g. http://localhost:1234/v1)')
    .argument('<model>', 'Model name (e.g. qwen3-30b-a3b)')
    .argument('[apiKey]', 'API key (default: lm-studio)', 'lm-studio')
    .action((baseURL: string, model: string, apiKey: string) => {
      writeGlobalConfig({ baseURL, model, apiKey });
      console.log(pc.green(`${figures.tick} Saved to ~/.my-agent/config.json`));
      console.log(pc.dim(`  baseURL: ${baseURL}`));
      console.log(pc.dim(`  model:   ${model}`));
      console.log(pc.dim(`  apiKey:  ${apiKey}`));
    });

  program
    .command('version')
    .description('Show version')
    .action(() => {
      console.log(VERSION);
    });

  program
    .option('--resume [id]', 'resume a saved session (empty = latest)')
    .action(async (opts: { resume?: string | boolean }) => {
      const resume = parseResume(opts.resume);
      await runChat(undefined, { debug: false, resume });
    });

  await program.parseAsync(process.argv);
}

main().catch(async (err) => {
  console.error(pc.red(`[fatal] ${(err as Error).stack ?? (err as Error).message}`));
  try {
    await shutdown(activeConnections);
  } catch {
    /* ignore shutdown errors during fatal cleanup */
  }
  process.exit(1);
});
