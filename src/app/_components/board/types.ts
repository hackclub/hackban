import { type RouterOutputs } from "~/trpc/react";

export type BoardData = RouterOutputs["board"]["get"];
export type ListData = BoardData["lists"][number];
export type CardData = ListData["cards"][number];

export type Filters = {
  q: string;
  members: string[]; // "none" = no members
  labels: string[]; // "none" = no labels
  due: ("overdue" | "day" | "week" | "none" | "complete")[];
};

export const emptyFilters: Filters = { q: "", members: [], labels: [], due: [] };

export function filterActive(f: Filters) {
  return !!(f.q || f.members.length || f.labels.length || f.due.length);
}

export function cardMatches(c: CardData, f: Filters) {
  if (f.q && !c.title.toLowerCase().includes(f.q.toLowerCase())) return false;
  if (f.members.length) {
    const ids = c.members.map((m) => m.userId);
    if (!f.members.some((m) => (m === "none" ? ids.length === 0 : ids.includes(m)))) return false;
  }
  if (f.labels.length) {
    const ids = c.labels.map((l) => l.labelId);
    if (!f.labels.some((l) => (l === "none" ? ids.length === 0 : ids.includes(l)))) return false;
  }
  if (f.due.length) {
    const now = Date.now();
    const t = c.due?.getTime();
    const ok = f.due.some((d) => {
      if (d === "none") return !c.due;
      if (d === "complete") return !!c.due && c.dueComplete;
      if (!t || c.dueComplete) return false;
      if (d === "overdue") return t < now;
      if (d === "day") return t >= now && t < now + 864e5;
      return t >= now && t < now + 7 * 864e5;
    });
    if (!ok) return false;
  }
  return true;
}

const byTitle = (a: CardData, b: CardData) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
const dueTime = (c: CardData) => c.due?.getTime() ?? Infinity;
const dueDay = (c: CardData) => (c.due ? new Date(c.due).setHours(0, 0, 0, 0) : Infinity);
type Cmp = (a: CardData, b: CardData) => number;
/** [label, comparator, coarser comparator that assignee grouping breaks ties within (defaults to the comparator)] */
export const SORTS: [string, Cmp, Cmp?][] = [
  // Cards only show the day, so grouping treats same-day cards as tied.
  ["Due date (soonest first)", (a, b) => dueTime(a) - dueTime(b) || byTitle(a, b), (a, b) => dueDay(a) - dueDay(b)],
  ["Name (A–Z)", byTitle],
  ["Name (Z–A)", (a, b) => byTitle(b, a)],
  ["Newest first", (a, b) => b.createdAt.getTime() - a.createdAt.getTime()],
  ["Oldest first", (a, b) => a.createdAt.getTime() - b.createdAt.getTime()],
  ["Most members first", (a, b) => b.members.length - a.members.length],
];

const assignees = (c: CardData) => c.members.map((m) => m.userId).sort().join();
/** Sorts by the chosen sort first; with `group`, cards it ranks equal sit together by assignees (shared prefixes stay adjacent). */
export function sortCards(cards: CardData[], [, cmp, coarse = cmp]: (typeof SORTS)[number], group: boolean) {
  return [...cards].sort(group ? (a, b) => coarse(a, b) || assignees(a).localeCompare(assignees(b)) || cmp(a, b) : cmp);
}
