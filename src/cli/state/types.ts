export interface UiImage {
  path: string;
  size: number;
}

export type Message =
  | { kind: 'user'; id: string; text: string; images?: UiImage[] }
  | { kind: 'assistant'; id: string; markdown: string; elapsedMs: number }
  | { kind: 'tool'; id: string; name: string; ok: boolean; preview: string }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'separator'; id: string; elapsed: string };

export interface ThinkingState {
  active: boolean;
  event: string;
  toolName: string | null;
  startedAt: number;
}
