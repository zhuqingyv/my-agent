import React from 'react';
import { Static } from 'ink';
import type { Message } from '../state/types.js';
import { MessageView } from './MessageView.js';

interface ChatHistoryProps {
  messages: Message[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  return (
    <Static items={messages}>
      {(msg) => <MessageView key={msg.id} message={msg} />}
    </Static>
  );
}
