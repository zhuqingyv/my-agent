import { useCallback, useRef } from 'react';
import type { Agent } from '../../mcp/types.js';
import type { AgentEvent } from '../../agent/events.js';
import type { UiStore } from '../state/store.js';

let msgCounter = 0;
function nextId() {
  return `m_${++msgCounter}`;
}

function applyEvent(store: UiStore, event: AgentEvent) {
  switch (event.type) {
    case 'task:start':
      store.updateThinking({ event: event.prompt.slice(0, 60) || '执行任务' });
      break;
    case 'tool:call':
      store.updateThinking({
        event: `调用 ${event.name.replace('__', ' → ')}`,
        toolName: event.name.replace('__', ' → '),
      });
      break;
    case 'tool:result': {
      const preview = event.content
        .replace(/<[^>]*>/g, '')
        .trim()
        .split('\n')[0]
        .slice(0, 50);
      store.pushMessage({
        kind: 'tool',
        id: nextId(),
        name: store.getState().thinking?.toolName || '',
        ok: event.ok,
        preview: preview || (event.ok ? '完成' : '失败'),
      });
      store.updateThinking({ event: event.ok ? '分析结果中' : '处理错误中' });
      break;
    }
    case 'token':
      store.appendToken(event.text);
      break;
    case 'text':
      store.appendToken(event.content);
      break;
    case 'task:done': {
      const md = store.flushInFlight();
      const elapsed = store.getState().thinking;
      const ms = elapsed ? Date.now() - elapsed.startedAt : 0;
      if (md.trim()) {
        store.pushMessage({
          kind: 'assistant',
          id: nextId(),
          markdown: md,
          elapsedMs: ms,
        });
      }
      const secs = Math.floor(ms / 1000);
      store.pushMessage({
        kind: 'separator',
        id: nextId(),
        elapsed: `${secs}s`,
      });
      break;
    }
    case 'task:failed': {
      const md = store.flushInFlight();
      if (md.trim()) {
        store.pushMessage({
          kind: 'assistant',
          id: nextId(),
          markdown: md,
          elapsedMs: 0,
        });
      }
      store.pushMessage({
        kind: 'system',
        id: nextId(),
        text: `[error] ${event.error}`,
      });
      store.pushMessage({ kind: 'separator', id: nextId(), elapsed: '0s' });
      break;
    }
    case 'task:aborted':
    case 'aborted':
      store.flushInFlight();
      store.pushMessage({ kind: 'system', id: nextId(), text: '[中断]' });
      break;
  }
}

export function useAgent(agent: Agent, store: UiStore) {
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      abortRef.current = new AbortController();
      store.pushMessage({ kind: 'user', id: nextId(), text });
      store.startThinking();

      try {
        for await (const event of agent.chat(text, abortRef.current.signal)) {
          applyEvent(store, event);
          if (abortRef.current.signal.aborted) break;
        }
      } catch (err: any) {
        if (err.name !== 'AbortError' && !abortRef.current?.signal.aborted) {
          store.pushMessage({
            kind: 'system',
            id: nextId(),
            text: `[error] ${err.message}`,
          });
        }
      } finally {
        store.stopThinking();
        abortRef.current = null;
      }
    },
    [agent, store]
  );

  const abort = useCallback(() => abortRef.current?.abort(), []);

  return { send, abort };
}
