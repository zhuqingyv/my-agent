const DEFAULT_MAX = 30000;
const HEAD_CHARS = 22500;
const TAIL_CHARS = 7500;

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function deduplicateLines(input: string): string {
  const lines = input.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const count = j - i;
    if (count >= 3) {
      out.push(lines[i]);
      out.push(`... (repeated ${count} times)`);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out.join('\n');
}

export function compressGeneric(output: string, maxChars?: number): string {
  const limit = maxChars ?? DEFAULT_MAX;
  let out = output;
  out = out.replace(ANSI_RE, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = deduplicateLines(out);
  if (out.length > limit) {
    const head = out.slice(0, HEAD_CHARS);
    const tail = out.slice(-TAIL_CHARS);
    const dropped = out.length - head.length - tail.length;
    out = `${head}\n\n[...truncated ${dropped} chars...]\n\n${tail}`;
  }
  return out.trim() || '(no output)';
}
