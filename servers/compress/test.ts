const MAX_LINES = 100;

const SUMMARY_RE = /(Tests?:|Test Suites?:|failing|passing|failed|passed|ok|not ok|FAIL|PASS|\d+ passed|\d+ failed|test result)/i;
const FAIL_RE = /^(\s*)(✗|×|FAIL|✘|not ok|failed|Error:|AssertionError|Expected|Received|at )/;
const PASS_LINE_RE = /^\s*(✓|ok|PASS)\s/;

export function compressTestOutput(output: string): string {
  const stripped = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const lines = stripped.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (PASS_LINE_RE.test(line)) continue;
    if (!line.trim()) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (SUMMARY_RE.test(line) || FAIL_RE.test(line) || line.startsWith(' ')) {
      kept.push(line);
    } else {
      kept.push(line);
    }
  }
  let result = kept.join('\n');
  const resultLines = result.split('\n');
  if (resultLines.length > MAX_LINES) {
    const head = resultLines.slice(0, MAX_LINES - 20).join('\n');
    const tail = resultLines.slice(-20).join('\n');
    result = `${head}\n\n[...truncated ${resultLines.length - MAX_LINES} lines...]\n\n${tail}`;
  }
  return result.trim() || '(no output)';
}
