import { generateKeyBetween } from "fractional-indexing";

type Positioned = { id: string; pos: string };

/**
 * Compute a fractional-index position that places an item after `afterId`
 * (or first, when null) within `siblings`, which must be sorted by pos and
 * must not contain the item being moved.
 */
export function posAfter(siblings: Positioned[], afterId: string | null) {
  if (afterId === null) {
    return generateKeyBetween(null, siblings[0]?.pos ?? null);
  }
  const i = siblings.findIndex((s) => s.id === afterId);
  if (i === -1) return posAtEnd(siblings);
  return generateKeyBetween(siblings[i]!.pos, siblings[i + 1]?.pos ?? null);
}

export function posAtEnd(siblings: Positioned[]) {
  return generateKeyBetween(siblings.at(-1)?.pos ?? null, null);
}

/** Generate n ascending keys, used by importers. */
export function sequentialKeys(n: number) {
  const keys: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    prev = generateKeyBetween(prev, null);
    keys.push(prev);
  }
  return keys;
}
