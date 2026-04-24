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

const PASTE_JUNK = /\[200~|\[201~|\x1b\[200~|\x1b\[201~/g;

export function InputBox({ onSubmit, disabled, pendingImages }: InputBoxProps) {
  const [value, setValue] = useState('');

  const handleChange = useCallback((newVal: string) => {
    const clean = newVal.replace(PASTE_JUNK, '');
    setValue(clean);
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.replace(PASTE_JUNK, '').trim();
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
            onChange={handleChange}
            onSubmit={handleSubmit}
          />
        )}
      </Box>
    </Box>
  );
}
