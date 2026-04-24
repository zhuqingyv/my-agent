import React, { useState, useCallback } from 'react';
import * as path from 'node:path';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { UiImage } from '../state/types.js';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  pendingImages?: UiImage[];
}

export function InputBox({ onSubmit, disabled, pendingImages }: InputBoxProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed && (!pendingImages || pendingImages.length === 0)) return;
      setValue('');
      onSubmit(trimmed);
    },
    [onSubmit, pendingImages]
  );

  return (
    <Box flexDirection="column">
      {pendingImages && pendingImages.length > 0 ? (
        <Box paddingX={1} marginBottom={0}>
          {pendingImages.map((img, i) => (
            <Text key={i} color="yellow">
              📎 {path.basename(img.path)} ({Math.round(img.size / 1024)}KB){' '}
            </Text>
          ))}
          <Text dimColor>(Ctrl+X 清除)</Text>
        </Box>
      ) : null}
      <Box borderStyle="single" borderColor="magenta" paddingX={1}>
        <Text color="magenta">❯ </Text>
        {disabled ? (
          <Text dimColor>thinking...</Text>
        ) : (
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
          />
        )}
      </Box>
    </Box>
  );
}
