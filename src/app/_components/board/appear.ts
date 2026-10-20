// Decides whether a card or list should play its "pop in" animation.
//
// Local additions animate on their optimistic temp row; when the server's row
// replaces it we must not animate a second time, so names created in this tab
// are remembered briefly. Rows added by someone else (arriving via realtime)
// animate if they are brand new.

const localNames = new Set<string>();
const FRESH_MS = 5000;
const pageLoadedAt = typeof window === "undefined" ? 0 : Date.now();

export function rememberLocal(name: string) {
  localNames.add(name);
  setTimeout(() => localNames.delete(name), FRESH_MS);
}

export function shouldAppear(id: string, name: string, createdAt: Date) {
  if (id.startsWith("temp-")) return true;
  if (localNames.has(name)) return false;
  const t = createdAt.getTime();
  return t > pageLoadedAt && Date.now() - t < FRESH_MS;
}
