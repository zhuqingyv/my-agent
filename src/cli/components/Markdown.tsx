import React from 'react';
import { Box, Text } from 'ink';
import type { Token, Tokens } from 'marked';
import { lexMarkdown } from '../utils/markdown-lex.js';
import { CodeBlock } from './CodeBlock.js';

interface MarkdownProps {
  source: string;
}

export function Markdown({ source }: MarkdownProps) {
  const tokens = lexMarkdown(source);
  return (
    <Box flexDirection="column">
      {tokens.map((tok, i) => (
        <BlockToken key={i} token={tok} />
      ))}
    </Box>
  );
}

function BlockToken({ token }: { token: Token }) {
  switch (token.type) {
    case 'heading': {
      const t = token as Tokens.Heading;
      return (
        <Box flexDirection="column" marginY={1}>
          <Text bold>
            <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
          </Text>
        </Box>
      );
    }
    case 'paragraph': {
      const t = token as Tokens.Paragraph;
      return (
        <Box marginBottom={1}>
          <Text>
            <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
          </Text>
        </Box>
      );
    }
    case 'code': {
      const t = token as Tokens.Code;
      return <CodeBlock lang={t.lang} text={t.text} />;
    }
    case 'list': {
      const t = token as Tokens.List;
      return (
        <Box flexDirection="column" marginBottom={1}>
          {t.items.map((item, idx) => {
            const bullet = t.ordered ? `${(Number(t.start) || 1) + idx}.` : '-';
            return (
              <Box key={idx}>
                <Text>{bullet} </Text>
                <Box flexDirection="column">
                  {item.tokens.map((child, ci) => (
                    <ListItemChild key={ci} token={child} />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      );
    }
    case 'table': {
      const t = token as Tokens.Table;
      const headerLine = t.header.map((c) => c.text).join(' │ ');
      const divider = '─'.repeat(headerLine.length);
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{headerLine}</Text>
          <Text dimColor>{divider}</Text>
          {t.rows.map((row, ri) => (
            <Text key={ri}>{row.map((c) => c.text).join(' │ ')}</Text>
          ))}
        </Box>
      );
    }
    case 'hr':
      return <Text dimColor>{'─'.repeat(60)}</Text>;
    case 'blockquote': {
      const t = token as Tokens.Blockquote;
      return (
        <Box paddingLeft={2} marginBottom={1}>
          <Text dimColor>{t.text}</Text>
        </Box>
      );
    }
    case 'space':
      return null;
    default: {
      const anyTok = token as Tokens.Generic;
      if (typeof anyTok.text === 'string') {
        return <Text>{anyTok.text}</Text>;
      }
      return null;
    }
  }
}

function ListItemChild({ token }: { token: Token }) {
  if (token.type === 'text') {
    const t = token as Tokens.Text;
    return (
      <Text>
        <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
      </Text>
    );
  }
  return <BlockToken token={token} />;
}

function InlineTokens({ tokens, fallback }: { tokens: Token[]; fallback?: string }) {
  if (!tokens || tokens.length === 0) {
    return <>{fallback ?? ''}</>;
  }
  return (
    <>
      {tokens.map((tok, i) => (
        <InlineToken key={i} token={tok} />
      ))}
    </>
  );
}

function InlineToken({ token }: { token: Token }) {
  switch (token.type) {
    case 'strong': {
      const t = token as Tokens.Strong;
      return (
        <Text bold>
          <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
        </Text>
      );
    }
    case 'em': {
      const t = token as Tokens.Em;
      return (
        <Text italic>
          <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
        </Text>
      );
    }
    case 'codespan': {
      const t = token as Tokens.Codespan;
      return <Text color="cyan">{t.text}</Text>;
    }
    case 'del': {
      const t = token as Tokens.Del;
      return (
        <Text strikethrough>
          <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
        </Text>
      );
    }
    case 'link': {
      const t = token as Tokens.Link;
      return (
        <Text color="blue" underline>
          <InlineTokens tokens={t.tokens ?? []} fallback={t.text} />
        </Text>
      );
    }
    case 'br':
      return <Text>{'\n'}</Text>;
    case 'escape': {
      const t = token as Tokens.Escape;
      return <Text>{t.text}</Text>;
    }
    case 'text': {
      const t = token as Tokens.Text;
      if (t.tokens && t.tokens.length > 0) {
        return <InlineTokens tokens={t.tokens} fallback={t.text} />;
      }
      return <Text>{t.text}</Text>;
    }
    default: {
      const anyTok = token as Tokens.Generic;
      if (typeof anyTok.text === 'string') {
        return <Text>{anyTok.text}</Text>;
      }
      return null;
    }
  }
}
