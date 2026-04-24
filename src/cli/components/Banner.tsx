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
      <Box borderStyle="round" borderColor="cyan" paddingX={2}>
        <Text bold color="cyan">
          my-agent
        </Text>
        <Text dimColor>  v1.0.0</Text>
      </Box>
      <Text dimColor>
        {'  '}model:  <Text bold>{model}</Text>  {baseURL}
      </Text>
      <Text dimColor>
        {'  '}mcp:    <Text color="green">{mcpStr}</Text>
      </Text>
    </Box>
  );
}
