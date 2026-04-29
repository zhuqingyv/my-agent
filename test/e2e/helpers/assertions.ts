import assert from 'node:assert';

export function hasLlmError(text: string): boolean {
  return /\[error\]|Internal Server Error|5\d\d\s+Error/.test(text);
}

export function countToolSuccess(text: string): number {
  return (text.match(/✓/g) || []).length;
}

export function countToolFail(text: string): number {
  return (text.match(/✗/g) || []).length;
}

export function assertChineseMin(text: string, min: number): void {
  const chunks = text.match(/[一-鿿]+/g) || [];
  const count = chunks.join('').length;
  assert.ok(
    count >= min,
    `Expected >=${min} Chinese chars, got ${count}. Tail: ${text.slice(-200)}`
  );
}

export function assertNoHtmlLeak(text: string): void {
  const patterns = [
    /<think[\s>]/i,
    /<\/think>/i,
    /<\|channel\|?>/i,
    /<channel\|?>/i,
    /<\|thought\|?>/i,
  ];
  for (const p of patterns) {
    assert.ok(
      !p.test(text),
      `HTML/thinking tag leaked (${p}). Tail: ${text.slice(-200)}`
    );
  }
}

export function assertNoMaxListeners(text: string): void {
  assert.ok(
    !/MaxListenersExceededWarning/i.test(text),
    `MaxListenersExceededWarning detected. Tail: ${text.slice(-200)}`
  );
}
