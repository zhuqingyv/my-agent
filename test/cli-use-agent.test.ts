import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentEvent } from '../src/cli/hooks/useAgent.js';
import { createUiStore } from '../src/cli/state/store.js';

test('applyAgentEvent: renders plan content and hides successful enter_plan_mode result', () => {
  const store = createUiStore();
  store.startThinking();

  applyAgentEvent(
    store,
    { type: 'tool:call', name: 'enter_plan_mode', args: { plan: 'hidden' } },
    {}
  );
  applyAgentEvent(
    store,
    { type: 'plan', content: '## 技术方案\n\n1. 先读代码\n2. 再实现' },
    {}
  );
  applyAgentEvent(
    store,
    {
      type: 'tool:result',
      ok: true,
      content: '[plan]\n## 技术方案\n[/plan]\n\n等待用户确认...',
    },
    {}
  );

  const state = store.getState();
  const assistant = state.messages.filter((m) => m.kind === 'assistant');
  const tools = state.messages.filter((m) => m.kind === 'tool');

  assert.equal(assistant.length, 1);
  assert.equal(assistant[0].markdown, '## 技术方案\n\n1. 先读代码\n2. 再实现');
  assert.equal(tools.length, 0);
  assert.equal(state.thinking?.event, '等待方案确认');
});
