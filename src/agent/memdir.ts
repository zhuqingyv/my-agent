import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const MAX_FILE_BYTES = 32 * 1024;
const MAX_LAYERS = 5;
const FILENAME = 'AGENT.md';
const GLOBAL_DIR = '.my-agent';
const TRUNC_MARK = '\n[...truncated]';

export interface AgentMdFile {
  path: string;
  content: string;
}

function readTruncated(file: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = Math.min(stat.size, MAX_FILE_BYTES);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, 0);
      let content = buf.toString('utf-8');
      if (stat.size > MAX_FILE_BYTES) content += TRUNC_MARK;
      return content;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function isProjectRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.git'));
}

export function loadAgentMdFiles(cwd: string): AgentMdFile[] {
  const home = os.homedir();
  const collectedUp: AgentMdFile[] = [];

  let cur = path.resolve(cwd);
  while (true) {
    const candidate = path.join(cur, FILENAME);
    const c = readTruncated(candidate);
    if (c !== null) collectedUp.push({ path: candidate, content: c });

    if (isProjectRoot(cur)) break;
    if (cur === home) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  const layered = collectedUp.reverse();

  // Global fallback: read if exists, placed at the very top (lowest priority)
  const globalFile = path.join(home, GLOBAL_DIR, FILENAME);
  const globalContent = readTruncated(globalFile);

  const files: AgentMdFile[] = [];
  if (globalContent !== null) {
    files.push({ path: globalFile, content: globalContent });
  }
  for (const f of layered) files.push(f);

  // Cap at MAX_LAYERS, keep the innermost (last) ones since they are higher priority
  if (files.length > MAX_LAYERS) {
    return files.slice(files.length - MAX_LAYERS);
  }
  return files;
}

export function buildSystemPrompt(base: string, files: AgentMdFile[]): string {
  if (files.length === 0) return base;
  const parts: string[] = [`<SYSTEM_PROMPT>\n${base}\n</SYSTEM_PROMPT>`];
  for (const f of files) {
    parts.push(`<AGENT_MD source="${f.path}">\n${f.content}\n</AGENT_MD>`);
  }
  return parts.join('\n\n');
}

export function loadAgentMd(cwd?: string): string {
  const files = loadAgentMdFiles(cwd ?? process.cwd());
  if (files.length === 0) return '';
  return files
    .map((f) => `<AGENT_MD source="${f.path}">\n${f.content}\n</AGENT_MD>`)
    .join('\n---\n');
}
