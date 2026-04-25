export interface DangerResult {
  dangerous: boolean;
  reason?: string;
}

interface Rule {
  pattern: RegExp;
  reason: string;
}

const RULES: Rule[] = [
  { pattern: /\brm\s+(?:-[rRfF]+\s+)?\/(?:\s|$)/, reason: '删除根目录 /' },
  { pattern: /\brm\s+-[rRfF]+\s+~(?:\/|\s|$)/, reason: '删除 HOME 目录' },
  { pattern: /\brm\s+-[rRfF]+\s+\*/, reason: 'rm -rf 通配符，可能误删大量文件' },
  { pattern: /\bgit\s+push\s+.*(?:--force|--force-with-lease|-f\b)/, reason: 'git force push 会覆盖远端历史' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard 会丢弃未提交修改' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*[fFdD]/, reason: 'git clean 强制删除未跟踪文件' },
  { pattern: /\bchmod\s+-?[R]?\s*777\b/, reason: 'chmod 777 会开放全部权限' },
  { pattern: /\b(?:curl|wget)\s+[^|]*\|\s*(?:bash|sh|zsh)\b/, reason: '管道执行远端脚本，无法审计' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: '写入磁盘设备' },
  { pattern: /\bmkfs\./, reason: '格式化文件系统' },
  { pattern: /\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|disk)/, reason: 'dd 写入磁盘设备' },
  { pattern: /\bsudo\b/, reason: 'sudo 提权执行' },
];

const VAR_RM_RF = /\brm\s+-[rRfF]+\s+\S*\$/;

export function classifyCommand(cmd: string): DangerResult {
  if (typeof cmd !== 'string' || !cmd.trim()) {
    return { dangerous: false };
  }
  for (const rule of RULES) {
    if (rule.pattern.test(cmd)) {
      return { dangerous: true, reason: rule.reason };
    }
  }
  if (VAR_RM_RF.test(cmd)) {
    return { dangerous: true, reason: 'rm -rf 带变量展开，路径不可预测' };
  }
  return { dangerous: false };
}

export function isWhitelisted(cmd: string, allowList: string[] | undefined): boolean {
  if (!allowList || allowList.length === 0) return false;
  const trimmed = cmd.trim();
  for (const entry of allowList) {
    if (typeof entry !== 'string') continue;
    if (trimmed === entry.trim()) return true;
  }
  return false;
}
