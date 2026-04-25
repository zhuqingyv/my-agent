import React, { useState, useEffect } from 'react';
import { Text, useInput } from 'ink';

interface CustomTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  history?: string[];
  onHistoryUp?: () => void;
  onHistoryDown?: () => void;
}

const PASTE_JUNK_RE = /\[200~|\[201~|\x1b\[200~|\x1b\[201~/g;

export function CustomTextInput({ value, onChange, onSubmit, placeholder, disabled, onHistoryUp, onHistoryDown }: CustomTextInputProps) {
  const [cursorPos, setCursorPos] = useState(value.length);

  useEffect(() => {
    setCursorPos((prev) => {
      if (value.length === 0) return 0;
      if (prev > value.length) return value.length;
      return prev;
    });
  }, [value]);

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      onSubmit?.(value);
      return;
    }

    if (key.leftArrow) {
      setCursorPos((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.rightArrow) {
      setCursorPos((prev) => Math.min(value.length, prev + 1));
      return;
    }

    if (key.ctrl && input === 'a') {
      setCursorPos(0);
      return;
    }

    if (key.ctrl && input === 'e') {
      setCursorPos(value.length);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorPos > 0) {
        const newVal = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
        onChange(newVal);
        setCursorPos((prev) => Math.max(0, prev - 1));
      }
      return;
    }

    if (key.ctrl && input === 'd') {
      if (cursorPos < value.length) {
        const newVal = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
        onChange(newVal);
      }
      return;
    }

    if (key.upArrow) {
      onHistoryUp?.();
      return;
    }
    if (key.downArrow) {
      onHistoryDown?.();
      return;
    }

    if (key.escape || key.tab) return;
    if (key.ctrl || key.meta) return;

    if (!input) return;

    const clean = input.replace(PASTE_JUNK_RE, '');
    if (clean.length === 0) return;

    const newVal = value.slice(0, cursorPos) + clean + value.slice(cursorPos);
    onChange(newVal);
    setCursorPos((prev) => Math.min(newVal.length, prev + clean.length));
  });

  if (disabled) {
    return <Text dimColor>{value || placeholder || ''}</Text>;
  }

  if (value.length === 0) {
    if (placeholder) {
      const first = placeholder[0] ?? ' ';
      const rest = placeholder.slice(1);
      return (
        <Text>
          <Text inverse dimColor>{first}</Text>
          <Text dimColor>{rest}</Text>
        </Text>
      );
    }
    return (
      <Text>
        <Text inverse> </Text>
      </Text>
    );
  }

  const safePos = Math.max(0, Math.min(value.length, cursorPos));
  const before = value.slice(0, safePos);
  const cursorChar = safePos < value.length ? value[safePos] : ' ';
  const after = safePos < value.length ? value.slice(safePos + 1) : '';

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  );
}
