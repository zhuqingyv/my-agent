import React from 'react';
import { Text } from 'ink';

interface ToolProgressProps {
  name: string;
  ok: boolean;
  preview?: string;
}

export function ToolProgress({ name, ok, preview }: ToolProgressProps) {
  return (
    <Text>
      <Text dimColor>{'  '}</Text>
      {ok ? (
        <Text dimColor color="green">
          ✓ {name}
        </Text>
      ) : (
        <Text dimColor color="red">
          ✗ {preview || name}
        </Text>
      )}
    </Text>
  );
}
