import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentConfig, ModelConfig } from './mcp/types.js';

const DEFAULT_MODEL: ModelConfig = {
  baseURL: 'http://localhost:1234/v1',
  model: 'qwen3-30b-a3b',
  apiKey: 'lm-studio',
  temperature: 0.8,
  frequencyPenalty: 1.15,
};

export function globalConfigDir(): string {
  return path.join(os.homedir(), '.my-agent');
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), 'config.json');
}

export function projectConfigPath(): string {
  return path.resolve(process.cwd(), 'config.json');
}

function readJson(filePath: string): Partial<AgentConfig> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as Partial<AgentConfig>;
  } catch (err) {
    throw new Error(`Failed to parse config at ${filePath}: ${(err as Error).message}`);
  }
}

export function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const existing = (target as any)[key];
      const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
      (target as any)[key] = deepMerge(base, value);
    } else {
      (target as any)[key] = value;
    }
  }
  return target;
}

export interface ConfigLoadResult {
  config: AgentConfig;
  sources: string[];
  createdDefault: boolean;
}

function ensureGlobalDefault(): { created: boolean; path: string } {
  const dir = globalConfigDir();
  const file = globalConfigPath();
  if (fs.existsSync(file)) {
    return { created: false, path: file };
  }
  fs.mkdirSync(dir, { recursive: true });
  const defaults = { model: DEFAULT_MODEL };
  fs.writeFileSync(file, JSON.stringify(defaults, null, 2) + '\n', 'utf-8');
  return { created: true, path: file };
}

export function writeGlobalConfig(model: { baseURL: string; model: string; apiKey: string }): void {
  const dir = globalConfigDir();
  const file = globalConfigPath();
  fs.mkdirSync(dir, { recursive: true });

  let existing: Record<string, any> = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* overwrite */ }
  }
  existing.model = model;
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

export function loadConfigDetailed(configPath?: string): ConfigLoadResult {
  const sources: string[] = [];

  const { created: createdDefault, path: globalPath } = ensureGlobalDefault();

  const merged: Record<string, any> = {};

  if (fs.existsSync(globalPath)) {
    deepMerge(merged, readJson(globalPath));
    sources.push(globalPath);
  }

  const projectPath = projectConfigPath();
  if (fs.existsSync(projectPath) && projectPath !== globalPath) {
    deepMerge(merged, readJson(projectPath));
    sources.push(projectPath);
  }

  if (configPath) {
    const explicit = path.resolve(configPath);
    if (!fs.existsSync(explicit)) {
      throw new Error(`Config file not found: ${explicit}`);
    }
    deepMerge(merged, readJson(explicit));
    if (!sources.includes(explicit)) sources.push(explicit);
  }

  if (!merged.model || typeof merged.model !== 'object') {
    merged.model = { ...DEFAULT_MODEL };
  } else {
    merged.model = { ...DEFAULT_MODEL, ...merged.model };
  }
  if (!merged.mcpServers || typeof merged.mcpServers !== 'object') {
    merged.mcpServers = {};
  }

  return {
    config: merged as AgentConfig,
    sources,
    createdDefault,
  };
}

export function loadConfig(configPath?: string): AgentConfig {
  return loadConfigDetailed(configPath).config;
}

export function resolveConfigPath(configPath?: string): string | null {
  if (configPath) {
    const explicit = path.resolve(configPath);
    return fs.existsSync(explicit) ? explicit : null;
  }
  const project = projectConfigPath();
  if (fs.existsSync(project)) return project;
  const global = globalConfigPath();
  if (fs.existsSync(global)) return global;
  return null;
}
