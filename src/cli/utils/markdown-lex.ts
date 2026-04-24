import { lexer, type Token, type TokensList } from 'marked';

export function lexMarkdown(src: string): TokensList {
  return lexer(src);
}

export type { Token, TokensList };
