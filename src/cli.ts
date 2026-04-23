#!/usr/bin/env node
import { Command } from 'commander';
import * as readline from 'node:readline/promises';
import * as readlineSync from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import { stdin as input, stdout as output } from 'node:process';

EventEmitter.defaultMaxListeners = 50;
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
import type { AgentEvent } from './agent/events.js';

marked.use(markedTerminal() as any);
readlineSync.emitKeypressEvents(process.stdin);

let activeConnections: McpConnection[] = [];
let activeThink: ThinkStream | null = null;
let debugMode = false;
let logStream: fs.WriteStream | null = null;

function debugLog(msg: string): void {
  if (!debugMode || !logStream) return;
  const ts = new Date().toISOString();
  logStream.write(`[${ts}] ${msg}\n`);
}

function debugEvent(event: AgentEvent): void {
  if (!debugMode) return;
  debugLog(`EVENT ${event.type} ${JSON.stringify(event)}`);
}

const VERSION = '1.0.0';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class ThinkStream {
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastEvent = '思考中';
  private lastToolName = '';
  private gotFinal = false;
  private isTTY = process.stdout.isTTY === true;
  private finalBuf = '';
  private startTime = 0;

  start(): void {
    this.frame = 0;
    this.lastEvent = '思考中';
    this.gotFinal = false;
    this.startTime = Date.now();
    if (!this.isTTY) return;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, 80);
  }

  private elapsed(): string {
    const s = Math.floor((Date.now() - this.startTime) / 1000);
    return `${s}s`;
  }

  private render(): void {
    if (this.gotFinal || !this.isTTY) return;
    const spin = pc.cyan(FRAMES[this.frame]);
    const sep = pc.dim('·');
    const event = pc.dim(this.lastEvent);
    const elapsed = pc.dim(this.elapsed());
    const hint = pc.dim('ESC 中断');
    logUpdate(`  ${spin} ${event}  ${sep}  ${elapsed}  ${sep}  ${hint}`);
  }

  getElapsed(): string {
    return this.elapsed();
  }

  push(event: AgentEvent): void {
    if (!this.isTTY) {
      if (event.type === 'token') process.stdout.write(event.text);
      else if (event.type === 'text') process.stdout.write(event.content);
      else if (event.type === 'tool:call') process.stdout.write(`[tool] ${event.name}\n`);
      else if (event.type === 'tool:result') process.stdout.write(`[tool:${event.ok ? 'ok' : 'err'}] ${event.content.split('\n')[0].slice(0, 80)}\n`);
      return;
    }

    switch (event.type) {
      case 'task:start':
        this.lastEvent = event.prompt.slice(0, 60) || '执行任务';
        break;
      case 'task:done':
        this.persist('\n' + pc.green(figures.tick) + ' ' + pc.dim('任务完成'));
        break;
      case 'task:failed':
        this.persist(pc.red(figures.cross) + ' ' + pc.dim(event.error.slice(0, 50) || '任务失败'));
        break;
      case 'task:aborted':
      case 'aborted':
        this.persist(pc.yellow(figures.warning + ' 已中断'));
        break;
      case 'tool:call':
        this.lastToolName = event.name.replace('__', ' → ');
        this.lastEvent = `调用 ${this.lastToolName}`;
        break;
      case 'tool:result':
        if (event.ok) {
          this.persist('  ' + pc.dim(pc.green('✓')) + ' ' + pc.dim(pc.green(this.lastToolName || '完成')));
          this.lastEvent = '分析结果中';
        } else {
          const preview = event.content.replace(/<[^>]*>/g, '').trim().split('\n')[0].slice(0, 50);
          this.persist('  ' + pc.dim(pc.red('✗')) + ' ' + pc.dim(pc.red(preview || '失败')));
          this.lastEvent = '处理错误中';
        }
        break;
      case 'token':
        this.onFinal(event.text);
        break;
      case 'text':
        this.onFinal(event.content);
        break;
    }
  }

  private inCodeBlock = false;
  private lineBuf = '';
  private lastLineEmpty = false;

  private onFinal(chunk: string): void {
    if (!this.gotFinal) {
      this.gotFinal = true;
      this.stopTimer();
      logUpdate.clear();
      process.stdout.write('\n\n');
    }
    this.finalBuf += chunk;

    this.lineBuf += chunk;
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() ?? '';

    for (const line of lines) {
      const isEmpty = line.trim() === '';
      if (isEmpty && this.lastLineEmpty && !this.inCodeBlock) continue;
      this.lastLineEmpty = isEmpty;
      process.stdout.write(this.formatLine(line) + '\n');
    }
  }

  flushLine(): void {
    if (this.lineBuf) {
      process.stdout.write(this.formatLine(this.lineBuf));
      this.lineBuf = '';
    }
  }

  private formatLine(line: string): string {
    if (line.startsWith('```')) {
      this.inCodeBlock = !this.inCodeBlock;
      return pc.dim('  ' + line);
    }
    if (this.inCodeBlock) {
      return pc.cyan('  ' + line);
    }
    if (/^#{1,6}\s/.test(line)) {
      return '\n' + pc.bold(line.replace(/^#+\s*/, ''));
    }
    if (/^-{3,}$|^\*{3,}$|^_{3,}$/.test(line.trim())) {
      const cols = Math.min(process.stdout.columns || 80, 60);
      return pc.dim('─'.repeat(cols));
    }
    if (/^\|[-:| ]+\|$/.test(line.trim())) {
      return pc.dim('─'.repeat(Math.min(line.length, 60)));
    }
    if (/^\|/.test(line.trim())) {
      const cells = line.split('|').filter(c => c.trim());
      let out = cells.map(c => {
        let cell = c.trim();
        cell = cell.replace(/\*\*(.+?)\*\*/g, (_, t) => pc.bold(t));
        cell = cell.replace(/`([^`]+)`/g, (_, t) => pc.cyan(t));
        return cell;
      }).join(pc.dim('  │  '));
      return pc.dim('│  ') + out + pc.dim('  │');
    }
    if (/^\s*[-*]\s/.test(line)) {
      let out = line.replace(/^(\s*)[-*]\s/, '$1• ');
      out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => pc.bold(t));
      out = out.replace(/`([^`]+)`/g, (_, t) => pc.cyan(t));
      return out;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      let out = line;
      out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => pc.bold(t));
      out = out.replace(/`([^`]+)`/g, (_, t) => pc.cyan(t));
      return out;
    }
    let out = line;
    out = out.replace(/\*\*(.+?)\*\*/g, (_, t) => pc.bold(t));
    out = out.replace(/`([^`]+)`/g, (_, t) => pc.cyan(t));
    return out;
  }

  private persist(line: string): void {
    logUpdate.clear();
    if (this.gotFinal && this.lineBuf) {
      process.stdout.write(this.formatLine(this.lineBuf) + '\n');
      this.lineBuf = '';
    }
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

interface CliCommandContext {
  agent: Agent;
  connections: McpConnection[];
  rl: readline.Interface;
}

interface CliCommand {
  description: string;
  handler: (args: string, ctx: CliCommandContext) => Promise<void> | void;
}

const commands = new Map<string, CliCommand>();

commands.set('/tools', {
  description: 'List available tools',
  handler: (_args, ctx) => {
    for (const conn of ctx.connections) {
      console.log(pc.bold(conn.name) + pc.dim(`  (${conn.tools.length} tools)`));
      for (const t of conn.tools) {
        const desc = t.description ? ` — ${t.description}` : '';
        console.log(pc.dim(`  - ${t.name}${desc}`));
      }
    }
  },
});

commands.set('/clear', {
  description: 'Clear conversation',
  handler: (_args, ctx) => {
    ctx.agent.reset();
    console.log(pc.dim('[cleared]'));
  },
});

commands.set('/stack', {
  description: 'Show task stack',
  handler: (_args, ctx) => printStack(ctx.agent),
});

commands.set('/abort', {
  description: 'Clear pending tasks',
  handler: (_args, ctx) => {
    const n = ctx.agent.abortAll();
    console.log(pc.dim(`Aborted ${n} pending tasks`));
  },
});

commands.set('/archive', {
  description: 'Show task archive',
  handler: (args, ctx) => {
    const id = args.trim();
    if (!id) {
      console.log(pc.dim('usage: /archive <id>'));
      return;
    }
    const archive = ctx.agent.getArchive(id);
    if (!archive) {
      console.log(pc.dim(`No archive for task ${id}`));
    } else {
      console.log(pc.bold(`archive ${id}`));
      console.log(JSON.stringify(archive, null, 2));
    }
  },
});

async function runChat(configPath?: string): Promise<void> {
  let boot: BootstrapResult;
  try {
    boot = await bootstrap(configPath);
  } catch (err) {
    console.error(pc.red(`[error] ${(err as Error).message}`));
    process.exit(1);
  }

  const { config, createdDefault, connections, agent } = boot;
  activeConnections = connections;

  if (createdDefault) {
    console.log(pc.yellow(`Created ~/.my-agent/config.json — edit model settings there.`));
  }

  const titlePlain = `my-agent  v${VERSION}`;
  const innerWidth = Math.max(titlePlain.length + 4, 25);
  const pad = ' '.repeat(innerWidth - titlePlain.length - 2);
  console.log('  ' + pc.cyan('╭' + '─'.repeat(innerWidth) + '╮'));
  console.log('  ' + pc.cyan('│') + '  ' + pc.bold(pc.cyan('my-agent')) + '  ' + pc.dim(`v${VERSION}`) + pad + pc.cyan('│'));
  console.log('  ' + pc.cyan('╰' + '─'.repeat(innerWidth) + '╯'));

  console.log('  ' + pc.dim('model:') + '  ' + pc.bold(config.model.model) + '  ' + pc.dim(config.model.baseURL));

  const serverSummary = connections
    .map((c) => `${c.name}(${pc.green(String(c.tools.length))})`)
    .join(', ') || pc.dim('(none)');
  console.log('  ' + pc.dim('mcp:') + '    ' + serverSummary);
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

    const spaceIdx = trimmed.indexOf(' ');
    const cmdName = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const cmdArgs = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';

    if (cmdName === '/quit' || cmdName === '/exit') break;
    const cmd = commands.get(cmdName);
    if (cmd) {
      await cmd.handler(cmdArgs, { agent, connections, rl });
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
      debugLog(`USER: ${trimmed}`);
      for await (const chunk of agent.chat(trimmed, controller.signal)) {
        debugEvent(chunk);
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
    activeThink = null;
    if (think.hasFinal()) {
      think.flushLine();
      process.stdout.write('\n');
    }
    process.stdout.write('\n' + pc.dim(`✱ 完成 (${think.getElapsed()})`) + '\n');
    process.stdout.write('\n' + pc.dim('─'.repeat(Math.min(process.stdout.columns || 80, 80))) + '\n\n\n');
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
    .command('dev')
    .description('Start chat with debug logging to ~/.my-agent/debug.log')
    .option('-c, --config <path>', 'path to config file')
    .action(async (opts: { config?: string }) => {
      debugMode = true;
      const logDir = path.join(os.homedir(), '.my-agent');
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = path.join(logDir, 'debug.log');
      logStream = fs.createWriteStream(logPath, { flags: 'a' });
      debugLog('=== session start ===');
      console.log(pc.yellow(`${figures.warning} debug mode — logging to ~/.my-agent/debug.log`));
      await runChat(opts.config);
      debugLog('=== session end ===');
      logStream.end();
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

  program.action(async () => {
    await runChat();
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
