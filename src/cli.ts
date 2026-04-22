#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import * as readlineSync from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import pc from 'picocolors';
import figures from 'figures';
import logUpdate from 'log-update';
import { marked } from 'marked';
// @ts-ignore - marked-terminal ships without bundled types
import { markedTerminal } from 'marked-terminal';
import { bootstrap, shutdown } from './index.js';
import { writeGlobalConfig } from './config.js';
import type { BootstrapResult } from './index.js';
import type { Agent, McpConnection } from './mcp/types.js';
import type { Task } from './task-stack.js';

marked.use(markedTerminal() as any);
readlineSync.emitKeypressEvents(process.stdin);

let activeConnections: McpConnection[] = [];
let activeThink: ThinkStream | null = null;

const VERSION = '1.0.0';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class ThinkStream {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastEvent = '思考中';
  private gotFinal = false;
  private isTTY = process.stdout.isTTY === true;
  private finalBuf = '';

  start(): void {
    this.frame = 0;
    this.lastEvent = '思考中';
    this.gotFinal = false;
    if (!this.isTTY) return;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, 80);
  }

  private render(): void {
    if (this.gotFinal || !this.isTTY) return;
    const spin = pc.cyan(FRAMES[this.frame]);
    logUpdate(`${spin} ${pc.dim(this.lastEvent)}`);
  }

  push(chunk: string): void {
    if (!this.isTTY) {
      process.stdout.write(chunk);
      return;
    }

    const check = chunk.trimStart();

    if (check.startsWith('[task]')) {
      const t = chunk.trim();
      if (t) this.onTask(t);
    } else if (
      check.startsWith('[tool:ok]') ||
      check.startsWith('[tool:err]')
    ) {
      const t = chunk.trim();
      if (t) this.onToolEnd(t);
    } else if (check.startsWith('[tool]')) {
      const t = chunk.trim();
      if (t) this.onToolStart(t);
    } else if (check.startsWith('[aborted]')) {
      this.persist(pc.yellow('[aborted]'));
    } else {
      this.onFinal(chunk);
    }
  }

  private onTask(c: string): void {
    if (c.includes('✓') || /\bok\b/.test(c)) {
      this.persist(pc.green(figures.tick) + ' ' + pc.dim('任务完成'));
    } else if (c.includes('✗') || c.includes('x [')) {
      this.persist(pc.red(figures.cross) + ' ' + pc.dim('任务失败'));
    } else if (c.includes('→')) {
      const prompt = c.replace(/\[task\]\s*→\s*(\[[^\]]*\]\s*)?/, '').trim();
      this.lastEvent = prompt.slice(0, 60) || '执行任务';
    }
  }

  private onToolStart(c: string): void {
    const match = c.match(/\[tool\]\s+(\S+)/);
    if (match) {
      const name = match[1].replace('__', ' → ');
      this.lastEvent = `调用 ${name}`;
    }
  }

  private onToolEnd(c: string): void {
    const ok = c.startsWith('[tool:ok]');
    if (ok) {
      this.lastEvent = '分析结果中';
    } else {
      const content = c.replace(/\[tool:(ok|err)\]\s*/, '').trim();
      const preview = content.split('\n')[0].slice(0, 50);
      this.persist(pc.red(figures.cross) + ' ' + pc.dim(preview || '失败'));
      this.lastEvent = '处理错误中';
    }
  }

  private onFinal(chunk: string): void {
    if (!this.gotFinal) {
      this.gotFinal = true;
      this.stopTimer();
      logUpdate.clear();
      process.stdout.write('\n');
    }
    this.finalBuf += chunk;
    process.stdout.write(pc.green(chunk));
  }

  renderMarkdown(): void {
    if (!this.finalBuf.trim() || !this.isTTY) return;

    const hasMd = /```|^#{1,6}\s|\*\*|^\s*[-*]\s/m.test(this.finalBuf);
    if (!hasMd) return;

    try {
      const totalLines = this.finalBuf.split('\n').length;
      process.stdout.write(`\x1b[${totalLines}A\x1b[0J`);

      const rendered = marked.parse(this.finalBuf) as string;
      process.stdout.write(rendered);
    } catch {
      /* 渲染失败则保留直出内容 */
    }
  }

  private persist(line: string): void {
    logUpdate.clear();
    console.log(line);
    if (!this.gotFinal) this.render();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.stopTimer();
    if (!this.isTTY) return;
    if (!this.gotFinal) {
      logUpdate.clear();
    }
    logUpdate.done();
  }

  hasFinal(): boolean {
    return this.gotFinal;
  }
}

function fmtTask(t: Task): string {
  return `${t.id}  ${t.prompt}`;
}

function printStack(agent: Agent): void {
  const stack = agent.getTaskStack();
  const current = stack.current();
  const pending = stack.pending();
  const recent = stack.history(5).slice().reverse();

  if (!current && pending.length === 0 && recent.length === 0) {
    console.log(pc.dim('Task stack is empty'));
    return;
  }

  if (current) {
    console.log(pc.bold('current:'));
    console.log('  ' + pc.cyan(fmtTask(current)));
  }
  if (pending.length > 0) {
    console.log(pc.bold(`pending (${pending.length}):`));
    for (let i = pending.length - 1; i >= 0; i--) {
      console.log('  ' + pc.yellow(fmtTask(pending[i])));
    }
  }
  if (recent.length > 0) {
    console.log(pc.bold(`completed (last ${recent.length}):`));
    for (const t of recent) {
      console.log('  ' + pc.dim(fmtTask(t)));
    }
  }
}

async function runChat(configPath?: string): Promise<void> {
  let boot: BootstrapResult;
  try {
    boot = await bootstrap(configPath);
  } catch (err) {
    console.error(pc.red(`[error] ${(err as Error).message}`));
    process.exit(1);
  }

  const { config, configSources, createdDefault, connections, agent } = boot;
  activeConnections = connections;

  if (createdDefault) {
    console.log(pc.yellow(`Created ~/.my-agent/config.json — edit model settings there.`));
  }

  console.log(pc.bold('my-agent') + pc.dim(` v${VERSION}`));
  const home = process.env.HOME ?? '';
  const pretty = configSources.map((s) => (home && s.startsWith(home) ? '~' + s.slice(home.length) : s));
  if (pretty.length > 0) {
    console.log(pc.dim(`config: ${pretty.join(' + ')}`));
  } else {
    console.log(pc.dim(`config: (defaults)`));
  }
  console.log(pc.dim(`model:  ${config.model.model} @ ${config.model.baseURL}`));

  const serverSummary = connections
    .map((c) => `${c.name}(${c.tools.length})`)
    .join(', ') || '(none)';
  console.log(pc.dim(`mcp:    ${serverSummary}`));
  console.log(pc.dim(`commands: /quit /tools /clear /stack /abort /archive <id>`));
  console.log('');

  const rl = readline.createInterface({ input, output });

  let stopping = false;
  const cleanup = async (code = 0): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (activeThink) {
      activeThink.stop();
      activeThink = null;
    }
    rl.close();
    await shutdown(connections);
    process.exit(code);
  };

  const onSigint = (): void => {
    if (activeThink) {
      activeThink.stop();
      activeThink = null;
    }
    console.log('\n' + pc.dim('[interrupt] shutting down...'));
    void cleanup(0);
  };
  process.on('SIGINT', onSigint);

  while (!stopping) {
    let line: string;
    try {
      line = await rl.question(pc.cyan(`${figures.pointer} `));
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
        console.log(pc.bold(conn.name) + pc.dim(`  (${conn.tools.length} tools)`));
        for (const t of conn.tools) {
          const desc = t.description ? ` — ${t.description}` : '';
          console.log(pc.dim(`  - ${t.name}${desc}`));
        }
      }
      continue;
    }
    if (trimmed === '/clear') {
      agent.reset();
      console.log(pc.dim('[cleared]'));
      continue;
    }
    if (trimmed === '/stack') {
      printStack(agent);
      continue;
    }
    if (trimmed === '/abort') {
      const n = agent.abortAll();
      console.log(pc.dim(`Aborted ${n} pending tasks`));
      continue;
    }
    if (trimmed.startsWith('/archive')) {
      const id = trimmed.slice('/archive'.length).trim();
      if (!id) {
        console.log(pc.dim('usage: /archive <id>'));
        continue;
      }
      const archive = agent.getArchive(id);
      if (!archive) {
        console.log(pc.dim(`No archive for task ${id}`));
      } else {
        console.log(pc.bold(`archive ${id}`));
        console.log(JSON.stringify(archive, null, 2));
      }
      continue;
    }

    const think = new ThinkStream();
    activeThink = think;
    think.start();

    const controller = new AbortController();
    const rawWasOn = process.stdin.isTTY ? process.stdin.isRaw === true : false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    const onKeypress = (_: string, key: any): void => {
      if (key?.name === 'escape' && !controller.signal.aborted) {
        controller.abort();
      }
      if (key?.ctrl && key?.name === 'c') {
        process.emit('SIGINT');
      }
    };
    process.stdin.on('keypress', onKeypress);
    process.stdin.resume();

    try {
      for await (const chunk of agent.chat(trimmed, controller.signal)) {
        think.push(chunk);
        if (controller.signal.aborted) break;
      }
    } catch (err) {
      const name = (err as Error).name;
      if (name !== 'AbortError' && !controller.signal.aborted) {
        think.stop();
        process.stdin.off('keypress', onKeypress);
        if (process.stdin.isTTY) process.stdin.setRawMode(rawWasOn);
        activeThink = null;
        console.error(pc.red(`[error] ${(err as Error).message}`));
        continue;
      }
    } finally {
      process.stdin.off('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(rawWasOn);
      }
    }
    think.stop();
    think.renderMarkdown();
    activeThink = null;
    if (think.hasFinal()) process.stdout.write('\n');
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

  if (process.argv.length <= 2) {
    await runChat();
    return;
  }

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
