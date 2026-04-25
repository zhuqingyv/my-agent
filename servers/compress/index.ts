import { compressGitOutput } from './git.js';
import { compressTestOutput } from './test.js';
import { compressGeneric } from './generic.js';

type ShortCircuit = [RegExp, string | ((m: string) => string)];

const SHORT_CIRCUITS: ShortCircuit[] = [
  [/nothing to commit,?\s*working tree clean/i, 'clean — nothing to commit'],
  [/Already up[- ]to[- ]date/i, 'ok (up to date)'],
  [/already installed/i, 'ok (already installed)'],
];

const TEST_RUNNERS = new Set(['vitest', 'jest', 'pytest', 'cargo', 'mocha', 'tap']);
const JS_PKG_MANAGERS = new Set(['npm', 'npx', 'yarn', 'pnpm']);

export function compressOutput(command: string, output: string): string {
  if (!output || !output.trim()) return '(no output)';

  for (const [pattern, result] of SHORT_CIRCUITS) {
    if (pattern.test(output) && output.length < 200) {
      return typeof result === 'string' ? result : result(output.trim());
    }
  }

  const parts = command.trim().split(/\s+/);
  const base = parts[0] ?? '';
  const sub = parts[1] ?? '';

  if (base === 'git' && sub) {
    return compressGitOutput(sub, output);
  }
  if (JS_PKG_MANAGERS.has(base) && sub === 'test') {
    return compressTestOutput(output);
  }
  if (TEST_RUNNERS.has(base)) {
    return compressTestOutput(output);
  }

  return compressGeneric(output);
}
