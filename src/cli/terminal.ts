export class TerminalInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalInputError';
  }
}

export function supportsInteractiveInput(stdin: NodeJS.ReadStream = process.stdin): boolean {
  return Boolean(stdin.isTTY && typeof stdin.setRawMode === 'function');
}

export function assertInteractiveInput(stdin: NodeJS.ReadStream = process.stdin): void {
  if (supportsInteractiveInput(stdin)) return;
  throw new TerminalInputError('ma requires an interactive terminal. Please run it from a TTY, or use a terminal tab/window instead of a piped/non-interactive process.');
}
