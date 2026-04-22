import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { TaskStack } from '../task-stack.js';

export const STACK_STATE_PREFIX = '\n--- STACK_STATE ---\n';

export function renderStackState(stack: TaskStack): string {
  const cur = stack.current();
  const pending = stack.pending();

  if (!cur && pending.length === 0) return '';

  const lines: string[] = [
    '<stack_state note="内部状态，禁止向用户输出">',
  ];
  lines.push(
    cur ? `Current task: ${cur.prompt}` : 'Current task: (none)'
  );

  if (pending.length === 0) {
    lines.push('Pending tasks: (none)');
  } else {
    lines.push('Pending tasks (top first):');
    const topFirst = pending.slice().reverse();
    topFirst.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.prompt}`);
    });
    lines.push('Rules:');
    lines.push('  - 需要拆分才调 create_task，不要重复已在栈里的。');
  }

  lines.push('</stack_state>');
  return STACK_STATE_PREFIX + lines.join('\n');
}

export function removeLastStackStateMessage(
  messages: ChatCompletionMessageParam[]
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === 'system' &&
      typeof m.content === 'string' &&
      m.content.startsWith(STACK_STATE_PREFIX)
    ) {
      messages.splice(i, 1);
      return;
    }
  }
}
