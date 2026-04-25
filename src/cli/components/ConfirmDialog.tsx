import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface ConfirmDialogProps {
  cmd: string;
  reason: string;
  onConfirm: (approved: boolean) => void;
}

export function ConfirmDialog({ cmd, reason, onConfirm }: ConfirmDialogProps) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onConfirm(true);
      return;
    }
    if (input === 'n' || input === 'N' || key.escape) {
      onConfirm(false);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        ⚠ 危险命令需要确认
      </Text>
      <Box marginTop={1}>
        <Text>$ </Text>
        <Text color="red">{cmd}</Text>
      </Box>
      <Text dimColor>{reason}</Text>
      <Box marginTop={1}>
        <Text>按 </Text>
        <Text color="green" bold>y</Text>
        <Text> 执行 / </Text>
        <Text color="red" bold>n</Text>
        <Text> 或 </Text>
        <Text bold>Esc</Text>
        <Text> 取消</Text>
      </Box>
    </Box>
  );
}
