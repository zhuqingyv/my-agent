const MAX_FILES = 10;
const MAX_HUNK = 50;
const MAX_DIFF = 300;
const MAX_COMMITS = 20;
const MAX_BODY = 3;
const MAX_SUBJ = 80;

export function compressGitOutput(subcommand: string, output: string): string {
  const raw = output ?? '';
  if (raw.trim() === '') return '(no output)';
  const cmd = subcommand.trim().toLowerCase();
  if (cmd === 'status') return compressGitStatus(raw);
  if (cmd === 'diff') return compressGitDiff(raw);
  if (cmd === 'log') return compressGitLog(raw);
  if (cmd === 'add' || cmd === 'commit' || cmd === 'push' || cmd === 'pull') return compressGitShort(cmd, raw);
  return raw;
}

function compressGitStatus(output: string): string {
  const lines = output.split('\n');
  const staged: string[] = [], modified: string[] = [], untracked: string[] = [], conflicts: string[] = [];
  const porcelain = lines.some(l => /^[ MADRCU?!][ MADRCU?!] /.test(l));
  if (porcelain) {
    for (const line of lines) {
      if (line.length < 3) continue;
      const x = line[0], y = line[1], file = line.slice(3);
      if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) conflicts.push(file);
      else if (x === '?' && y === '?') untracked.push(file);
      else {
        if (x !== ' ' && x !== '?') staged.push(file);
        if (y !== ' ' && y !== '?') modified.push(file);
      }
    }
  } else {
    let section: 'staged' | 'modified' | 'untracked' | null = null;
    for (const line of lines) {
      if (/^Changes to be committed/.test(line)) { section = 'staged'; continue; }
      if (/^Changes not staged/.test(line) || /^Changed but not updated/.test(line)) { section = 'modified'; continue; }
      if (/^Untracked files/.test(line)) { section = 'untracked'; continue; }
      const m = line.match(/^\s+(?:(?:new file|modified|deleted|renamed|copied|typechange|both modified|both added|both deleted):\s+)?(.+)$/);
      if (!m || !section) continue;
      const file = m[1].trim();
      if (!file || file.startsWith('(')) continue;
      (section === 'staged' ? staged : section === 'modified' ? modified : untracked).push(file);
    }
  }
  const groups: string[] = [];
  const fmt = (label: string, arr: string[]) => {
    if (arr.length === 0) return;
    const shown = arr.slice(0, MAX_FILES);
    const extra = arr.length > MAX_FILES ? `\n  ... +${arr.length - MAX_FILES} more` : '';
    groups.push(`${label} (${arr.length}):\n  ${shown.join('\n  ')}${extra}`);
  };
  fmt('staged', staged); fmt('modified', modified); fmt('untracked', untracked); fmt('conflicts', conflicts);
  return groups.length === 0 ? 'clean — nothing to commit' : groups.join('\n');
}

function compressGitDiff(output: string): string {
  const lines = output.split('\n');
  const out: string[] = [];
  let hunkLines = 0, added = 0, removed = 0, inHunk = false, truncated = 0;
  const flush = () => { if (truncated > 0) { out.push(`... (${truncated} lines truncated)`); truncated = 0; } };
  for (const line of lines) {
    if (line.startsWith('diff --git')) { flush(); out.push(line); inHunk = false; hunkLines = 0; continue; }
    if (line.startsWith('@@')) { flush(); out.push(line); inHunk = true; hunkLines = 0; continue; }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('index ') || line.startsWith('similarity ') ||
        line.startsWith('rename ') || line.startsWith('new file') || line.startsWith('deleted file') ||
        line.startsWith('old mode') || line.startsWith('new mode') || line.startsWith('Binary files')) {
      out.push(line); continue;
    }
    if (inHunk) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
      if (hunkLines < MAX_HUNK) { out.push(line); hunkLines++; } else truncated++;
    }
  }
  flush();
  let result = out;
  if (out.length > MAX_DIFF) {
    result = out.slice(0, MAX_DIFF);
    result.push(`... (${out.length - MAX_DIFF} lines truncated)`);
  }
  result.push(`+${added} -${removed}`);
  return result.join('\n');
}

function compressGitLog(output: string): string {
  const blocks = output.split(/\n(?=commit [0-9a-f]{7,})/);
  const commits: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const head = lines[0]?.match(/^commit ([0-9a-f]{7,})/);
    if (!head) continue;
    const hash = head[1].slice(0, 7);
    let author = '', date = '', subject = '', inBody = false;
    const body: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (!inBody) {
        if (l.startsWith('Author:')) { author = l.slice(7).trim(); continue; }
        if (l.startsWith('Date:')) { date = l.slice(5).trim(); continue; }
        if (l.startsWith('Merge:')) continue;
        if (l.trim() === '') { inBody = true; continue; }
      } else {
        const t = l.replace(/^\s{0,4}/, '');
        if (!subject) {
          if (t.trim() === '') continue;
          subject = t.length > MAX_SUBJ ? t.slice(0, MAX_SUBJ) + '…' : t;
          continue;
        }
        if (t.trim() === '' || /^Signed-off-by:/i.test(t) || /^Co-authored-by:/i.test(t)) continue;
        if (body.length < MAX_BODY) body.push(t);
      }
    }
    const parts = [`${hash} ${subject}`.trim()];
    if (date || author) parts.push(`  ${[date, author].filter(Boolean).join(' | ')}`);
    for (const b of body) parts.push(`  ${b}`);
    commits.push(parts.join('\n'));
    if (commits.length >= MAX_COMMITS) break;
  }
  return commits.length === 0 ? output : commits.join('\n\n');
}

function compressGitShort(subcommand: string, output: string): string {
  if (subcommand === 'add') return output.trim() === '' ? 'ok' : `ok (${output.trim().split('\n')[0]})`;
  if (subcommand === 'commit') {
    const m = output.match(/\[[^\]]*\s([0-9a-f]{7,})[^\]]*\]/);
    return m ? `ok ${m[1].slice(0, 7)}` : 'ok';
  }
  if (subcommand === 'push') {
    const m = output.match(/->\s+(\S+)/);
    return m ? `ok ${m[1]}` : 'ok';
  }
  if (subcommand === 'pull') {
    const changed = (output.match(/^\s*\S+\s+\|\s+\d+/gm) || []).length;
    return changed > 0 ? `ok (${changed} files changed)` : 'ok';
  }
  return output;
}
