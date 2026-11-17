/** 拖拽排序的公共计算：按行中点决定插入位置，避免必须拖过整行才换位 */

export interface DragRow {
  id: string;
  top: number;
  bottom: number;
}

export function readDragRows(
  container: HTMLElement | null,
  selector: string,
  idAttribute: string
): DragRow[] {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(selector)]
    .map((row) => {
      const rect = row.getBoundingClientRect();
      return { id: row.getAttribute(idAttribute) ?? "", top: rect.top, bottom: rect.bottom };
    })
    .filter((row) => row.id);
}

/** 返回重排后的新数组；位置未变化时返回原引用 */
export function reorderAtPointer<T extends { id: string }>(
  items: T[],
  id: string,
  pointerY: number,
  rows: DragRow[]
): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from === -1) return items;

  const others = rows.filter((row) => row.id !== id);
  let to = others.findIndex((row) => pointerY < (row.top + row.bottom) / 2);
  if (to === -1) to = others.length;
  if (to === from) return items;

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
