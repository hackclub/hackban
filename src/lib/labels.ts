// One label order everywhere: the board's label list, top to bottom. `pos` is
// a fractional-indexing key; labels never placed have "" and sort first, by
// color then name (so a board that was never reordered keeps its old order).

type Orderable = { id: string; pos: string; color: string | null; name: string };

const cmp = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

export const compareLabels = (a: Orderable, b: Orderable) => cmp(a.pos, b.pos) || cmp(a.color, b.color) || cmp(a.name, b.name) || cmp(a.id, b.id);

/** A board's labels, in board order. */
export const sortLabels = <T extends Orderable>(labels: readonly T[]) => [...labels].sort(compareLabels);

/** A card's labels (`{ label }` links), in board order. */
export const sortCardLabels = <T extends { label: Orderable }>(links: readonly T[]) => [...links].sort((a, b) => compareLabels(a.label, b.label));
