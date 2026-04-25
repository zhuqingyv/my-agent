import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface ThinkingBarProps {
  event: string;
  startedAt: number;
  thinking?: boolean;
  thoughtDurationMs?: number | null;
}

export function ThinkingBar({ event, startedAt, thinking, thoughtDurationMs }: ThinkingBarProps) {
  const [elapsed, setElapsed] = useState(
    Math.floor((Date.now() - startedAt) / 1000),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const thinkingLabel = thinking
    ? 'thinking'
    : thoughtDurationMs != null
      ? `thought for ${Math.max(1, Math.round(thoughtDurationMs / 1000))}s`
      : null;

  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text dimColor>
        {'  '}{event}  ·  {elapsed}s
        {thinkingLabel ? <Text color="magenta">  ·  {thinkingLabel}</Text> : null}
        {'  ·  ESC 中断'}
      </Text>
    </Box>
  );
}
