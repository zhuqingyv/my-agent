import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareFixture } from '../fixture-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_FIXTURES = resolve(__dirname, '..', '..', 'fixtures');
const E2E_FIXTURES = resolve(__dirname, '..', '..', '..', 'e2e', 'fixtures');

function withTempFixture(
  baseDir: string,
  name: string,
  files: Record<string, string>,
): () => void {
  const dir = join(baseDir, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return () => rmSync(dir, { recursive: true, force: true });
}

test('prepareFixture: 复制 fixture 到独立临时目录,原始目录不受影响', async () => {
  const name = `unit-copy-${Date.now()}`;
  const cleanupSrc = withTempFixture(BENCH_FIXTURES, name, {
    'package.json': '{"name":"x"}\n',
    'src/index.js': 'console.log(1);\n',
  });

  try {
    const { cwd, cleanup } = await prepareFixture({ project: name });
    try {
      assert.notEqual(cwd, join(BENCH_FIXTURES, name), '应该是独立临时目录,不是原始路径');
      assert.ok(cwd.startsWith(tmpdir()), `cwd 应在 os.tmpdir 下: ${cwd}`);
      assert.equal(readFileSync(join(cwd, 'package.json'), 'utf-8'), '{"name":"x"}\n');
      assert.equal(readFileSync(join(cwd, 'src/index.js'), 'utf-8'), 'console.log(1);\n');

      // 写入不应污染原始目录
      writeFileSync(join(cwd, 'pollution.txt'), 'x');
      assert.ok(!existsSync(join(BENCH_FIXTURES, name, 'pollution.txt')), '原始目录不应被污染');
    } finally {
      await cleanup();
      assert.ok(!existsSync(cwd), 'cleanup 后临时目录应被删除');
    }
  } finally {
    cleanupSrc();
  }
});

test('prepareFixture: setup 命令按顺序在 cwd 中执行', async () => {
  const name = `unit-setup-${Date.now()}`;
  const cleanupSrc = withTempFixture(BENCH_FIXTURES, name, {
    'README.md': 'hello\n',
  });

  try {
    const { cwd, cleanup } = await prepareFixture({
      project: name,
      setup: [
        "node -e \"require('fs').writeFileSync('step1.txt', 'one')\"",
        "node -e \"require('fs').writeFileSync('step2.txt', require('fs').readFileSync('step1.txt','utf-8')+'-two')\"",
      ],
    });
    try {
      assert.equal(readFileSync(join(cwd, 'step1.txt'), 'utf-8'), 'one');
      assert.equal(readFileSync(join(cwd, 'step2.txt'), 'utf-8'), 'one-two');
      // 原文件也还在
      assert.equal(readFileSync(join(cwd, 'README.md'), 'utf-8'), 'hello\n');
    } finally {
      await cleanup();
    }
  } finally {
    cleanupSrc();
  }
});

test('prepareFixture: FixtureSpec 为 undefined 时返回空临时目录', async () => {
  const { cwd, cleanup } = await prepareFixture(undefined);
  try {
    assert.ok(existsSync(cwd), '空临时目录应存在');
    assert.ok(cwd.startsWith(tmpdir()));
    const { readdirSync } = await import('node:fs');
    assert.deepEqual(readdirSync(cwd), [], '应是完全空的目录');
  } finally {
    await cleanup();
    assert.ok(!existsSync(cwd));
  }
});

test('prepareFixture: 优先查 test/benchmark/fixtures 再查 test/e2e/fixtures', async () => {
  const name = `unit-lookup-${Date.now()}`;

  // 只在 e2e 放
  const cleanupE2e = withTempFixture(E2E_FIXTURES, name, {
    'marker.txt': 'from-e2e',
  });
  try {
    let r = await prepareFixture({ project: name });
    try {
      assert.equal(readFileSync(join(r.cwd, 'marker.txt'), 'utf-8'), 'from-e2e');
    } finally {
      await r.cleanup();
    }

    // benchmark 也放同名,应命中 benchmark
    const cleanupBench = withTempFixture(BENCH_FIXTURES, name, {
      'marker.txt': 'from-bench',
    });
    try {
      r = await prepareFixture({ project: name });
      try {
        assert.equal(
          readFileSync(join(r.cwd, 'marker.txt'), 'utf-8'),
          'from-bench',
          'benchmark fixtures 应优先于 e2e fixtures',
        );
      } finally {
        await r.cleanup();
      }
    } finally {
      cleanupBench();
    }
  } finally {
    cleanupE2e();
  }
});

test('prepareFixture: fixture 不存在时抛出带路径提示的错误', async () => {
  await assert.rejects(
    () => prepareFixture({ project: `__does_not_exist_${Date.now()}__` }),
    /fixture not found/,
  );
});

test('prepareFixture: setup 命令失败时抛错向上传播', async () => {
  const name = `unit-setup-fail-${Date.now()}`;
  const cleanupSrc = withTempFixture(BENCH_FIXTURES, name, { 'a.txt': 'a' });
  try {
    await assert.rejects(
      () => prepareFixture({ project: name, setup: ['node -e "process.exit(7)"'] }),
    );
  } finally {
    cleanupSrc();
  }
});

test('prepareFixture: 多次调用返回互相独立的目录', async () => {
  const name = `unit-iso-${Date.now()}`;
  const cleanupSrc = withTempFixture(BENCH_FIXTURES, name, { 'shared.txt': 'base' });
  try {
    const a = await prepareFixture({ project: name });
    const b = await prepareFixture({ project: name });
    try {
      assert.notEqual(a.cwd, b.cwd);
      writeFileSync(join(a.cwd, 'only-a.txt'), '1');
      assert.ok(!existsSync(join(b.cwd, 'only-a.txt')), 'a 的修改不应影响 b');
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  } finally {
    cleanupSrc();
  }
});
