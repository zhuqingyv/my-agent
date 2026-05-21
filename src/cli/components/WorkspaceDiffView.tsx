import React from 'react';
import { Box, Text } from 'ink';
import pico from 'picocolors';
import type { WorkspaceDiffFile } from '../../agent/events.js';
import { DiffBlock } from './DiffBlock.js';

interface WorkspaceDiffViewProps {
  files: WorkspaceDiffFile[];
  truncated: boolean;
}

export function WorkspaceDiffView({ files, truncated }: WorkspaceDiffViewProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="cyan" bold>
        Changed files: {files.length}{truncated ? ' +' : ''}
      </Text>
      {files.map((file) => (
        <Box key={file.filePath} flexDirection="column">
          <Text>
            {statusColor(file.status)(statusLabel(file.status))} {file.filePath}{' '}
            {pico.green(`+${file.addedLines}`)} {pico.red(`-${file.removedLines}`)}
            {file.truncated ? ` ${pico.yellow('(truncated)')}` : ''}
          </Text>
          <DiffBlock diff={file} />
        </Box>
      ))}
    </Box>
  );
}

function statusLabel(status: WorkspaceDiffFile['status']): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  return 'M';
}

function statusColor(status: WorkspaceDiffFile['status']): (value: string) => string {
  if (status === 'added') return pico.green;
  if (status === 'deleted') return pico.red;
  return pico.yellow;
}
