import { type TrelloAction, type TrelloBoard, type TrelloMember } from "./types";

export type TrelloCreds = { key: string; token: string };

const BASE = "https://api.trello.com/1";

async function get<T>(creds: TrelloCreds, p: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + p);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", creds.key);
  url.searchParams.set("token", creds.token);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Trello ${p}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
}

export function me(creds: TrelloCreds) {
  return get<TrelloMember>(creds, "/members/me", { fields: "fullName,username,avatarUrl" });
}

export type TrelloBoardSummary = {
  id: string;
  name: string;
  closed: boolean;
  idOrganization: string | null;
  prefs: { backgroundColor: string | null; backgroundImage: string | null };
};

export async function listBoards(creds: TrelloCreds) {
  const [boards, orgs] = await Promise.all([
    get<TrelloBoardSummary[]>(creds, "/members/me/boards", { filter: "all", fields: "name,closed,idOrganization,prefs" }),
    get<{ id: string; displayName: string }[]>(creds, "/members/me/organizations", { fields: "displayName" }),
  ]);
  return { boards, orgs };
}

export async function fetchBoard(creds: TrelloCreds, id: string): Promise<TrelloBoard> {
  const board = await get<TrelloBoard>(creds, `/boards/${id}`, {
    fields: "name,desc,closed,idOrganization,prefs",
    lists: "all",
    cards: "all",
    card_attachments: "true",
    labels: "all",
    labels_limit: "1000",
    checklists: "all",
    members: "all",
    member_fields: "fullName,username,avatarUrl",
  });
  // Comments are paginated separately; the board endpoint caps actions.
  const actions: TrelloAction[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await get<TrelloAction[]>(creds, `/boards/${id}/actions`, {
      filter: "commentCard",
      limit: "1000",
      memberCreator_fields: "fullName,username,avatarUrl",
      ...(before ? { before } : {}),
    });
    actions.push(...page);
    if (page.length < 1000) break;
    before = page.at(-1)!.id;
  }
  board.actions = actions;
  return board;
}

const MAX_DOWNLOAD = 250 * 1024 * 1024;

/** Hosts Trello serves attachment downloads from (the OAuth header only goes to trello.com). */
function trelloHost(u: URL) {
  const h = u.hostname.toLowerCase();
  if (h === "trello.com" || h.endsWith(".trello.com")) return "trello";
  if (h === "trello-attachments.s3.amazonaws.com" || h.endsWith(".trellocdn.com")) return "cdn";
  return null;
}

/**
 * Download a Trello-hosted attachment. URLs come from (possibly uploaded)
 * board JSON, so only https Trello hosts are allowed and every redirect hop is
 * re-checked: otherwise this is an SSRF that serves the response back to us.
 */
export async function downloadAttachment(creds: TrelloCreds, url: string) {
  let target = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    const kind = trelloHost(target);
    if (target.protocol !== "https:" || !kind) throw new Error("not a Trello attachment URL");
    const res = await fetch(target, {
      redirect: "manual",
      headers: kind === "trello" ? { Authorization: `OAuth oauth_consumer_key="${creds.key}", oauth_token="${creds.token}"` } : {},
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      target = new URL(res.headers.get("location")!, target);
      continue;
    }
    if (!res.ok) throw new Error(`download ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_DOWNLOAD) throw new Error("file too large");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_DOWNLOAD) throw new Error("file too large");
    return buf;
  }
  throw new Error("too many redirects");
}
