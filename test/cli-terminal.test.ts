import test from 'node:test';
import assert from 'node:assert/strict';

import { assertInteractiveInput, supportsInteractiveInput } from '../src/cli/terminal.js';

test('supportsInteractiveInput: accepts TTY streams with setRawMode', () => {
  const stdin = {
    isTTY: true,
    setRawMode() {
      return this;
    },
  } as unknown as NodeJS.ReadStream;

  assert.equal(supportsInteractiveInput(stdin), true);
});

test('assertInteractiveInput: rejects non-interactive streams before Ink render', () => {
  const stdin = {
    isTTY: false,
  } as unknown as NodeJS.ReadStream;

  assert.throws(
    () => assertInteractiveInput(stdin),
    /requires an interactive terminal/
  );
});
