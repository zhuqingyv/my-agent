import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { globalConfigDir, globalConfigPath } from './config.js';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

function isMaInstalled(): boolean {
  try {
    execSync('which ma', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function installMa(): boolean {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  try {
    console.log(`${C.dim}Installing 'ma' command globally...${C.reset}`);
    execSync('npm run build', { cwd: projectRoot, stdio: 'pipe' });
    execSync('npm link', { cwd: projectRoot, stdio: 'pipe' });
    return true;
  } catch (err) {
    console.error(`${C.red}Failed to install: ${(err as Error).message}${C.reset}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--');
  let baseURL: string;
  let model: string;
  let apiKey: string;

  if (args.length >= 2) {
    baseURL = args[0];
    model = args[1];
    apiKey = args[2] || 'lm-studio';
  } else {
    const rl = readline.createInterface({ input, output });
    console.log(`${C.bold}my-agent init${C.reset}\n`);
    baseURL = await rl.question(`${C.cyan}Model API base URL ${C.dim}(http://localhost:1234/v1)${C.reset}: `) || 'http://localhost:1234/v1';
    model = await rl.question(`${C.cyan}Model name ${C.dim}(qwen3-30b-a3b)${C.reset}: `) || 'qwen3-30b-a3b';
    apiKey = await rl.question(`${C.cyan}API key ${C.dim}(lm-studio)${C.reset}: `) || 'lm-studio';
    rl.close();
  }

  // ensure baseURL has /v1 suffix
  if (!baseURL.endsWith('/v1')) {
    baseURL = baseURL.replace(/\/$/, '') + '/v1';
  }

  const projectRoot = path.resolve(import.meta.dirname, '..');
  const execMcp = path.join(projectRoot, 'src', 'mcp-servers', 'exec.ts');
  const fsMcp = path.join(projectRoot, 'src', 'mcp-servers', 'fs.ts');

  const config: Record<string, any> = {
    model: { baseURL, model, apiKey },
    mcpServers: {
      exec: { command: 'tsx', args: [execMcp] },
      fs: { command: 'tsx', args: [fsMcp] },
    },
    systemPrompt: 'You are a helpful assistant. You can execute commands and read/write files using the available tools.',
  };

  const dir = globalConfigDir();
  const file = globalConfigPath();
  fs.mkdirSync(dir, { recursive: true });

  let existing: Record<string, any> = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* overwrite */ }
  }
  Object.assign(existing, config);

  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

  console.log(`${C.green}✓ Config saved to ~/.my-agent/config.json${C.reset}`);
  console.log(`${C.dim}  baseURL: ${baseURL}${C.reset}`);
  console.log(`${C.dim}  model:   ${model}${C.reset}`);
  console.log(`${C.dim}  exec:    ${execMcp}${C.reset}`);
  console.log(`${C.dim}  fs:      ${fsMcp}${C.reset}`);

  // check if ma CLI is globally installed
  if (isMaInstalled()) {
    console.log(`${C.green}✓ 'ma' command is available${C.reset}`);
  } else {
    console.log(`${C.yellow}⚠ 'ma' command not found globally${C.reset}`);
    if (installMa()) {
      console.log(`${C.green}✓ 'ma' command installed${C.reset}`);
    } else {
      console.log(`${C.yellow}  Run 'npm link' manually in the project directory${C.reset}`);
    }
  }

  console.log(`\n${C.bold}Ready! Run 'ma' to start chatting.${C.reset}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
