import type { DiffArtifact } from './events.js';

const DIFF_MARKER = '--- Diff ---';

export function parseToolResultDiff(content: string): DiffArtifact | undefined {
  const markerIdx = content.indexOf(DIFF_MARKER);
  if (markerIdx === -1) return undefined;

  const diffText = content.slice(markerIdx + DIFF_MARKER.length).trimStart();
  if (!diffText.trim()) return undefined;

  const header = content.slice(0, markerIdx);
  const filePath = parseEditedFilePath(header);
  const { addedLines, removedLines } = countChangedLines(diffText);

  return {
    type: 'diff',
    filePath,
    addedLines,
    removedLines,
    diffText,
    truncated: diffText.includes('collapsed') || diffText.includes('truncated'),
  };
}

function parseEditedFilePath(header: string): string {
  const normalized = header.trim();
  const match = normalized.match(/(?:已编辑|已覆盖|已写入)\s+(.+?)(?:[（(：:]|$)/);
  return match ? match[1].trim() : '';
}

function countChangedLines(diffText: string): { addedLines: number; removedLines: number } {
  const lines = diffText.split('\n');
  const summary = lines.find((line) => /^\+\d+\s+-\d+/.test(stripAnsi(line).trim()));
  if (summary) {
    const clean = stripAnsi(summary);
    const added = clean.match(/\+(\d+)/);
    const removed = clean.match(/-(\d+)/);
    return {
      addedLines: added ? Number.parseInt(added[1], 10) : 0,
      removedLines: removed ? Number.parseInt(removed[1], 10) : 0,
    };
  }

  let addedLines = 0;
  let removedLines = 0;
  for (const rawLine of lines) {
    const line = stripAnsi(rawLine).trimStart();
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) addedLines++;
    if (line.startsWith('-')) removedLines++;
  }
  return { addedLines, removedLines };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}
