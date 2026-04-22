import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStack } from '../src/task-stack.js';

test('TaskStack: push returns pending task with auto-incrementing id', () => {
  const s = createTaskStack();
  const a = s.push({ prompt: 'one', messageAnchor: 0 });
  const b = s.push({ prompt: 'two', messageAnchor: 1 });
  assert.equal(a.id, 't_1');
  assert.equal(b.id, 't_2');
  assert.equal(a.status, 'pending');
  assert.equal(a.depth, 0);
  assert.equal(b.depth, 0);
  assert.equal(s.size(), 2);
});

test('TaskStack: LIFO pop order + status transitions', () => {
  const s = createTaskStack();
  s.push({ prompt: 'first', messageAnchor: 0 });
  s.push({ prompt: 'second', messageAnchor: 0 });
  const popped = s.pop();
  assert.ok(popped);
  assert.equal(popped!.id, 't_2');
  assert.equal(popped!.status, 'running');
  assert.ok(popped!.startedAt !== undefined);
  assert.equal(s.current()!.id, 't_2');
  assert.equal(s.size(), 1);
  const next = s.pop();
  assert.equal(next!.id, 't_1');
  assert.equal(s.pop(), null);
});

test('TaskStack: peek does not remove the top', () => {
  const s = createTaskStack();
  s.push({ prompt: 'x', messageAnchor: 0 });
  s.push({ prompt: 'y', messageAnchor: 0 });
  assert.equal(s.peek()!.id, 't_2');
  assert.equal(s.size(), 2);
  assert.equal(s.peek()!.id, 't_2');
});

test('TaskStack: markDone truncates result to 500 chars and moves to history', () => {
  const s = createTaskStack();
  s.push({ prompt: 'a', messageAnchor: 0 });
  const t = s.pop()!;
  const long = 'x'.repeat(800);
  s.markDone(t.id, long);
  assert.equal(t.status, 'done');
  assert.equal(t.result!.length, 500);
  assert.equal(s.current(), null);
  const hist = s.history();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].id, t.id);
});

test('TaskStack: markFailed sets failed status and stores error', () => {
  const s = createTaskStack();
  s.push({ prompt: 'a', messageAnchor: 0 });
  const t = s.pop()!;
  s.markFailed(t.id, 'boom');
  assert.equal(t.status, 'failed');
  assert.equal(t.result, 'boom');
  assert.equal(s.history().length, 1);
});

test('TaskStack: history returns newest first and respects limit', () => {
  const s = createTaskStack();
  for (let i = 0; i < 3; i++) {
    s.push({ prompt: `p${i}`, messageAnchor: 0 });
    const t = s.pop()!;
    s.markDone(t.id, `r${i}`);
  }
  const all = s.history();
  assert.equal(all.length, 3);
  assert.equal(all[0].result, 'r2');
  assert.equal(all[2].result, 'r0');
  const limited = s.history(2);
  assert.equal(limited.length, 2);
  assert.equal(limited[0].result, 'r2');
  assert.equal(limited[1].result, 'r1');
});

test('TaskStack: depth is parent.depth + 1', () => {
  const s = createTaskStack();
  const root = s.push({ prompt: 'root', messageAnchor: 0 });
  assert.equal(root.depth, 0);
  const child = s.push({
    prompt: 'child',
    parentId: root.id,
    messageAnchor: 0,
  });
  assert.equal(child.depth, 1);
  const grand = s.push({
    prompt: 'grand',
    parentId: child.id,
    messageAnchor: 0,
  });
  assert.equal(grand.depth, 2);
});

test('TaskStack: push rejects when maxTasks (50) exceeded', () => {
  const s = createTaskStack();
  for (let i = 0; i < 50; i++) {
    s.push({ prompt: `p${i}`, messageAnchor: 0 });
  }
  assert.equal(s.size(), 50);
  assert.throws(
    () => s.push({ prompt: 'overflow', messageAnchor: 0 }),
    /max=50/
  );
});

test('TaskStack: push rejects when maxDepth (8) exceeded', () => {
  const s = createTaskStack();
  let parent = s.push({ prompt: 'd0', messageAnchor: 0 });
  for (let i = 1; i < 8; i++) {
    parent = s.push({
      prompt: `d${i}`,
      parentId: parent.id,
      messageAnchor: 0,
    });
  }
  assert.equal(parent.depth, 7);
  assert.throws(
    () =>
      s.push({
        prompt: 'toodeep',
        parentId: parent.id,
        messageAnchor: 0,
      }),
    /max=8/
  );
});

test('TaskStack: clear wipes everything and resets id counter', () => {
  const s = createTaskStack();
  s.push({ prompt: 'a', messageAnchor: 0 });
  s.push({ prompt: 'b', messageAnchor: 0 });
  const t = s.pop()!;
  s.markDone(t.id, 'ok');
  s.clear();
  assert.equal(s.size(), 0);
  assert.equal(s.current(), null);
  assert.equal(s.history().length, 0);
  const fresh = s.push({ prompt: 'fresh', messageAnchor: 0 });
  assert.equal(fresh.id, 't_1');
});

test('TaskStack: abortAll clears pending but preserves history and current', () => {
  const s = createTaskStack();
  s.push({ prompt: 'done1', messageAnchor: 0 });
  const t = s.pop()!;
  s.markDone(t.id, 'ok');
  s.push({ prompt: 'run', messageAnchor: 0 });
  const running = s.pop()!;
  s.push({ prompt: 'p1', messageAnchor: 0 });
  s.push({ prompt: 'p2', messageAnchor: 0 });
  assert.equal(s.size(), 2);
  s.abortAll();
  assert.equal(s.size(), 0);
  assert.equal(s.current()!.id, running.id);
  assert.equal(s.history().length, 1);
});

test('TaskStack: pending returns a snapshot with stack top last', () => {
  const s = createTaskStack();
  s.push({ prompt: 'bottom', messageAnchor: 0 });
  s.push({ prompt: 'middle', messageAnchor: 0 });
  s.push({ prompt: 'top', messageAnchor: 0 });
  const p = s.pending();
  assert.equal(p.length, 3);
  assert.equal(p[0].prompt, 'bottom');
  assert.equal(p[2].prompt, 'top');
  p.push({} as any);
  assert.equal(s.size(), 3);
});

test('TaskStack: markDone on unknown id is a no-op', () => {
  const s = createTaskStack();
  s.markDone('t_404', 'nope');
  assert.equal(s.history().length, 0);
});
