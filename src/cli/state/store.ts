import type { Message, ThinkingState } from './types.js';

export interface UiState {
  messages: Message[];
  thinking: ThinkingState | null;
  inFlightText: string;
}

type Listener = () => void;

export function createUiStore() {
  let state: UiState = { messages: [], thinking: null, inFlightText: '' };
  const listeners = new Set<Listener>();

  function notify() {
    listeners.forEach((l) => l());
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
      state = { ...state, messages: [...state.messages, msg] };
      notify();
    },

    startThinking() {
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
      state = { ...state, thinking: null };
      notify();
    },

    appendToken(text: string) {
      state = { ...state, inFlightText: state.inFlightText + text };
      notify();
    },

    flushInFlight(): string {
      const text = state.inFlightText;
      state = { ...state, inFlightText: '' };
      notify();
      return text;
    },

    clearMessages() {
      state = { ...state, messages: [], inFlightText: '' };
      notify();
    },
  };
}

export type UiStore = ReturnType<typeof createUiStore>;
