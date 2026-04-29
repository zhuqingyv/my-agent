import * as pty from 'node-pty';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const TSX = path.join(PROJECT_ROOT, 'node_modules/.bin/tsx');
const CLI = path.join(PROJECT_ROOT, 'src/cli/index.tsx');

export type IPty = pty.IPty;

export function spawnMa(cwd: string): IPty {
  try {
    fs.chmodSync(
      path.join(
        PROJECT_ROOT,
        'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'
      ),
      0o755
    );
  } catch {}
  return pty.spawn(TSX, [CLI], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env },
  });
}

export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b[78]/g, '')
    .replace(/\x1b\[\?[0-9]+[hl]/g, '');
}

// Ink CLI 下文本 + \r 必须分两次 write,中间 sleep 800ms,否则 submit 不触发 (mnemo: 923)
export async function sendLine(proc: IPty, text: string): Promise<void> {
  proc.write(text);
  await new Promise((r) => setTimeout(r, 800));
  proc.write('\r');
}

export function waitFor(
  proc: IPty,
  predicate: (output: string) => boolean,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sub.dispose();
      reject(
        new Error(
          `waitFor timeout after ${timeoutMs}ms. Tail: ${stripAnsi(output).slice(-400)}`
        )
      );
    }, timeoutMs);
    const sub = proc.onData((data) => {
      if (settled) return;
      output += data;
      if (predicate(output)) {
        settled = true;
        clearTimeout(timer);
        sub.dispose();
        resolve(output);
      }
    });
  });
}

export async function killMa(proc: IPty): Promise<void> {
  try {
    proc.write('/quit\r');
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));
  try {
    proc.kill();
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
}
