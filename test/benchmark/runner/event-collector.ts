import type { AgentEvent } from '../../../src/agent/events.js';
import type { RunTrace, ToolCallRecord } from './types.js';

const MAX_LOOP_ERROR_PATTERN = /max\s*loops?/i;
const RESULT_PREVIEW_MAX = 200;

function previewResult(content: string): string {
  if (typeof content !== 'string') return '';
  return content.length > RESULT_PREVIEW_MAX
    ? content.slice(0, RESULT_PREVIEW_MAX)
    : content;
}

export async function collectEvents(
  gen: AsyncGenerator<AgentEvent, void, unknown>,
  taskId: string,
  runIndex: number
): Promise<RunTrace> {
  const startedAt = Date.now();
  const events: AgentEvent[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const pending: Array<{ name: string; args: Record<string, unknown> }> = [];
  const textParts: string[] = [];

  let thinkingMs = 0;
  let hitMaxLoops = false;
  let aborted = false;
  let crashed = false;
  let crashReason: string | undefined;

  try {
    for await (const ev of gen) {
      events.push(ev);

      switch (ev.type) {
        case 'token':
          if (typeof ev.text === 'string') textParts.push(ev.text);
          break;

        case 'text':
          if (typeof ev.content === 'string') textParts.push(ev.content);
          break;

        case 'tool:call':
          pending.push({ name: ev.name, args: ev.args ?? {} });
          break;

        case 'tool:result': {
          const p = pending.shift();
          if (p) {
            toolCalls.push({
              name: p.name,
              args: p.args,
              ok: ev.ok,
              resultPreview: previewResult(ev.content),
            });
          } else {
            toolCalls.push({
              name: '<unknown>',
              args: {},
              ok: ev.ok,
              resultPreview: previewResult(ev.content),
            });
          }
          break;
        }

        case 'thinking:end':
          if (typeof ev.durationMs === 'number' && ev.durationMs > 0) {
            thinkingMs += ev.durationMs;
          }
          break;

        case 'task:failed':
          if (typeof ev.error === 'string' && MAX_LOOP_ERROR_PATTERN.test(ev.error)) {
            hitMaxLoops = true;
          }
          break;

        case 'task:aborted':
        case 'aborted':
          aborted = true;
          break;

        default:
          break;
      }
    }
  } catch (err) {
    crashed = true;
    crashReason = err instanceof Error ? err.message : String(err);
  }

  const finalText = textParts.join('');
  const apiCalls = events.filter(
    (e) => e.type === 'tool:call' || e.type === 'task:done'
  ).length;

  return {
    taskId,
    runIndex,
    events,
    toolCalls,
    finalText,
    messagesCount: events.length,
    thinkingMs,
    apiCalls,
    startedAt,
    elapsedMs: Date.now() - startedAt,
    hitMaxLoops,
    aborted,
    crashed,
    crashReason,
  };
}

export function mergeTraces(traces: RunTrace[]): RunTrace {
  if (traces.length === 0) {
    throw new Error('mergeTraces: cannot merge empty trace list');
  }
  if (traces.length === 1) return traces[0];

  const first = traces[0];
  const merged: RunTrace = {
    taskId: first.taskId,
    runIndex: first.runIndex,
    events: [],
    toolCalls: [],
    finalText: '',
    messagesCount: 0,
    thinkingMs: 0,
    apiCalls: 0,
    startedAt: first.startedAt,
    elapsedMs: 0,
    hitMaxLoops: false,
    aborted: false,
    crashed: false,
    crashReason: undefined,
  };

  const finalTextParts: string[] = [];
  const crashReasons: string[] = [];

  for (const t of traces) {
    merged.events.push(...t.events);
    merged.toolCalls.push(...t.toolCalls);
    if (t.finalText) finalTextParts.push(t.finalText);
    merged.messagesCount += t.messagesCount;
    merged.thinkingMs += t.thinkingMs;
    merged.apiCalls += t.apiCalls;
    merged.elapsedMs += t.elapsedMs;
    if (t.hitMaxLoops) merged.hitMaxLoops = true;
    if (t.aborted) merged.aborted = true;
    if (t.crashed) {
      merged.crashed = true;
      if (t.crashReason) crashReasons.push(t.crashReason);
    }
  }

  merged.finalText = finalTextParts.join('\n');
  if (crashReasons.length > 0) {
    merged.crashReason = crashReasons.join('; ');
  }

  return merged;
}
