import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ModelConfig } from '../../mcp/types.js';
import type { ParsedAssistantTurn, ProviderCodec } from '../types.js';

function isLegacyReasoner(model: ModelConfig): boolean {
  return model.model.toLowerCase() === 'deepseek-reasoner';
}

function stripReasoningContent(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  if ((message as any).reasoning_content === undefined) return message;
  const copy: Record<string, unknown> = { ...(message as any) };
  delete copy.reasoning_content;
  return copy as unknown as ChatCompletionMessageParam;
}

export function createDeepSeekCodec(model: ModelConfig): ProviderCodec {
  const legacyReasoner = isLegacyReasoner(model);

  return {
    name: 'deepseek',
    encodeMessages(messages) {
      if (legacyReasoner) {
        return messages.map(stripReasoningContent);
      }
      return messages;
    },
    shouldStoreReasoningContent(turn: ParsedAssistantTurn) {
      if (legacyReasoner) return false;
      return typeof turn.reasoningContent === 'string' && turn.reasoningContent.length > 0;
    },
  };
}
