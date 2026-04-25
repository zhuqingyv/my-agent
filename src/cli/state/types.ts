export interface UiImage {
  path: string;
  size: number;
}

export interface BannerData {
  model: string;
  baseURL: string;
  mcp: Array<{ name: string; toolCount: number }>;
}

export type Message =
  | { kind: 'user'; id: string; text: string; images?: UiImage[] }
  | { kind: 'assistant'; id: string; markdown: string; elapsedMs: number }
  | { kind: 'tool'; id: string; name: string; ok: boolean; preview: string }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'separator'; id: string; elapsed: string }
  | { kind: 'banner'; id: string; data: BannerData };

export interface ThinkingState {
  active: boolean;
  event: string;
  toolName: string | null;
  startedAt: number;
  isThinking?: boolean;
  thoughtDurationMs?: number | null;
}
