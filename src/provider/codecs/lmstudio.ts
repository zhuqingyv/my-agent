import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { ProviderCodec } from '../types.js';
import { stripProviderFields } from './openai.js';

const DATA_IMAGE_PREFIX = /^data:image\/[^;]+;base64,/i;

function normalizeLmStudioImages(message: ChatCompletionMessageParam): ChatCompletionMessageParam {
  const stripped = stripProviderFields(message) as Record<string, any>;
  const content = stripped.content;
  if (!Array.isArray(content)) return stripped as unknown as ChatCompletionMessageParam;

  return {
    ...stripped,
    content: content.map((part) => {
      if (
        part?.type !== 'image_url' ||
        typeof part?.image_url?.url !== 'string'
      ) {
        return part;
      }
      return {
        ...part,
        image_url: {
          ...part.image_url,
          url: part.image_url.url.replace(DATA_IMAGE_PREFIX, ''),
        },
      };
    }),
  } as unknown as ChatCompletionMessageParam;
}

export const lmStudioCodec: ProviderCodec = {
  name: 'lmstudio',
  encodeMessages(messages) {
    return messages.map(normalizeLmStudioImages);
  },
  shouldStoreReasoningContent() {
    return false;
  },
};
