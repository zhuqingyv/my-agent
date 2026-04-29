import type { SoftAssertion, SoftResult, RunTrace } from '../types.js';
import { M1_SOFT_TYPES } from '../types.js';

export function evaluateSoft(
  assertions: SoftAssertion[],
  trace: RunTrace
): SoftResult[] {
  return assertions.map((assertion) => {
    if (!M1_SOFT_TYPES.has(assertion.type)) {
      return { assertion, score: null, weight: assertion.weight };
    }

    let score: number;

    switch (assertion.type) {
      case 'final_text_min_len': {
        const len = trace.finalText.length;
        score = assertion.chars <= 0 ? 1 : Math.min(1, len / assertion.chars);
        break;
      }
      case 'tool_call_count_max': {
        const count = trace.toolCalls.length;
        if (count === 0) {
          score = assertion.max > 0 ? 1 : 0;
        } else {
          score = Math.min(1, assertion.max / count);
        }
        break;
      }
      case 'duration_max': {
        const elapsed = trace.elapsedMs;
        if (elapsed <= 0) {
          score = 1;
        } else {
          score = Math.min(1, assertion.ms / elapsed);
        }
        break;
      }
      default: {
        return { assertion, score: null, weight: assertion.weight };
      }
    }

    return { assertion, score, weight: assertion.weight };
  });
}
