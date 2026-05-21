/**
 * DiffBlock 组件 — 智能折叠 diff 显示
 *
 * 根据变更行数自动选择显示策略：
 * - ≤ 50 行：完整显示
 * - 51-200 行：摘要 + 前10行 + 折叠标记 + 后10行
 * - > 200 行：仅摘要框
 */

import React from 'react';
import { Box, Text } from 'ink';
import pico from 'picocolors';
import type { DiffData } from '../state/types.js';
import { buildDiffLines, truncateDiffContent, type RenderDiffLine } from '../utils/diff-lines.js';

interface DiffBlockProps {
  diff: DiffData;
}

/** 折叠标记 */
const COLLAPSE_MARKER = pico.yellow('  · · ·');

/** 最大显示行数（含上下文） */
const MAX_VISIBLE = 10;

export function DiffBlock({ diff }: DiffBlockProps) {
  const totalChanges = diff.addedLines + diff.removedLines;

  // === 策略 1: 大文件 → 仅摘要 ===
  if (totalChanges > 200) {
    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Box>
          <Text color="blue">{pico.blue('┌─')} {pico.blue('─'.repeat(58))} {pico.blue('┐')}</Text>
        </Box>
        <Box>
          <Text color="blue">{pico.blue('│')} {pico.dim('📝 ')} {pico.cyan(pico.bold(diff.filePath))} {pico.blue('│')}</Text>
        </Box>
        <Box>
          <Text color="blue">{pico.blue('│')} {pico.dim('   ')} {pico.green(`+${diff.addedLines}`)} {pico.dim('/')} {pico.red(`-${diff.removedLines}`)} {pico.dim('lines changed')} {pico.blue('│')}</Text>
        </Box>
        <Box>
          <Text color="blue">{pico.blue('│')} {pico.yellow('  ⚠ Full diff hidden (too large)')} {pico.blue('│')}</Text>
        </Box>
        <Box>
          <Text color="blue">{pico.blue('└─')} {pico.blue('─'.repeat(58))} {pico.blue('┘')}</Text>
        </Box>
      </Box>
    );
  }

  // === 策略 2: 中等文件 → 摘要 + 前N/后N行 ===
  if (totalChanges > 50) {
    const contentLines = buildDiffLines(diff.diffText);
    const half = Math.floor(MAX_VISIBLE / 2);
    const head = contentLines.slice(0, half);
    const tail = contentLines.slice(-half);
    const collapsed = Math.max(0, contentLines.length - head.length - tail.length);

    return (
      <Box flexDirection="column" marginTop={1} marginBottom={1}>
        <Box>
          <Text color="blue">{pico.blue('┌─')} {pico.blue('─'.repeat(58))} {pico.blue('┐')}</Text>
        </Box>
        <Box>
          <Text color="blue">{pico.blue('│')} {pico.dim('📝 ')} {pico.cyan(pico.bold(diff.filePath))} {pico.blue('│')}</Text>
        </Box>
        <Box>
          <Text color="blue">{pico.blue('│')} {pico.dim('   ')} {pico.green(`+${diff.addedLines}`)} {pico.dim('/')} {pico.red(`-${diff.removedLines}`)} {pico.dim('lines changed')} {pico.blue('│')}</Text>
        </Box>
        <Box flexDirection="column">
          {head.map((line, i) => (
            <DiffLine key={`h-${i}`} line={line} />
          ))}
          {collapsed > 0 && (
            <Box>
              <Text dimColor wrap="truncate-end">{COLLAPSE_MARKER} ({collapsed} lines collapsed) {COLLAPSE_MARKER}</Text>
            </Box>
          )}
          {tail.map((line, i) => (
            <DiffLine key={`t-${i}`} line={line} />
          ))}
        </Box>
        <Box>
          <Text color="blue">{pico.blue('└─')} {pico.blue('─'.repeat(58))} {pico.blue('┘')}</Text>
        </Box>
      </Box>
    );
  }

  // === 策略 3: 小文件 → 完整显示 ===
  const contentLines = buildDiffLines(diff.diffText);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color="blue">{pico.blue('┌─')} {pico.blue('─'.repeat(58))} {pico.blue('┐')}</Text>
      </Box>
      <Box>
        <Text color="blue">{pico.blue('│')} {pico.dim('📝 ')} {pico.cyan(pico.bold(diff.filePath))} {pico.blue('│')}</Text>
      </Box>
      <Box>
        <Text color="blue">{pico.blue('│')} {pico.dim('   ')} {pico.green(`+${diff.addedLines}`)} {pico.dim('/')} {pico.red(`-${diff.removedLines}`)} {pico.dim('lines changed')} {pico.blue('│')}</Text>
      </Box>
      <Box flexDirection="column">
        {contentLines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </Box>
      <Box>
        <Text color="blue">{pico.blue('└─')} {pico.blue('─'.repeat(58))} {pico.blue('┘')}</Text>
      </Box>
    </Box>
  );
}

function DiffLine({ line }: { line: RenderDiffLine }) {
  const oldLine = formatLineNo(line.oldLine);
  const newLine = formatLineNo(line.newLine);
  const content = truncateDiffContent(line.content);

  if (line.kind === 'file') {
    return (
      <Box>
        <Text color="cyan" dimColor wrap="truncate-end">{'     '}{content}</Text>
      </Box>
    );
  }
  if (line.kind === 'hunk') {
    return (
      <Box>
        <Text color="yellow" wrap="truncate-end">{'     '}{content}</Text>
      </Box>
    );
  }
  if (line.kind === 'meta') {
    return (
      <Box>
        <Text color="yellow" dimColor wrap="truncate-end">{'     '}{content}</Text>
      </Box>
    );
  }

  const color = line.kind === 'add' ? 'green' : line.kind === 'del' ? 'red' : undefined;
  const dim = line.kind === 'context';

  return (
    <Box>
      <Text dimColor>{oldLine}</Text>
      <Text dimColor>{' '}</Text>
      <Text dimColor>{newLine}</Text>
      <Text>{' '}</Text>
      <Text color={color} dimColor={dim}>{line.sign}</Text>
      <Text>{' '}</Text>
      <Text color={color} dimColor={dim} wrap="truncate-end">{content}</Text>
    </Box>
  );
}

function formatLineNo(value: number | undefined): string {
  return value === undefined ? '   ' : String(value).padStart(3, ' ');
}
