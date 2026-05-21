import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceDiffArtifact, WorkspaceDiffFile } from './events.js';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 20;

interface FileState {
  exists: boolean;
  content: string | null;
}

export interface WorkspaceSnapshot {
  root: string;
  files: Map<string, FileState>;
}

export function collectWorkspaceSnapshot(cwd = process.cwd()): WorkspaceSnapshot | null {
  const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
  if (!root) return null;

  const files = new Map<string, FileState>();
  for (const path of dirtyPaths(root)) {
    files.set(path, readWorktreeState(root, path));
  }
  return { root, files };
}

export function diffWorkspaceSnapshots(
  before: WorkspaceSnapshot | null,
  after: WorkspaceSnapshot | null
): WorkspaceDiffArtifact | null {
  if (!before || !after || before.root !== after.root) return null;

  const paths = new Set<string>([...before.files.keys(), ...after.files.keys()]);
  const files: WorkspaceDiffFile[] = [];
  let truncated = false;

  for (const path of [...paths].sort()) {
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }

    const beforeState = resolveState(before, path);
    const afterState = resolveState(after, path);
    if (beforeState.content === afterState.content) continue;

    const status = classifyStatus(beforeState, afterState);
    const oldContent = beforeState.content ?? '';
    const newContent = afterState.content ?? '';
    const diff = generateSimpleDiff(oldContent, newContent, path);

    files.push({
      type: 'diff',
      filePath: path,
      status,
      addedLines: diff.addedLines,
      removedLines: diff.removedLines,
      diffText: diff.diffText,
      truncated: diff.truncated,
    });
  }

  if (files.length === 0) return null;

  return {
    type: 'workspace-diff',
    files,
    summary: files
      .map((f) => `${statusLabel(f.status)} ${f.filePath} +${f.addedLines}/-${f.removedLines}`)
      .join('\n'),
    truncated,
  };
}

function generateSimpleDiff(
  oldContent: string,
  newContent: string,
  path: string
): { diffText: string; addedLines: number; removedLines: number; truncated: boolean } {
  const oldLines = splitContentLines(oldContent);
  const newLines = splitContentLines(newContent);
  const max = Math.max(oldLines.length, newLines.length);
  const body: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let addedLines = 0;
  let removedLines = 0;
  let truncated = false;

  for (let i = 0; i < max; i++) {
    if (body.length >= 160) {
      truncated = true;
      body.push('... (diff truncated)');
      break;
    }

    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;
    if (oldLine === newLine) continue;

    if (oldLine !== undefined) {
      body.push(`- ${i + 1}: ${oldLine}`);
      removedLines += 1;
    }
    if (newLine !== undefined) {
      body.push(`+ ${i + 1}: ${newLine}`);
      addedLines += 1;
    }
  }

  return {
    diffText: body.join('\n'),
    addedLines,
    removedLines,
    truncated,
  };
}

function splitContentLines(content: string): string[] {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function resolveState(snapshot: WorkspaceSnapshot, path: string): FileState {
  const dirty = snapshot.files.get(path);
  if (dirty) return dirty;

  const head = readHeadContent(snapshot.root, path);
  return head === null
    ? { exists: false, content: null }
    : { exists: true, content: head };
}

function classifyStatus(before: FileState, after: FileState): WorkspaceDiffFile['status'] {
  if (!before.exists && after.exists) return 'added';
  if (before.exists && !after.exists) return 'deleted';
  return 'modified';
}

function dirtyPaths(root: string): string[] {
  const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
  if (!raw) return [];

  const out: string[] = [];
  const parts = raw.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    const xy = rec.slice(0, 2);
    const path = rec.slice(3);
    if (!path) continue;
    out.push(path);
    if (xy.includes('R') || xy.includes('C')) i += 1;
  }
  return out;
}

function readWorktreeState(root: string, path: string): FileState {
  const abs = join(root, path);
  if (!existsSync(abs)) return { exists: false, content: null };
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES || isBinary(abs)) {
      return { exists: true, content: null };
    }
    return { exists: true, content: readFileSync(abs, 'utf8') };
  } catch {
    return { exists: false, content: null };
  }
}

function readHeadContent(root: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `HEAD:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_FILE_BYTES * 2,
    });
  } catch {
    return null;
  }
}

function isBinary(path: string): boolean {
  try {
    const buf = readFileSync(path);
    return buf.subarray(0, 512).includes(0);
  } catch {
    return true;
  }
}

function statusLabel(status: WorkspaceDiffFile['status']): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}
