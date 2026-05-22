import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildContextWatchSnapshot } from '../src/cli/watch.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ma-context-watch-'));
}

function writeJsonl(file: string, rows: unknown[]): void {
  fs.writeFileSync(
    file,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf-8'
  );
}

test('context watch snapshot maps visible, llm, and pool states', () => {
  const dir = tempDir();
  const sid = 's_watch_demo';
  writeJsonl(path.join(dir, `${sid}.jsonl`), [
    { role: 'user', content: '用户完整问题' },
    { role: 'assistant', content: '很长的工具规划原文' },
    { role: 'tool', content: '工具输出原文' },
  ]);
  writeJsonl(path.join(dir, `${sid}.index.jsonl`), [
    { i: 0, sessionId: sid, role: 'user', text: '用户完整问题', createdAt: 1, immutable: true },
    { i: 1, sessionId: sid, role: 'assistant', text: '很长的工具规划原文', createdAt: 2, immutable: false },
    { i: 2, sessionId: sid, role: 'tool', text: '工具输出原文', createdAt: 3, immutable: false },
  ]);
  fs.writeFileSync(
    path.join(dir, `${sid}.context.json`),
    JSON.stringify({
      sessionId: sid,
      pins: [],
      recalled: [],
      activeItems: [
        { i: 0, role: 'user', mode: 'protected', content: '用户完整问题', updatedAt: 1 },
        { i: 1, role: 'assistant', mode: 'summary', content: '压缩后的规划摘要', updatedAt: 2 },
      ],
      updatedAt: 2,
    }),
    'utf-8'
  );
  writeJsonl(path.join(dir, `${sid}.pool.jsonl`), [
    {
      id: 'p_1',
      i: 1,
      sessionId: sid,
      role: 'assistant',
      text: '很长的工具规划原文',
      summary: '压缩后的规划摘要',
      archivedReason: 'superseded',
      createdAt: 4,
      keywords: [],
    },
    {
      id: 'p_2',
      i: 2,
      sessionId: sid,
      role: 'tool',
      text: '工具输出原文',
      archivedReason: 'demoted',
      createdAt: 5,
      keywords: [],
    },
  ]);

  const snapshot = buildContextWatchSnapshot(dir, sid);
  assert.equal(snapshot.visible.length, 3);
  assert.equal(snapshot.visible[0].status, 'active');
  assert.equal(snapshot.visible[1].status, 'compressed');
  assert.equal(snapshot.visible[1].summary, '压缩后的规划摘要');
  assert.equal(snapshot.visible[2].status, 'moved');
  assert.deepEqual(snapshot.llm.map((item) => item.i), [0, 1]);
  assert.equal(snapshot.llm[1].changed, true);
  assert.equal(snapshot.llm[1].original, '很长的工具规划原文');
  assert.equal(snapshot.pool[0].label, 'moved out');
  assert.equal(snapshot.pool[1].label, 'compressed original');
});
