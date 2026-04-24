import type { Agent, McpConnection } from '../../mcp/types.js';

interface CommandContext {
  agent: Agent;
  connections: McpConnection[];
  exit: () => void;
}

interface Command {
  description: string;
  handler: (args: string, ctx: CommandContext) => string | null;
}

const commands = new Map<string, Command>();

commands.set('/quit', {
  description: 'Exit',
  handler: (_, ctx) => {
    ctx.exit();
    return null;
  },
});

commands.set('/exit', {
  description: 'Exit',
  handler: (_, ctx) => {
    ctx.exit();
    return null;
  },
});

commands.set('/tools', {
  description: 'List tools',
  handler: (_, ctx) => {
    return ctx.connections
      .map(
        (c) =>
          `${c.name} (${c.tools.length} tools)\n${c.tools
            .map((t) => `  - ${t.name}${t.description ? ': ' + t.description : ''}`)
            .join('\n')}`
      )
      .join('\n\n');
  },
});

commands.set('/stack', {
  description: 'Show task stack',
  handler: (_, ctx) => {
    const stack = ctx.agent.getTaskStack();
    const cur = stack.current();
    const pending = stack.pending();
    const history = stack.history(5);
    if (!cur && pending.length === 0 && history.length === 0) return 'Task stack is empty';
    let out = '';
    if (cur) out += `current: ${cur.id} ${cur.prompt}\n`;
    if (pending.length > 0)
      out += `pending (${pending.length}):\n${pending
        .reverse()
        .map((t) => `  ${t.id} ${t.prompt}`)
        .join('\n')}\n`;
    if (history.length > 0)
      out += `completed:\n${history
        .reverse()
        .map((t) => `  ${t.id} ${t.prompt}`)
        .join('\n')}`;
    return out.trim();
  },
});

commands.set('/abort', {
  description: 'Clear pending tasks',
  handler: (_, ctx) => {
    const n = ctx.agent.abortAll();
    return `Aborted ${n} pending tasks`;
  },
});

commands.set('/archive', {
  description: 'Show task archive',
  handler: (args, ctx) => {
    const id = args.trim();
    if (!id) return 'usage: /archive <id>';
    const archive = ctx.agent.getArchive(id);
    if (!archive) return `No archive for task ${id}`;
    return JSON.stringify(archive, null, 2);
  },
});

commands.set('/clear', {
  description: 'Clear conversation',
  handler: (_, ctx) => {
    ctx.agent.reset();
    return '[cleared]';
  },
});

export function isCommand(input: string): boolean {
  return input.startsWith('/');
}

export function executeCommand(input: string, ctx: CommandContext): string | null {
  const spaceIdx = input.indexOf(' ');
  const name = spaceIdx > 0 ? input.slice(0, spaceIdx) : input;
  const args = spaceIdx > 0 ? input.slice(spaceIdx + 1) : '';
  const cmd = commands.get(name);
  if (!cmd) return `Unknown command: ${name}`;
  return cmd.handler(args, ctx);
}

export { commands };
