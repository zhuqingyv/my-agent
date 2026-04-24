import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function InputBox({ onSubmit, disabled }: InputBoxProps) {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setValue('');
      onSubmit(trimmed);
    },
    [onSubmit]
  );

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="cyan">❯ </Text>
      {disabled ? (
        <Text dimColor>(思考中...)</Text>
      ) : (
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
        />
      )}
    </Box>
  );
}
