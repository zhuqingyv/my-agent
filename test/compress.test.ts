import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressGeneric } from '../servers/compress/generic.js';
import { compressOutput } from '../servers/compress/index.js';

test('compressGeneric: strips ANSI color codes', () => {
  const colored = '\x1b[31mred text\x1b[0m and \x1b[1;32mgreen\x1b[0m';
  const out = compressGeneric(colored);
  assert.equal(out, 'red text and green');
});

test('compressGeneric: deduplicates repeated lines', () => {
  const input = ['start', 'same', 'same', 'same', 'same', 'same', 'end'].join('\n');
  const out = compressGeneric(input);
  assert.match(out, /\(repeated 5 times\)/);
  assert.match(out, /^start/);
  assert.match(out, /end$/);
});

test('compressGeneric: truncates output over maxChars with head + tail', () => {
  const huge = 'A'.repeat(40000) + 'B'.repeat(40000);
  const out = compressGeneric(huge);
  assert.ok(out.length < huge.length);
  assert.match(out, /\[\.\.\.truncated \d+ chars\.\.\.\]/);
  assert.ok(out.startsWith('A'));
  assert.ok(out.endsWith('B'));
});

test('compressGeneric: collapses 3+ blank lines to one blank', () => {
  const input = 'a\n\n\n\n\nb';
  const out = compressGeneric(input);
  assert.equal(out, 'a\n\nb');
});

test('compressGeneric: empty output returns placeholder', () => {
  assert.equal(compressGeneric(''), '(no output)');
  assert.equal(compressGeneric('   \n  \n'), '(no output)');
});

test('compressOutput: routes git status to git compressor', () => {
  const out = compressOutput('git status', 'On branch main\nnothing to commit, working tree clean\n');
  assert.match(out, /clean/i);
});

test('compressOutput: short-circuits "already installed"', () => {
  const out = compressOutput('brew install foo', 'foo 1.0 is already installed');
  assert.equal(out, 'ok (already installed)');
});

test('compressOutput: falls back to generic for unknown commands', () => {
  const colored = '\x1b[33mhello\x1b[0m';
  const out = compressOutput('echo hi', colored);
  assert.equal(out, 'hello');
});

test('compressOutput: empty output returns placeholder', () => {
  assert.equal(compressOutput('ls', ''), '(no output)');
});
