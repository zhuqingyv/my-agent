import React from 'react';
import { Text } from 'ink';

interface StatusBarProps {
  model: string;
  taskCount?: number;
  debug?: boolean;
  contextUsed?: number;
  contextTotal?: number;
}

export function StatusBar({ model, taskCount, debug, contextUsed, contextTotal }: StatusBarProps) {
  let ctxLabel = '';
  if (contextUsed != null && contextTotal && contextTotal > 0) {
    const pct = Math.round((contextUsed / contextTotal) * 100);
    const color = pct > 75 ? 'red' : pct > 50 ? 'yellow' : undefined;
    ctxLabel = ` · ctx: ${Math.round(contextUsed / 1000)}k/${Math.round(contextTotal / 1000)}k (${pct}%)`;
    if (color) {
      return (
        <Text dimColor>
          {'  '}Ctrl+V 图片 · ESC 中断 · /quit 退出
          {taskCount ? ` · tasks: ${taskCount}` : ''}
          <Text color={color}>{ctxLabel}</Text>
          {debug ? ' · 🔧 debug' : ''}
        </Text>
      );
    }
  }

  return (
    <Text dimColor>
      {'  '}Ctrl+V 图片 · ESC 中断 · /quit 退出
      {taskCount ? ` · tasks: ${taskCount}` : ''}
      {ctxLabel}
      {debug ? ' · 🔧 debug' : ''}
    </Text>
  );
}
