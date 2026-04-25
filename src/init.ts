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
    try {
      execSync('npm link', { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      console.log(`${C.dim}Retrying with sudo...${C.reset}`);
      execSync('sudo npm link', { cwd: projectRoot, stdio: 'inherit' });
    }
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
  const tsxBin = path.join(projectRoot, 'node_modules', '.bin', 'tsx');
  const execMcp = path.join(projectRoot, 'servers', 'exec-mcp.ts');
  const fsMcp = path.join(projectRoot, 'servers', 'fs-mcp.ts');
  const fsEditMcp = path.join(projectRoot, 'servers', 'fs-edit-mcp.ts');
  const grepMcp = path.join(projectRoot, 'servers', 'grep-mcp.ts');

  const config: Record<string, any> = {
    model: { baseURL, model, apiKey },
    mcpServers: {
      exec: { command: tsxBin, args: [execMcp] },
      fs: { command: tsxBin, args: [fsMcp] },
      'fs-edit': { command: tsxBin, args: [fsEditMcp] },
      grep: { command: tsxBin, args: [grepMcp] },
    },
    systemPrompt: '你是一个强大的本地 CLI 助手。你能执行命令、读写文件、分析项目。\n\n工作方式：\n- 收到任务后，必须先用工具收集信息（list_directory、read_file），然后再给出回答\n- 不要凭空猜测文件内容，先读再说\n- 分析项目时，至少读取目录结构和 package.json/README\n- 回答要有内容有深度，不要敷衍\n- 不要客套、不要套话\n- 中文问就用中文答\n\n工具使用规则：\n- 调用 read_file 时必须提供文件路径，例如 ./package.json\n- 调用 list_directory 时必须提供目录路径，用 . 表示当前目录\n- 调用 execute_command 时必须提供具体命令\n- 如果工具调用失败，换个方式重试而不是放弃\n- 不要复述任务栈状态，那是内部信息',
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

  console.log(`${C.green}✓ built-in output compression${C.reset}`);

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
