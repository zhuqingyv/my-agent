import React from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

interface CodeBlockProps {
  lang?: string;
  text: string;
}

export function CodeBlock({ lang, text }: CodeBlockProps) {
  let highlighted: string;
  try {
    highlighted = highlight(text, { language: lang || 'plaintext', ignoreIllegals: true });
  } catch {
    highlighted = text;
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      {lang && <Text dimColor>{lang}</Text>}
      <Text>{highlighted}</Text>
    </Box>
  );
}
