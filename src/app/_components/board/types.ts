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
export const SORTS: [string, (a: CardData, b: CardData) => number][] = [
  ["Due date (soonest first)", (a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || byTitle(a, b)],
  ["Name (A–Z)", byTitle],
  ["Name (Z–A)", (a, b) => byTitle(b, a)],
  ["Newest first", (a, b) => b.createdAt.getTime() - a.createdAt.getTime()],
  ["Oldest first", (a, b) => a.createdAt.getTime() - b.createdAt.getTime()],
  ["Most members first", (a, b) => b.members.length - a.members.length],
];

/** Pulls cards with the same assignees together, keeping the existing order within and between groups (by first appearance). */
export function groupByAssignee(cards: CardData[]) {
  const key = (c: CardData) => c.members.map((m) => m.userId).sort().join();
  const first = new Map<string, number>();
  cards.forEach((c, i) => { if (!first.has(key(c))) first.set(key(c), i); });
  return [...cards].sort((a, b) => first.get(key(a))! - first.get(key(b))!);
}
