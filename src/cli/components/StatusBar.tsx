import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  model: string;
  taskCount?: number;
  debug?: boolean;
}

export function StatusBar({ model, taskCount, debug }: StatusBarProps) {
  return (
    <Box>
      <Text dimColor>
        {model}
        {taskCount ? `  ·  tasks: ${taskCount}` : ''}
        {debug ? '  ·  🔧 debug' : ''}
      </Text>
    </Box>
  );
}
