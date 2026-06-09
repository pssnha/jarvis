/** Shared helpers for the hour-by-hour time grid (calendar + vacation itinerary). */

export const HOUR_PX = 56;
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function hourLabel(h: number): string {
  return `${h < 10 ? '0' : ''}${h}:00`;
}

/** Minutes from midnight for a local ISO string ("yyyy-MM-ddTHH:mm"). */
export function minutesOf(localIso: string): number {
  const t = localIso.split('T')[1] ?? '00:00';
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export interface LaidOutBlock<T> {
  o: T;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
}

/**
 * Assign side-by-side columns to overlapping blocks so they don't cover each
 * other. The caller supplies each block's start/end minutes (handling any
 * per-item duration rules); this only does the overlap layout.
 */
export function layoutColumns<T>(
  entries: { o: T; startMin: number; endMin: number }[],
): LaidOutBlock<T>[] {
  const blocks: LaidOutBlock<T>[] = entries
    .map((e) => ({ ...e, col: 0, cols: 1 }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  let cluster: LaidOutBlock<T>[] = [];
  let cols: LaidOutBlock<T>[][] = [];
  let lastEnd = -1;
  const flush = () => {
    for (const b of cluster) b.cols = cols.length || 1;
    cluster = [];
    cols = [];
    lastEnd = -1;
  };
  for (const b of blocks) {
    if (cluster.length && b.startMin >= lastEnd) flush();
    let placed = false;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!;
      if (col[col.length - 1]!.endMin <= b.startMin) {
        col.push(b);
        b.col = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      cols.push([b]);
      b.col = cols.length - 1;
    }
    cluster.push(b);
    lastEnd = Math.max(lastEnd, b.endMin);
  }
  flush();
  return blocks;
}
