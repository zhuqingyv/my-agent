export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoList {
  add(text: string): TodoItem;
  complete(id: string): boolean;
  remove(id: string): boolean;
  list(): TodoItem[];
  format(): string;
}

export function createTodoList(): TodoList {
  const items: TodoItem[] = [];
  let counter = 0;

  return {
    add(text: string): TodoItem {
      const item: TodoItem = {
        id: `t${++counter}`,
        text,
        done: false,
      };
      items.push(item);
      return item;
    },
    complete(id: string): boolean {
      const item = items.find((x) => x.id === id);
      if (!item) return false;
      item.done = true;
      return true;
    },
    remove(id: string): boolean {
      const idx = items.findIndex((x) => x.id === id);
      if (idx < 0) return false;
      items.splice(idx, 1);
      return true;
    },
    list(): TodoItem[] {
      return [...items];
    },
    format(): string {
      if (items.length === 0) return '(empty)';
      return items
        .map((x) => `[${x.done ? 'x' : ' '}] ${x.id} ${x.text}`)
        .join('\n');
    },
  };
}
