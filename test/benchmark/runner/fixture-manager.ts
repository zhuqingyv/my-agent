import { cpSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import type { FixtureSpec } from './types.js';

export interface PreparedFixture {
  cwd: string;
  cleanup: () => Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BENCH_FIXTURES = resolve(__dirname, '..', 'fixtures');
const E2E_FIXTURES = resolve(__dirname, '..', '..', 'e2e', 'fixtures');

function resolveFixtureSource(project: string): string {
  const benchPath = join(BENCH_FIXTURES, project);
  if (existsSync(benchPath) && statSync(benchPath).isDirectory()) return benchPath;

  const e2ePath = join(E2E_FIXTURES, project);
  if (existsSync(e2ePath) && statSync(e2ePath).isDirectory()) return e2ePath;

  throw new Error(
    `fixture not found: "${project}". Looked in:\n  - ${benchPath}\n  - ${e2ePath}`,
  );
}

export async function prepareFixture(spec?: FixtureSpec): Promise<PreparedFixture> {
  const cwd = mkdtempSync(join(tmpdir(), 'ma-bench-fixture-'));

  if (spec) {
    const src = resolveFixtureSource(spec.project);
    cpSync(src, cwd, { recursive: true });

    if (spec.setup && spec.setup.length > 0) {
      for (const cmd of spec.setup) {
        execSync(cmd, { cwd, stdio: 'pipe' });
      }
    }
  }

  const cleanup = async (): Promise<void> => {
    rmSync(cwd, { recursive: true, force: true });
  };

  return { cwd, cleanup };
}
