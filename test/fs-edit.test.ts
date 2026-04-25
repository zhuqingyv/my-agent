import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleFileEdit } from '../servers/fs-edit-mcp.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'fs-edit-'));
}

function textOf(r: ReturnType<typeof handleFileEdit>): string {
  const first = r.content[0];
  return first && first.type === 'text' ? first.text : '';
}

test('file_edit: happy path single replace', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello world\nfoo bar\n');
    const r = handleFileEdit({ path: f, old_string: 'world', new_string: 'WORLD' });
    assert.equal(r.isError, false);
    assert.match(textOf(r), /替换 1 处/);
    assert.equal(readFileSync(f, 'utf-8'), 'hello WORLD\nfoo bar\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: returns error when old_string not found', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello\n');
    const r = handleFileEdit({ path: f, old_string: 'nope', new_string: 'x' });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /未找到/);
    assert.match(textOf(r), /前 200 字符/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: multiple matches without replace_all errors out', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'foo foo foo\n');
    const r = handleFileEdit({ path: f, old_string: 'foo', new_string: 'bar' });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /出现 3 次/);
    assert.equal(readFileSync(f, 'utf-8'), 'foo foo foo\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: replace_all replaces every occurrence', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'foo foo foo\n');
    const r = handleFileEdit({ path: f, old_string: 'foo', new_string: 'bar', replace_all: true });
    assert.equal(r.isError, false);
    assert.match(textOf(r), /替换 3 处/);
    assert.equal(readFileSync(f, 'utf-8'), 'bar bar bar\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: old_string === new_string returns 无变化', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'a.txt');
    writeFileSync(f, 'hello\n');
    const r = handleFileEdit({ path: f, old_string: 'hello', new_string: 'hello' });
    assert.equal(r.isError, false);
    assert.match(textOf(r), /无变化/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: empty old_string rejected', () => {
  const r = handleFileEdit({ path: '/tmp/whatever', old_string: '', new_string: 'x' });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /不能为空/);
});

test('file_edit: missing path rejected', () => {
  const r = handleFileEdit({ old_string: 'a', new_string: 'b' });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /path.*non-empty/);
});

test('file_edit: non-string old_string rejected', () => {
  const r = handleFileEdit({ path: '/tmp/x', old_string: 123, new_string: 'y' });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /old_string.*string/);
});

test('file_edit: non-string new_string rejected', () => {
  const r = handleFileEdit({ path: '/tmp/x', old_string: 'a', new_string: 42 });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /new_string.*string/);
});

test('file_edit: file not found returns ENOENT error', () => {
  const r = handleFileEdit({ path: '/tmp/__not_exist__/zzzz.txt', old_string: 'a', new_string: 'b' });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /文件不存在/);
});

test('file_edit: directory path rejected', () => {
  const dir = tmpDir();
  try {
    const r = handleFileEdit({ path: dir, old_string: 'a', new_string: 'b' });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /目录/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: binary file rejected', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'bin.dat');
    writeFileSync(f, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x42, 0x00]));
    const r = handleFileEdit({ path: f, old_string: 'x', new_string: 'y' });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /二进制/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: device path rejected', () => {
  const r = handleFileEdit({ path: '/dev/null', old_string: 'a', new_string: 'b' });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /设备文件/);
});

test('file_edit: CRLF preserved (no normalization)', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'crlf.txt');
    writeFileSync(f, 'a\r\nb\r\nc\r\n');
    const r = handleFileEdit({ path: f, old_string: 'b\r\n', new_string: 'B\r\n' });
    assert.equal(r.isError, false);
    const after = readFileSync(f, 'utf-8');
    assert.equal(after, 'a\r\nB\r\nc\r\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: size delta reported correctly', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'd.txt');
    writeFileSync(f, 'aaa\n');
    const r = handleFileEdit({ path: f, old_string: 'aaa', new_string: 'bbbbb' });
    assert.match(textOf(r), /\+2 bytes/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: oversize file rejected (>512KB)', () => {
  const dir = tmpDir();
  try {
    const f = join(dir, 'big.txt');
    writeFileSync(f, 'x'.repeat(520 * 1024));
    const r = handleFileEdit({ path: f, old_string: 'x', new_string: 'y' });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /上限 512KB/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file_edit: nested subdir file edits work', () => {
  const dir = tmpDir();
  try {
    const sub = join(dir, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    const f = join(sub, 'c.txt');
    writeFileSync(f, 'hello\n');
    const r = handleFileEdit({ path: f, old_string: 'hello', new_string: 'HI' });
    assert.equal(r.isError, false);
    assert.equal(readFileSync(f, 'utf-8'), 'HI\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
