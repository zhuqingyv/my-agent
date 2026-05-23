import React from 'react';
import { Box, Text } from 'ink';
import type { DiffData } from '../state/types.js';
import { buildDiffLines, type RenderDiffLine } from '../utils/diff-lines.js';

interface DiffBlockProps {
  diff: DiffData;
}

export function DiffBlock({ diff }: DiffBlockProps) {
  const lines = buildDiffLines(diff.diffText);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color="cyan">[file] {diff.filePath}</Text>
        <Text dimColor> +{diff.addedLines} / -{diff.removedLines}</Text>
      </Box>
      {lines.map((line, i) => (
        <DiffLine key={i} line={line} />
      ))}
    </Box>
  );
}

function DiffLine({ line }: { line: RenderDiffLine }) {
  if (line.kind === 'hunk') {
    return (
      <Box>
        <Text color="yellow">{line.content}</Text>
      </Box>
    );
  }
  if (line.kind === 'file') {
    return (
      <Box>
        <Text dimColor>{line.content}</Text>
      </Box>
    );
  }
  if (line.kind === 'meta') {
    return (
      <Box>
        <Text dimColor>{'     '}{line.content}</Text>
      </Box>
    );
  }

  const color = line.kind === 'add' ? 'green' : line.kind === 'del' ? 'red' : undefined;
  const oldNo = line.oldLine !== undefined ? String(line.oldLine).padStart(4, ' ') : '    ';
  const newNo = line.newLine !== undefined ? String(line.newLine).padStart(4, ' ') : '    ';

  return (
    <Box>
      <Text dimColor={line.kind === 'context'} color={color}>
        {oldNo} {newNo} {line.sign} {line.content}
      </Text>
    </Box>
  );
}
