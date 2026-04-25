import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressGitOutput } from '../servers/compress/git.js';

test('git status: porcelain clean', () => {
  assert.equal(compressGitOutput('status', ''), '(no output)');
});

test('git status: groups staged / modified / untracked / conflicts', () => {
  const porcelain = [
    'M  src/a.ts',
    ' M src/b.ts',
    '?? src/c.ts',
    'UU src/d.ts',
  ].join('\n');
  const out = compressGitOutput('status', porcelain);
  assert.match(out, /staged \(1\)/);
  assert.match(out, /modified \(1\)/);
  assert.match(out, /untracked \(1\)/);
  assert.match(out, /conflicts \(1\)/);
  assert.match(out, /src\/a\.ts/);
  assert.match(out, /src\/d\.ts/);
});

test('git status: clean porcelain returns clean message', () => {
  const out = compressGitOutput('status', '\n');
  assert.equal(out, '(no output)');
});

test('git status: >10 files shows +N more', () => {
  const lines: string[] = [];
  for (let i = 0; i < 15; i++) lines.push(` M file${i}.ts`);
  const out = compressGitOutput('status', lines.join('\n'));
  assert.match(out, /modified \(15\)/);
  assert.match(out, /\.\.\. \+5 more/);
});

test('git diff: keeps headers and hunk markers, counts +/-', () => {
  const diff = [
    'diff --git a/x.ts b/x.ts',
    'index abc..def 100644',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -1,3 +1,4 @@',
    ' keep',
    '+added1',
    '+added2',
    '-removed1',
    ' keep2',
  ].join('\n');
  const out = compressGitOutput('diff', diff);
  assert.match(out, /diff --git a\/x\.ts b\/x\.ts/);
  assert.match(out, /@@ -1,3 \+1,4 @@/);
  assert.match(out, /\+2 -1/);
});

test('git diff: hunk over 50 lines truncated', () => {
  const lines = ['diff --git a/b.ts b/b.ts', '@@ -1 +1,100 @@'];
  for (let i = 0; i < 100; i++) lines.push(`+line${i}`);
  const out = compressGitOutput('diff', lines.join('\n'));
  assert.match(out, /\.\.\. \(\d+ lines truncated\)/);
  assert.match(out, /\+100 -0/);
});

test('git log: hash + subject + author/date, truncates long subject', () => {
  const subject = 'a'.repeat(100);
  const logOut = [
    'commit abcdef1234567890',
    'Author: Foo <foo@bar>',
    'Date: Mon Jan 1 12:00 2026',
    '',
    '    ' + subject,
    '',
    '    body line',
    '    Signed-off-by: Foo <foo@bar>',
  ].join('\n');
  const out = compressGitOutput('log', logOut);
  assert.match(out, /abcdef1/);
  assert.match(out, /Foo <foo@bar>/);
  assert.doesNotMatch(out, /Signed-off-by/);
  assert.ok(out.includes('…'), 'long subject should be truncated with …');
});

test('git log: caps at 20 commits', () => {
  const parts: string[] = [];
  for (let i = 0; i < 30; i++) {
    const h = (i + 0x1000000).toString(16).padStart(7, '0');
    parts.push(`commit ${h}abcdef\nAuthor: A <a@b>\nDate: x\n\n    subject${i}\n`);
  }
  const out = compressGitOutput('log', parts.join(''));
  const matches = out.match(/subject\d+/g) || [];
  assert.equal(matches.length, 20);
});

test('git commit: extracts hash from [main abc1234]', () => {
  const out = compressGitOutput('commit', '[main abc1234] subject here\n 1 file changed');
  assert.equal(out, 'ok abc1234');
});

test('git push: extracts branch', () => {
  const out = compressGitOutput('push', 'To github.com:foo/bar\n   a..b  main -> main');
  assert.equal(out, 'ok main');
});

test('git add: empty output returns ok', () => {
  assert.equal(compressGitOutput('add', '\n'), '(no output)');
});

test('unknown subcommand returns output as-is', () => {
  const out = compressGitOutput('stash', 'some output here');
  assert.equal(out, 'some output here');
});
