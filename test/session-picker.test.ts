import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSessionLabel,
  getSessionUserPreview,
  selectProjectSessions,
  type SessionPickerSession,
} from '../src/cli/components/SessionPicker.js';
import type { SessionMeta } from '../src/session/store.js';

test('session picker: formats user message as the row label', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const session: SessionPickerSession = {
    id: 's_1234_abcd',
    createdAt: now - 2 * 60 * 60 * 1000,
    cwd: '/tmp/project',
    model: 'qwen',
    messageCount: 7,
    preview: '帮我修复登录流程',
  };

  assert.equal(
    formatSessionLabel(session, now),
    '帮我修复登录流程  ·  2小时前'
  );
});

test('session picker: extracts the latest real user message for preview', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(
    getSessionUserPreview([
      { role: 'user', content: '第一轮：看一下状态' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'Please provide your answer based on the tool results above.' },
      { role: 'user', content: '不对，双击 ESC 应该选择会话' },
      { role: 'assistant', content: 'done' },
    ]),
    '不对，双击 ESC 应该选择会话'
  );

  assert.equal(
    formatSessionLabel({
      id: 's_1234_abcd',
      createdAt: now - 6 * 60 * 1000,
      cwd: '/Users/me/project/supercell',
      model: 'qwen',
      messageCount: 10,
      preview: '不对，双击 ESC 应该选择会话',
    }, now),
    '不对，双击 ESC 应该选择会话  ·  6分钟前'
  );
});

test('session picker: extracts text from multimodal user content', () => {
  assert.equal(
    getSessionUserPreview([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看这张图的问题' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } },
        ],
      },
    ]),
    '看这张图的问题'
  );
});

test('session picker: defaults to current project sessions only', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const sessions: SessionMeta[] = [
    { id: 'current', createdAt: now, cwd: '/repo/supercell', model: 'm', messageCount: 0 },
    { id: 'same-project', createdAt: now - 1, cwd: '/repo/supercell', model: 'm', messageCount: 3 },
    { id: 'empty-same-project', createdAt: now - 2, cwd: '/repo/supercell', model: 'm', messageCount: 0 },
    { id: 'other-project', createdAt: now - 3, cwd: '/repo/my-agent', model: 'm', messageCount: 9 },
    { id: 'tmp-bench', createdAt: now - 4, cwd: '/private/var/folders/x/ma-bench-fixture', model: 'm', messageCount: 6 },
  ];

  assert.deepEqual(
    selectProjectSessions(sessions, 'current', '/repo/supercell').map((session) => session.id),
    ['current', 'same-project']
  );
});
