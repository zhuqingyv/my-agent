import type { Message, ThinkingState } from './types.js';

export interface UiState {
  messages: Message[];
  thinking: ThinkingState | null;
  inFlightText: string;
}

type Listener = () => void;

const TOKEN_FLUSH_INTERVAL_MS = 16;

export function createUiStore() {
  let state: UiState = { messages: [], thinking: null, inFlightText: '' };
  const listeners = new Set<Listener>();

  let tokenBuffer = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function notify() {
    listeners.forEach((l) => l());
  }

  function flushTokenBuffer() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (tokenBuffer.length === 0) return;
    state = { ...state, inFlightText: state.inFlightText + tokenBuffer };
    tokenBuffer = '';
    notify();
  }

  return {
    getState: () => state,
    subscribe: (fn: Listener) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    pushMessage(msg: Message) {
      flushTokenBuffer();
      state = { ...state, messages: [...state.messages, msg] };
      notify();
    },

    startThinking() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      tokenBuffer = '';
      state = {
        ...state,
        thinking: {
          active: true,
          event: '思考中',
          toolName: null,
          startedAt: Date.now(),
        },
        inFlightText: '',
      };
      notify();
    },

    updateThinking(patch: Partial<ThinkingState>) {
      if (!state.thinking) return;
      state = { ...state, thinking: { ...state.thinking, ...patch } };
      notify();
    },

    stopThinking() {
      flushTokenBuffer();
      state = { ...state, thinking: null };
      notify();
    },

    appendToken(text: string) {
      tokenBuffer += text;
      if (flushTimer) return;
      flushTimer = setTimeout(flushTokenBuffer, TOKEN_FLUSH_INTERVAL_MS);
    },

    flushInFlight(): string {
      flushTokenBuffer();
      const text = state.inFlightText;
      state = { ...state, inFlightText: '' };
      notify();
      return text;
    },

    clearMessages() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      tokenBuffer = '';
      state = { ...state, messages: [], inFlightText: '' };
      notify();
    },
  };
}

export type UiStore = ReturnType<typeof createUiStore>;
