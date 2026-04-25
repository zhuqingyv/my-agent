import React, { useState, useCallback } from 'react';
import * as path from 'node:path';
import { Box, Text } from 'ink';
import { CustomTextInput } from './CustomTextInput.js';
import type { UiImage } from '../state/types.js';

interface InputBoxProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  pendingImages?: UiImage[];
}

const PASTE_JUNK = /\[200~|\[201~|\x1b\[200~|\x1b\[201~/g;

export function InputBox({ onSubmit, disabled, pendingImages }: InputBoxProps) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState('');

  const handleChange = useCallback((newVal: string) => {
    const clean = newVal.replace(PASTE_JUNK, '');
    setValue(clean);
  }, []);

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.replace(PASTE_JUNK, '').trim();
      if (!trimmed && (!pendingImages || pendingImages.length === 0)) return;
      if (trimmed) {
        setHistory((prev) => [...prev, trimmed]);
      }
      setHistoryIndex(-1);
      setSavedInput('');
      setValue('');
      onSubmit(trimmed);
    },
    [onSubmit, pendingImages]
  );

  const handleHistoryUp = useCallback(() => {
    if (history.length === 0) return;
    if (historyIndex === -1) {
      setSavedInput(value);
    }
    const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
    setHistoryIndex(newIndex);
    handleChange(history[newIndex]);
  }, [history, historyIndex, value, handleChange]);

  const handleHistoryDown = useCallback(() => {
    if (historyIndex === -1) return;
    if (historyIndex >= history.length - 1) {
      setHistoryIndex(-1);
      handleChange(savedInput);
    } else {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      handleChange(history[newIndex]);
    }
  }, [history, historyIndex, savedInput, handleChange]);

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
          <CustomTextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="输入消息或 /help 查看命令"
            disabled={disabled}
            onHistoryUp={handleHistoryUp}
            onHistoryDown={handleHistoryDown}
          />
        )}
      </Box>
    </Box>
  );
}
