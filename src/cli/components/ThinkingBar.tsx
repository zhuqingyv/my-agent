import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface ThinkingBarProps {
  event: string;
  startedAt: number;
}

export function ThinkingBar({ event, startedAt }: ThinkingBarProps) {
  const [elapsed, setElapsed] = useState(
    Math.floor((Date.now() - startedAt) / 1000),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text dimColor>
        {'  '}
        {event}  ·  {elapsed}s  ·  ESC 中断
      </Text>
    </Box>
  );
}
