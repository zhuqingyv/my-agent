import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentConfig } from './mcp/types.js';

function readJson(filePath: string): AgentConfig {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as AgentConfig;
  } catch (err) {
    throw new Error(`Failed to parse config at ${filePath}: ${(err as Error).message}`);
  }
}

export function loadConfig(configPath?: string): AgentConfig {
  const candidates: string[] = [];
  if (configPath) candidates.push(path.resolve(configPath));
  candidates.push(path.resolve(process.cwd(), 'config.json'));
  candidates.push(path.join(os.homedir(), '.my-agent', 'config.json'));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return readJson(p);
    }
  }

  throw new Error(
    `Config file not found. Tried:\n${candidates.map((c) => `  - ${c}`).join('\n')}`
  );
}

export function resolveConfigPath(configPath?: string): string | null {
  const candidates: string[] = [];
  if (configPath) candidates.push(path.resolve(configPath));
  candidates.push(path.resolve(process.cwd(), 'config.json'));
  candidates.push(path.join(os.homedir(), '.my-agent', 'config.json'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
