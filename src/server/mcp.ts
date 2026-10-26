import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createCaller } from "~/server/api/root";
import { db } from "~/server/db";

type User = { id: string; name: string | null; email: string | null; image: string | null };

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }] });
const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const when = z.string().describe("ISO 8601 date or date-time, e.g. 2026-11-01 or 2026-11-01T17:00:00Z. null clears it.");
function toDate(v: string | null | undefined) {
  if (v == null) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${v}`);
  return d;
}

/**
 * Hackban's MCP tools. Each one goes through the tRPC routers as `user`, so it
 * gets exactly the same permission checks, activity log and live updates as the web app.
 */
export function hackbanMcp(user: User, base: string) {
  // Site-admin powers stay in the browser; connected apps act as a regular member.
  const api = createCaller({ db, session: { user: { ...user, isAdmin: false }, expires: "" }, headers: new Headers(), clientId: undefined, tzOffset: 0 });
  const abs = (u: string) => (u.startsWith("/") ? base + u : u);

  const server = new McpServer(
    { name: "hackban", title: "Hackban", version: "1.0.0" },
    {
      instructions:
        "Hackban is Hack Club's Trello: workspaces contain boards, boards contain lists, lists contain cards. " +
        "Find things with list_workspaces or search, then get_board for list, label and member IDs. " +
        "Every board and card has a url; link to it when telling the user about it.",
    },
  );

  server.registerTool("whoami", { title: "Who am I", description: "The Hackban user this connection acts as.", annotations: read }, async () => {
    const { id, name, email, username } = await api.me.profile();
    return text({ id, name, email, username });
  });

  server.registerTool(
    "list_workspaces",
    { title: "List workspaces", description: "Your workspaces and the open boards in each.", annotations: read },
    async () =>
      text(
        (await api.workspace.list()).map((w) => ({
          id: w.id,
          name: w.name,
          boards: w.boards.map((b) => ({ id: b.id, name: b.name, starred: b.starred, url: `${base}/b/${b.id}` })),
        })),
      ),
  );

  server.registerTool(
    "search",
    { title: "Search", description: "Search board names and card titles/descriptions.", inputSchema: { query: z.string().min(2) }, annotations: read },
    async ({ query }) => {
      const r = await api.search.query({ q: query });
      return text({
        boards: r.boards.map((b) => ({ id: b.id, name: b.name, url: `${base}/b/${b.id}` })),
        cards: r.cards.map((c) => ({ id: c.id, title: c.title, archived: c.closed, board: c.list.board.name, list: c.list.name, url: `${base}/c/${c.id}` })),
      });
    },
  );

  server.registerTool(
    "get_board",
    {
      title: "Get board",
      description: "A board's open lists and cards, plus its labels and members (with the IDs other tools need).",
      inputSchema: { boardId: z.string() },
      annotations: read,
    },
    async ({ boardId }) => {
      const b = await api.board.get({ id: boardId });
      return text({
        id: b.id,
        name: b.name,
        url: `${base}/b/${b.id}`,
        workspace: b.workspace,
        myRole: b.myRole,
        labels: b.labels.map(({ id, name, color }) => ({ id, name, color })),
        members: b.members.map((m) => ({ id: m.user.id, name: m.user.name, username: m.user.username, role: m.role })),
        lists: b.lists.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color ?? undefined,
          cards: l.cards.map((c) => ({
            id: c.id,
            title: c.title,
            due: c.due ?? undefined,
            dueComplete: c.due ? c.dueComplete : undefined,
            labels: c.labels.length ? c.labels.map(({ label }) => label.name || label.color) : undefined,
            members: c.members.length ? c.members.map(({ user }) => user.name) : undefined,
            checklist: c.checkTotal ? `${c.checkDone}/${c.checkTotal}` : undefined,
            comments: c._count.comments || undefined,
          })),
        })),
      });
    },
  );

  server.registerTool(
    "get_card",
    { title: "Get card", description: "Everything on a card: description, dates, labels, members, checklists, attachments, comments.", inputSchema: { cardId: z.string() }, annotations: read },
    async ({ cardId }) => {
      const c = await api.card.get({ id: cardId });
      return text({
        id: c.id,
        title: c.title,
        url: `${base}/c/${c.id}`,
        board: { id: c.list.boardId, name: c.list.board.name },
        list: { id: c.list.id, name: c.list.name },
        description: c.description,
        start: c.start,
        due: c.due,
        dueComplete: c.dueComplete,
        recurrence: c.recurrence,
        archived: c.closed,
        labels: c.labels.map(({ label }) => ({ id: label.id, name: label.name, color: label.color })),
        members: c.members.map(({ user }) => ({ id: user.id, name: user.name })),
        checklists: c.checklists.map((cl) => ({
          id: cl.id,
          name: cl.name,
          items: cl.items.map((i) => ({ id: i.id, name: i.name, complete: i.complete })),
        })),
        attachments: c.attachments.map((a) => ({ name: a.name, url: abs(a.url) })),
        comments: c.comments.map((m) => ({ id: m.id, author: m.author.name, text: m.text, at: m.createdAt })),
      });
    },
  );

  server.registerTool(
    "my_cards",
    { title: "My cards", description: "Open cards you're a member of, soonest due first.", annotations: read },
    async () =>
      text(
        (await api.me.cards()).map((c) => ({
          id: c.id,
          title: c.title,
          due: c.due ?? undefined,
          dueComplete: c.due ? c.dueComplete : undefined,
          board: c.list.board.name,
          list: c.list.name,
          labels: c.labels.length ? c.labels.map(({ label }) => label.name || label.color) : undefined,
          url: `${base}/c/${c.id}`,
        })),
      ),
  );

  server.registerTool(
    "create_board",
    {
      title: "Create board",
      description: "Create a board in a workspace. The basic template adds To Do / Doing / Done lists.",
      inputSchema: {
        workspaceId: z.string(),
        name: z.string().min(1).max(200),
        visibility: z.enum(["private", "workspace", "public"]).default("workspace"),
        template: z.enum(["empty", "basic"]).default("basic"),
      },
      annotations: write,
    },
    async (input) => {
      const b = await api.board.create(input);
      return text({ id: b.id, url: `${base}/b/${b.id}` });
    },
  );

  server.registerTool(
    "create_list",
    { title: "Create list", description: "Add a list to the end of a board.", inputSchema: { boardId: z.string(), name: z.string().min(1).max(512) }, annotations: write },
    async (input) => text({ id: (await api.list.create(input)).id }),
  );

  server.registerTool(
    "update_list",
    {
      title: "Update list",
      description: "Rename a list, set its color (green, yellow, orange, red, purple, blue, sky, lime, pink, black; null clears it), or archive/restore it.",
      inputSchema: { listId: z.string(), name: z.string().min(1).max(512).optional(), color: z.string().max(32).nullable().optional(), archived: z.boolean().optional() },
      annotations: write,
    },
    async ({ listId, name, color, archived }) => {
      const l = await api.list.update({ id: listId, name, color, closed: archived });
      return text({ id: l.id, name: l.name, color: l.color, archived: l.closed });
    },
  );

  server.registerTool(
    "create_card",
    {
      title: "Create card",
      description: "Add a card to a list.",
      inputSchema: {
        listId: z.string(),
        title: z.string().min(1).max(16384),
        description: z.string().max(16384).optional().describe("Markdown"),
        due: when.optional(),
        position: z.enum(["top", "bottom"]).default("bottom"),
      },
      annotations: write,
    },
    async ({ listId, title, description, due, position }) => {
      const card = await api.card.create({ listId, title, afterId: position === "top" ? null : undefined });
      if (description !== undefined || due) await api.card.update({ id: card.id, description, due: toDate(due) });
      return text({ id: card.id, url: `${base}/c/${card.id}` });
    },
  );

  server.registerTool(
    "update_card",
    {
      title: "Update card",
      description: "Change a card's title, description, dates or completion, or archive/restore it. Omitted fields are left alone.",
      inputSchema: {
        cardId: z.string(),
        title: z.string().min(1).max(16384).optional(),
        description: z.string().max(16384).optional().describe("Markdown; replaces the whole description"),
        start: when.nullable().optional(),
        due: when.nullable().optional(),
        dueComplete: z.boolean().optional().describe("Mark the due date done. Repeating cards roll to their next due date instead."),
        archived: z.boolean().optional(),
      },
      annotations: write,
    },
    async ({ cardId, start, due, archived, ...rest }) => {
      const c = await api.card.update({ id: cardId, ...rest, start: toDate(start), due: toDate(due), closed: archived });
      return text({ id: c.id, title: c.title, due: c.due, dueComplete: c.dueComplete, archived: c.closed, url: `${base}/c/${c.id}` });
    },
  );

  server.registerTool(
    "move_card",
    {
      title: "Move card",
      description: "Move a card to a list (on this board or another). Moving to another board drops its labels.",
      inputSchema: {
        cardId: z.string(),
        listId: z.string(),
        afterCardId: z.string().nullable().optional().describe("Place after this card; null = top of the list; omit = bottom"),
      },
      annotations: write,
    },
    async ({ cardId, listId, afterCardId }) => {
      const afterId =
        afterCardId !== undefined
          ? afterCardId
          : ((await db.card.findFirst({ where: { listId, closed: false, id: { not: cardId } }, orderBy: { pos: "desc" }, select: { id: true } }))?.id ?? null);
      const c = await api.card.move({ id: cardId, listId, afterId });
      return text({ id: c.id, list: c.list.name, url: `${base}/c/${c.id}` });
    },
  );

  server.registerTool(
    "add_comment",
    { title: "Comment on card", description: "Post a comment (Markdown) on a card as you.", inputSchema: { cardId: z.string(), text: z.string().min(1).max(16384) }, annotations: write },
    async ({ cardId, text: body }) => text({ id: (await api.card.addComment({ id: cardId, text: body })).id }),
  );

  server.registerTool(
    "set_card_label",
    {
      title: "Set card label",
      description: "Add or remove one of the board's labels (IDs from get_board) on a card.",
      inputSchema: { cardId: z.string(), labelId: z.string(), on: z.boolean() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ cardId, labelId, on }) => {
      await api.card.toggleLabel({ id: cardId, labelId, on });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "set_card_member",
    {
      title: "Set card member",
      description: "Assign or unassign a board member (IDs from get_board or whoami) on a card.",
      inputSchema: { cardId: z.string(), userId: z.string(), on: z.boolean() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ cardId, userId, on }) => {
      await api.card.toggleMember({ id: cardId, userId, on });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "add_checklist",
    {
      title: "Add checklist",
      description: "Add a checklist, optionally with items, to a card.",
      inputSchema: { cardId: z.string(), name: z.string().min(1).max(512), items: z.array(z.string().min(1).max(16384)).max(100).default([]) },
      annotations: write,
    },
    async ({ cardId, name, items }) => {
      const cl = await api.card.addChecklist({ id: cardId, name });
      // In order: each item goes to the end of the list.
      for (const item of items) await api.card.addCheckItem({ checklistId: cl.id, name: item });
      return text({ id: cl.id });
    },
  );

  server.registerTool(
    "update_check_item",
    {
      title: "Update checklist item",
      description: "Tick/untick or rename a checklist item (IDs from get_card).",
      inputSchema: { itemId: z.string(), complete: z.boolean().optional(), name: z.string().min(1).max(16384).optional() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ itemId, ...rest }) => {
      await api.card.updateCheckItem({ itemId, ...rest });
      return text({ ok: true });
    },
  );

  return server;
}
