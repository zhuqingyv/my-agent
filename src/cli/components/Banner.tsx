import React from 'react';
import { Box, Text } from 'ink';

interface BannerProps {
  model: string;
  baseURL: string;
  mcp: Array<{ name: string; toolCount: number }>;
}

export function Banner({ model, baseURL, mcp }: BannerProps) {
  const mcpStr =
    mcp.map((m) => `${m.name}(${m.toolCount})`).join(', ') || '(none)';
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {'  '}<Text bold color="cyan">MA</Text><Text dimColor>  v1.0.0</Text>
      </Text>
      <Text dimColor>
        {'  '}model: <Text bold color="white">{model}</Text> <Text dimColor>· {baseURL}</Text>
      </Text>
      <Text dimColor>
        {'  '}mcp:   <Text color="green">{mcpStr}</Text>
      </Text>
    </Box>
  );
}
