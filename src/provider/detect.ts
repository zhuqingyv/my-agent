import type { ModelConfig } from '../mcp/types.js';
import type { ProviderCodec } from './types.js';
import { createDeepSeekCodec } from './codecs/deepseek.js';
import { openaiCodec } from './codecs/openai.js';

function isDeepSeekBaseURL(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return url.hostname === 'api.deepseek.com' || url.hostname.endsWith('.deepseek.com');
  } catch {
    return baseURL.includes('api.deepseek.com');
  }
}

export function resolveProviderCodec(model: ModelConfig): ProviderCodec {
  const provider = model.provider?.toLowerCase();
  if (provider === 'deepseek') return createDeepSeekCodec(model);
  if (provider === 'openai') return openaiCodec;
  if (isDeepSeekBaseURL(model.baseURL)) return createDeepSeekCodec(model);
  return openaiCodec;
}
