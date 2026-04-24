import React from 'react';
import { Box, Text } from 'ink';

interface SeparatorProps {
  elapsed: string;
}

export function Separator({ elapsed }: SeparatorProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text dimColor>✱ 完成 ({elapsed})</Text>
      <Text dimColor>{'─'.repeat(60)}</Text>
    </Box>
  );
}
