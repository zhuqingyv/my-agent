import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadAgentMd,
  loadAgentMdFiles,
  buildSystemPrompt,
} from '../src/agent/memdir.js';

function mktmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withHome<T>(home: string, fn: () => T): T {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
  }
}

test('loadAgentMdFiles: returns empty when no files exist', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  fs.mkdirSync(path.join(projRoot, '.git'), { recursive: true });
  withHome(home, () => {
    const files = loadAgentMdFiles(projRoot);
    assert.deepEqual(files, []);
  });
});

test('loadAgentMdFiles: finds cwd AGENT.md', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  fs.mkdirSync(path.join(projRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), 'project rules');
  withHome(home, () => {
    const files = loadAgentMdFiles(projRoot);
    assert.equal(files.length, 1);
    assert.equal(files[0].content, 'project rules');
  });
});

test('loadAgentMdFiles: walks from cwd up to .git root, inner last', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  const sub = path.join(projRoot, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(projRoot, '.git'));
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), 'root');
  fs.writeFileSync(path.join(projRoot, 'a', 'AGENT.md'), 'mid');
  fs.writeFileSync(path.join(sub, 'AGENT.md'), 'inner');
  withHome(home, () => {
    const files = loadAgentMdFiles(sub);
    assert.equal(files.length, 3);
    assert.equal(files[0].content, 'root');
    assert.equal(files[1].content, 'mid');
    assert.equal(files[2].content, 'inner');
  });
});

test('loadAgentMdFiles: stops at .git root, does not cross above', () => {
  const home = mktmp('ma-home-');
  const outside = path.join(home, 'outside');
  const projRoot = path.join(outside, 'proj');
  fs.mkdirSync(projRoot, { recursive: true });
  fs.mkdirSync(path.join(projRoot, '.git'));
  fs.writeFileSync(path.join(outside, 'AGENT.md'), 'should-not-load');
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), 'proj-level');
  withHome(home, () => {
    const files = loadAgentMdFiles(projRoot);
    assert.equal(files.length, 1);
    assert.equal(files[0].content, 'proj-level');
  });
});

test('loadAgentMdFiles: treats .git file (worktree) same as directory', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'wt');
  fs.mkdirSync(projRoot, { recursive: true });
  fs.writeFileSync(path.join(projRoot, '.git'), 'gitdir: /somewhere/else\n');
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), 'worktree-agent');
  withHome(home, () => {
    const files = loadAgentMdFiles(projRoot);
    assert.equal(files.length, 1);
    assert.equal(files[0].content, 'worktree-agent');
  });
});

test('loadAgentMdFiles: includes global ~/.my-agent/AGENT.md at top', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  fs.mkdirSync(path.join(projRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(home, '.my-agent'), { recursive: true });
  fs.writeFileSync(path.join(home, '.my-agent', 'AGENT.md'), 'global');
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), 'project');
  withHome(home, () => {
    const files = loadAgentMdFiles(projRoot);
    assert.equal(files.length, 2);
    assert.equal(files[0].content, 'global');
    assert.equal(files[1].content, 'project');
  });
});

test('loadAgentMdFiles: truncates files larger than 32KB', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  fs.mkdirSync(path.join(projRoot, '.git'), { recursive: true });
  const big = 'x'.repeat(64 * 1024);
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), big);
  withHome(home, () => {
    const files = loadAgentMdFiles(projRoot);
    assert.equal(files.length, 1);
    assert.ok(files[0].content.length <= 32 * 1024 + 32);
    assert.ok(files[0].content.endsWith('[...truncated]'));
  });
});

test('loadAgentMdFiles: caps at 5 layers, keeps innermost', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'p');
  fs.mkdirSync(projRoot, { recursive: true });
  fs.mkdirSync(path.join(projRoot, '.git'));
  // Build 7 levels deep: p / l1 / l2 / l3 / l4 / l5 / l6
  let dir = projRoot;
  const labels: string[] = ['root'];
  for (let i = 1; i <= 6; i++) {
    dir = path.join(dir, `l${i}`);
    fs.mkdirSync(dir);
    labels.push(`l${i}`);
  }
  // Write AGENT.md at each level
  let d = projRoot;
  fs.writeFileSync(path.join(d, 'AGENT.md'), 'root');
  for (let i = 1; i <= 6; i++) {
    d = path.join(d, `l${i}`);
    fs.writeFileSync(path.join(d, 'AGENT.md'), `l${i}`);
  }
  withHome(home, () => {
    const files = loadAgentMdFiles(dir);
    assert.equal(files.length, 5);
    // Innermost kept: the last file should be 'l6'
    assert.equal(files[files.length - 1].content, 'l6');
    // Outermost 'root' and 'l1' should have been dropped
    const contents = files.map((f) => f.content);
    assert.ok(!contents.includes('root'));
  });
});

test('buildSystemPrompt: wraps base and files in tagged blocks', () => {
  const out = buildSystemPrompt('BASE', [
    { path: '/a/AGENT.md', content: 'hello' },
    { path: '/a/b/AGENT.md', content: 'world' },
  ]);
  assert.ok(out.includes('<SYSTEM_PROMPT>\nBASE\n</SYSTEM_PROMPT>'));
  assert.ok(out.includes('<AGENT_MD source="/a/AGENT.md">\nhello\n</AGENT_MD>'));
  assert.ok(
    out.includes('<AGENT_MD source="/a/b/AGENT.md">\nworld\n</AGENT_MD>')
  );
  // Inner must come after outer
  assert.ok(out.indexOf('hello') < out.indexOf('world'));
});

test('buildSystemPrompt: returns base unchanged when files empty', () => {
  assert.equal(buildSystemPrompt('BASE', []), 'BASE');
});

test('loadAgentMd: returns empty string when nothing to load', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  fs.mkdirSync(path.join(projRoot, '.git'), { recursive: true });
  withHome(home, () => {
    assert.equal(loadAgentMd(projRoot), '');
  });
});

test('loadAgentMd: concatenates with separator, inner last', () => {
  const home = mktmp('ma-home-');
  const projRoot = path.join(home, 'proj');
  const sub = path.join(projRoot, 'src');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(projRoot, '.git'));
  fs.writeFileSync(path.join(projRoot, 'AGENT.md'), 'PROJECT');
  fs.writeFileSync(path.join(sub, 'AGENT.md'), 'SUB');
  withHome(home, () => {
    const out = loadAgentMd(sub);
    assert.ok(out.includes('PROJECT'));
    assert.ok(out.includes('SUB'));
    assert.ok(out.indexOf('PROJECT') < out.indexOf('SUB'));
    assert.ok(out.includes('\n---\n'));
  });
});
