export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  prompt: string;
  reason?: string;
  parentId?: string;
  status: TaskStatus;
  result?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  messageAnchor: number;
  depth: number;
}

export interface TaskStackPushInput {
  prompt: string;
  reason?: string;
  parentId?: string;
  messageAnchor: number;
}

export interface TaskStack {
  push(input: TaskStackPushInput): Task;
  pop(): Task | null;
  peek(): Task | null;
  size(): number;
  pending(): Task[];
  current(): Task | null;
  markDone(id: string, result: string): void;
  markFailed(id: string, error: string): void;
  history(limit?: number): Task[];
  clear(): void;
  abortAll(): number;
  completed(limit?: number): Task[];
}

const MAX_TASKS = 50;
const MAX_DEPTH = 8;
const RESULT_LIMIT = 500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n);
}

export function createTaskStack(): TaskStack {
  const pendingStack: Task[] = [];
  const completedList: Task[] = [];
  const byId = new Map<string, Task>();
  let currentTask: Task | null = null;
  let idCounter = 0;

  function nextId(): string {
    idCounter += 1;
    return `t_${idCounter}`;
  }

  function computeDepth(parentId?: string): number {
    if (!parentId) return 0;
    const parent = byId.get(parentId);
    if (!parent) return 0;
    return parent.depth + 1;
  }

  function push(input: TaskStackPushInput): Task {
    if (pendingStack.length >= MAX_TASKS) {
      throw new Error(
        `TaskStack: pending task limit reached (max=${MAX_TASKS})`
      );
    }
    const depth = computeDepth(input.parentId);
    if (depth >= MAX_DEPTH) {
      throw new Error(
        `TaskStack: max depth reached (max=${MAX_DEPTH})`
      );
    }
    const task: Task = {
      id: nextId(),
      prompt: input.prompt,
      reason: input.reason,
      parentId: input.parentId,
      status: 'pending',
      createdAt: Date.now(),
      messageAnchor: input.messageAnchor,
      depth,
    };
    pendingStack.push(task);
    byId.set(task.id, task);
    return task;
  }

  function pop(): Task | null {
    const task = pendingStack.pop();
    if (!task) return null;
    task.status = 'running';
    task.startedAt = Date.now();
    currentTask = task;
    return task;
  }

  function peek(): Task | null {
    return pendingStack.length > 0
      ? pendingStack[pendingStack.length - 1]
      : null;
  }

  function size(): number {
    return pendingStack.length;
  }

  function pending(): Task[] {
    return pendingStack.slice();
  }

  function current(): Task | null {
    return currentTask;
  }

  function markDone(id: string, result: string): void {
    const task = byId.get(id);
    if (!task) return;
    task.status = 'done';
    task.result = truncate(result, RESULT_LIMIT);
    task.finishedAt = Date.now();
    completedList.push(task);
    if (currentTask && currentTask.id === id) currentTask = null;
  }

  function markFailed(id: string, error: string): void {
    const task = byId.get(id);
    if (!task) return;
    task.status = 'failed';
    task.result = truncate(error, RESULT_LIMIT);
    task.finishedAt = Date.now();
    completedList.push(task);
    if (currentTask && currentTask.id === id) currentTask = null;
  }

  function history(limit?: number): Task[] {
    const reversed = completedList.slice().reverse();
    if (limit === undefined) return reversed;
    return reversed.slice(0, limit);
  }

  function clear(): void {
    pendingStack.length = 0;
    completedList.length = 0;
    byId.clear();
    currentTask = null;
    idCounter = 0;
  }

  function abortAll(): number {
    const count = pendingStack.length;
    pendingStack.length = 0;
    return count;
  }

  function completed(limit?: number): Task[] {
    if (limit === undefined) return completedList.slice();
    if (limit <= 0) return [];
    return completedList.slice(-limit);
  }

  return {
    push,
    pop,
    peek,
    size,
    pending,
    current,
    markDone,
    markFailed,
    history,
    clear,
    abortAll,
    completed,
  };
}
