import React from 'react';
import { Text } from 'ink';

interface StatusBarProps {
  model: string;
  taskCount?: number;
  debug?: boolean;
}

export function StatusBar({ model, taskCount, debug }: StatusBarProps) {
  return (
    <Text dimColor>
      {'  '}Ctrl+V 图片 · ESC 中断 · /quit 退出
      {taskCount ? ` · tasks: ${taskCount}` : ''}
      {debug ? ' · 🔧 debug' : ''}
    </Text>
  );
}
