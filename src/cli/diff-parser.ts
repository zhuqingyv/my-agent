export { parseToolResultDiff } from '../agent/diff-artifact.js';

export function makeToolResultPreview(content: string): string {
  return content
    .replace(/<[^>]*>/g, '')
    .trim()
    .split('\n')[0]
    .slice(0, 50);
}
