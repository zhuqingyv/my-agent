import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ProviderCodec } from '../types.js';

function stripProviderFields(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  if ((message as any).reasoning_content === undefined) return message;
  const copy: Record<string, unknown> = { ...(message as any) };
  delete copy.reasoning_content;
  return copy as unknown as ChatCompletionMessageParam;
}

export const openaiCodec: ProviderCodec = {
  name: 'openai',
  encodeMessages(messages) {
    return messages.map(stripProviderFields);
  },
  shouldStoreReasoningContent() {
    return false;
  },
};
