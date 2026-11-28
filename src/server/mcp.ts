import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { sortCardLabels, sortLabels } from "~/lib/labels";
import { FLOW_ACTIONS, FLOW_TRIGGERS } from "~/lib/list-flow";
import { createCaller } from "~/server/api/root";
import { RECURRENCES } from "~/server/recurrence";
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
  const api = createCaller({ db, session: { user: { ...user, isAdmin: false, canImport: false }, expires: "" }, headers: new Headers(), clientId: undefined, tzOffset: 0 });
  const abs = (u: string) => (u.startsWith("/") ? base + u : u);

  const server = new McpServer(
    { name: "hackban", title: "Hackban", version: "1.0.0" },
    {
      instructions:
        "Hackban is Hack Club's Trello: workspaces contain boards, boards contain lists, lists contain cards. " +
        "Find things with list_workspaces or search, then get_board for list, label and member IDs. " +
        "Every board and card has a url; link to it when telling the user about it. " +
        "Nothing can be deleted here; archive cards, lists and boards instead.",
    },
  );

  server.registerTool("whoami", { title: "Who am I", description: "The Hackban user this connection acts as.", annotations: read }, async () => {
    const { id, name, email, username } = await api.me.profile();
    return text({ id, name, email, username });
  });

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "Your workspaces and the open boards in each, boards you're a guest on outside your workspaces, and (with includeArchived) your closed boards.",
      inputSchema: { includeArchived: z.boolean().default(false) },
      annotations: read,
    },
    async ({ includeArchived }) => {
      const board = (b: { id: string; name: string; starred?: boolean }) => ({ id: b.id, name: b.name, starred: b.starred ? true : undefined, url: `${base}/b/${b.id}` });
      return text({
        workspaces: (await api.workspace.list()).map((w) => ({ id: w.id, name: w.name, boards: w.boards.map(board) })),
        guestBoards: (await api.board.guestBoards()).map((b) => ({ ...board(b), workspace: b.workspace.name })),
        archivedBoards: includeArchived ? (await api.board.closed()).map((b) => ({ ...board(b), workspace: b.workspace.name })) : undefined,
      });
    },
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
        labels: sortLabels(b.labels).map(({ id, name, color }) => ({ id, name, color })),
        members: b.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          username: m.user.username,
          role: m.role,
          pending: m.user.isGhost ? (m.user.invitedEmail ? "invited, hasn't logged in" : "imported from Trello") : undefined,
        })),
        lists: b.lists.map((l) => ({
          id: l.id,
          name: l.name,
          description: l.description || undefined,
          color: l.color ?? undefined,
          automation:
            l.doneOnEnter || l.labelRules.length
              ? {
                  markDoneOnEnter: l.doneOnEnter || undefined,
                  labelRules: l.labelRules.length ? l.labelRules : undefined,
                }
              : undefined,
          cards: l.cards.map((c) => ({
            id: c.id,
            title: c.title,
            start: c.start ?? undefined,
            due: c.due ?? undefined,
            // Cards can be completed without a due date, so say so whenever it's true.
            dueComplete: c.dueComplete || undefined,
            labels: c.labels.length ? sortCardLabels(c.labels).map(({ label }) => label.name || label.color) : undefined,
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
        labels: sortCardLabels(c.labels).map(({ label }) => ({ id: label.id, name: label.name, color: label.color })),
        members: c.members.map(({ user }) => ({ id: user.id, name: user.name })),
        checklists: c.checklists.map((cl) => ({
          id: cl.id,
          name: cl.name,
          items: cl.items.map((i) => ({ id: i.id, name: i.name, complete: i.complete })),
        })),
        attachments: c.attachments.map((a) => ({ id: a.id, name: a.name, url: abs(a.url) })),
        cover: c.coverColor || c.coverAttachmentId ? { color: c.coverColor ?? undefined, attachmentId: c.coverAttachmentId ?? undefined, size: c.coverSize } : undefined,
        comments: c.comments.map((m) => ({ id: m.id, author: m.author.name, text: m.text, at: m.createdAt })),
        blockedBy: c.blockedBy.length ? c.blockedBy : undefined,
        blocking: c.blocking.length ? c.blocking : undefined,
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
          dueComplete: c.dueComplete || undefined,
          board: c.list.board.name,
          list: c.list.name,
          labels: c.labels.length ? sortCardLabels(c.labels).map(({ label }) => label.name || label.color) : undefined,
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
      description: "Rename a list, set its description (shown under its name), set its color (green, yellow, orange, red, purple, blue, sky, lime, pink, black; null clears it), archive/restore it, or set whether cards moved into it are marked complete.",
      inputSchema: {
        listId: z.string(),
        name: z.string().min(1).max(512).optional(),
        description: z.string().max(4096).optional(),
        color: z.string().max(32).nullable().optional(),
        archived: z.boolean().optional(),
        markDoneOnEnter: z.boolean().optional().describe("Mark cards complete when they're moved into this list"),
      },
      annotations: write,
    },
    async ({ listId, name, description, color, archived, markDoneOnEnter }) => {
      const l = await api.list.update({ id: listId, name, description, color, closed: archived, doneOnEnter: markDoneOnEnter });
      return text({ id: l.id, name: l.name, description: l.description, color: l.color, archived: l.closed, markDoneOnEnter: l.doneOnEnter });
    },
  );

  server.registerTool(
    "set_list_label_rule",
    {
      title: "Set list label automation",
      description:
        "Turn a list automation rule on or off: when a card is moved into (trigger enter) or out of (trigger leave) this list, add or remove one of the board's labels (IDs from get_board). Turning on add takes the same label off remove for that trigger, and vice versa. A card's old list's leave rules run before its new list's enter rules. get_board shows each list's rules.",
      inputSchema: {
        listId: z.string(),
        labelId: z.string(),
        trigger: z.enum(FLOW_TRIGGERS),
        action: z.enum(FLOW_ACTIONS),
        on: z.boolean(),
      },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ listId, ...rest }) => {
      await api.list.setLabelRule({ id: listId, ...rest });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "copy_list",
    { title: "Copy list", description: "Copy a list and its open cards to just after it on the same board.", inputSchema: { listId: z.string(), name: z.string().min(1).max(512) }, annotations: write },
    async ({ listId, name }) => text({ id: (await api.list.copy({ id: listId, name })).id }),
  );

  server.registerTool(
    "move_all_cards",
    {
      title: "Move all cards in list",
      description: "Move every open card in a list to the end of another list (on this board or another; moving boards drops their labels). The destination list's automation runs for each card; the source list's leave rules also run when both lists are on the same board.",
      inputSchema: { listId: z.string(), toListId: z.string() },
      annotations: write,
    },
    async ({ listId, toListId }) => {
      await api.list.moveAllCards({ id: listId, toListId });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "archive_all_cards",
    { title: "Archive all cards in list", description: "Archive every open card in a list (restore them with update_card).", inputSchema: { listId: z.string() }, annotations: write },
    async ({ listId }) => {
      await api.list.archiveAllCards({ id: listId });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "sort_list",
    {
      title: "Reorder list",
      description: "Put a list's cards in a new order. Pass its card IDs (from get_board) in the order you want; cards you leave out keep their order at the end.",
      inputSchema: { listId: z.string(), cardIds: z.array(z.string()).max(5000) },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ listId, cardIds }) => {
      await api.list.sortCards({ id: listId, ids: cardIds });
      return text({ ok: true });
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
      description: "Change a card's title, description, dates, completion or cover, or archive/restore it. Omitted fields are left alone.",
      inputSchema: {
        cardId: z.string(),
        title: z.string().min(1).max(16384).optional(),
        description: z.string().max(16384).optional().describe("Markdown; replaces the whole description"),
        start: when.nullable().optional(),
        due: when.nullable().optional(),
        dueComplete: z.boolean().optional().describe("Mark the due date done. Repeating cards roll to their next due date instead."),
        recurrence: z.enum(RECURRENCES).nullable().optional().describe("Repeat the card's dates on this schedule; null stops repeating"),
        coverColor: z.string().max(16).nullable().optional().describe("green, yellow, orange, red, purple, blue, sky, lime, pink or black; null removes a color cover"),
        coverAttachmentId: z.string().nullable().optional().describe("An image attachment (IDs from get_card) to use as the cover; null removes it"),
        coverSize: z.enum(["normal", "full"]).optional().describe("full = the cover fills the whole card front"),
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
      description: "Move a card to a list (on this board or another). Moving to another board drops its labels. The destination list's automation (labels added/removed, marked complete) runs; the old list's leave rules also run when both lists are on the same board.",
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
    "set_card_blocker",
    {
      title: "Set card blocker",
      description: "Mark a card as blocked by another card on the same board (it stays blocked until the blocker is completed or archived), or remove that.",
      inputSchema: { cardId: z.string().describe("The blocked card"), blockerCardId: z.string(), on: z.boolean() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ cardId, blockerCardId, on }) => {
      await api.card.setBlocker({ id: cardId, blockerId: blockerCardId, on });
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
      inputSchema: {
        itemId: z.string(),
        complete: z.boolean().optional(),
        name: z.string().min(1).max(16384).optional(),
        due: when.nullable().optional(),
        memberId: z.string().nullable().optional().describe("Board member to assign (IDs from get_board); null unassigns"),
      },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ itemId, due, ...rest }) => {
      await api.card.updateCheckItem({ itemId, ...rest, due: toDate(due) });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "add_check_item",
    {
      title: "Add checklist item",
      description: "Add an item to the end of an existing checklist (IDs from get_card).",
      inputSchema: { checklistId: z.string(), name: z.string().min(1).max(16384) },
      annotations: write,
    },
    async (input) => {
      await api.card.addCheckItem(input);
      return text({ ok: true });
    },
  );

  server.registerTool(
    "move_check_item",
    {
      title: "Move checklist item",
      description: "Reorder a checklist item, or move it to another checklist on the same card (IDs from get_card).",
      inputSchema: { itemId: z.string(), checklistId: z.string().describe("Target checklist (can be its current one)"), afterItemId: z.string().nullable().describe("Place after this item; null = first") },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ itemId, checklistId, afterItemId }) => {
      await api.card.moveCheckItem({ itemId, checklistId, afterId: afterItemId });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "rename_checklist",
    { title: "Rename checklist", description: "Rename a checklist (IDs from get_card).", inputSchema: { checklistId: z.string(), name: z.string().min(1).max(512) }, annotations: { ...write, idempotentHint: true } },
    async (input) => {
      await api.card.updateChecklist(input);
      return text({ ok: true });
    },
  );

  server.registerTool(
    "edit_comment",
    { title: "Edit comment", description: "Edit one of your own comments (IDs from get_card).", inputSchema: { commentId: z.string(), text: z.string().min(1).max(16384) }, annotations: { ...write, idempotentHint: true } },
    async (input) => {
      await api.card.editComment(input);
      return text({ ok: true });
    },
  );

  server.registerTool(
    "add_link",
    {
      title: "Attach link",
      description: "Attach an http(s) link to a card.",
      inputSchema: { cardId: z.string(), url: z.string().max(2048), name: z.string().max(256).optional() },
      annotations: write,
    },
    async ({ cardId, url, name }) => {
      await api.card.addLink({ id: cardId, url, name });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "rename_attachment",
    { title: "Rename attachment", description: "Rename a card attachment (IDs from get_card).", inputSchema: { attachmentId: z.string(), name: z.string().min(1).max(256) }, annotations: { ...write, idempotentHint: true } },
    async (input) => {
      await api.card.updateAttachment(input);
      return text({ ok: true });
    },
  );

  server.registerTool(
    "copy_card",
    {
      title: "Copy card",
      description: "Copy a card into a list (on this board or another). Labels only carry over within the same board.",
      inputSchema: {
        cardId: z.string(),
        listId: z.string(),
        title: z.string().min(1).max(16384).optional().describe("Defaults to the original title"),
        position: z.enum(["top", "bottom"]).default("bottom"),
        keepChecklists: z.boolean().default(true),
        keepLabels: z.boolean().default(true),
        keepMembers: z.boolean().default(true),
        keepAttachments: z.boolean().default(true),
      },
      annotations: write,
    },
    async ({ cardId, listId, title, position, keepChecklists, keepLabels, keepMembers, keepAttachments }) => {
      const c = await api.card.copy({
        id: cardId,
        listId,
        title: title ?? (await api.card.get({ id: cardId })).title,
        afterId: position === "top" ? null : undefined,
        keep: { checklists: keepChecklists, labels: keepLabels, members: keepMembers, attachments: keepAttachments },
      });
      return text({ id: c.id, url: `${base}/c/${c.id}` });
    },
  );

  server.registerTool(
    "watch_card",
    { title: "Watch card", description: "Get (or stop getting) notifications for comments on a card.", inputSchema: { cardId: z.string(), on: z.boolean() }, annotations: { ...write, idempotentHint: true } },
    async ({ cardId, on }) => {
      await api.card.watch({ id: cardId, on });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "move_list",
    {
      title: "Move list",
      description: "Reorder a list on its board, or move it (with its cards) to another board. Moving boards drops the cards' labels and the list automation's label rules (labels are per board); its mark-complete setting stays.",
      inputSchema: {
        listId: z.string(),
        boardId: z.string().optional().describe("Target board; omit to stay on this board"),
        afterListId: z.string().nullable().optional().describe("Place after this list; null = first; omit = last"),
      },
      annotations: write,
    },
    async ({ listId, boardId, afterListId }) => {
      // list.move checks access to both boards; this only picks the default slot.
      const to = boardId ?? (await db.list.findUniqueOrThrow({ where: { id: listId }, select: { boardId: true } })).boardId;
      const afterId =
        afterListId !== undefined
          ? afterListId
          : ((await db.list.findFirst({ where: { boardId: to, closed: false, id: { not: listId } }, orderBy: { pos: "desc" }, select: { id: true } }))?.id ?? null);
      const l = await api.list.move({ id: listId, boardId, afterId });
      return text({ id: l.id, boardId: l.boardId });
    },
  );

  server.registerTool(
    "save_label",
    {
      title: "Create or edit label",
      description: "Create a board label (it goes to the bottom of the board's label list), or rename/recolor one (pass labelId). Colors: green, yellow, orange, red, purple, blue, sky, lime, pink, black, each optionally with _light or _dark; null = no color.",
      inputSchema: { boardId: z.string(), labelId: z.string().optional(), name: z.string().max(100).default(""), color: z.string().max(32).nullable() },
      annotations: write,
    },
    async ({ boardId, labelId, name, color }) => {
      if (labelId) {
        await api.card.updateLabel({ id: labelId, name, color });
        return text({ id: labelId });
      }
      return text({ id: (await api.card.createLabel({ boardId, name, color })).id });
    },
  );

  server.registerTool(
    "reorder_labels",
    {
      title: "Reorder labels",
      description:
        "Set the order of a board's labels, top to bottom (label IDs from get_board). Every card shows its labels in this order. Labels you leave out keep their order after the ones you list.",
      inputSchema: { boardId: z.string(), labelIds: z.array(z.string()).max(1000) },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ boardId, labelIds }) => {
      await api.card.reorderLabels({ boardId, ids: labelIds });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "update_board",
    {
      title: "Update board",
      description:
        "Rename a board, change its description, visibility or background, star it for yourself, move it to another workspace, or archive (close)/reopen it. Visibility, moving and closing need board admin.",
      inputSchema: {
        boardId: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(16384).optional().describe("Markdown"),
        visibility: z.enum(["private", "workspace", "public"]).optional(),
        background: z.string().max(200).optional().describe("A hex color like #0079bf, or a CSS linear-gradient(...) of hex colors"),
        bgImage: z.string().max(2048).nullable().optional().describe("https URL of a background image; null removes it"),
        iconColor: z.string().nullable().optional().describe("Hex color like #0079bf for the board's browser tab icon; null = follow the background"),
        starred: z.boolean().optional().describe("Star or unstar it for you"),
        workspaceId: z.string().optional().describe("Move the board to this workspace"),
        archived: z.boolean().optional(),
      },
      annotations: write,
    },
    async ({ boardId, archived, starred, workspaceId, ...rest }) => {
      if (starred !== undefined) await api.board.star({ id: boardId, starred });
      if (workspaceId) await api.board.move({ id: boardId, workspaceId });
      const fields = { ...rest, closed: archived };
      const b = Object.values(fields).some((v) => v !== undefined) ? await api.board.update({ id: boardId, ...fields }) : await api.board.get({ id: boardId });
      return text({ id: b.id, name: b.name, visibility: b.visibility, archived: b.closed, url: `${base}/b/${b.id}` });
    },
  );

  server.registerTool(
    "copy_board",
    {
      title: "Copy board",
      description: "Copy a board (its lists and labels, and optionally its open cards) into a workspace.",
      inputSchema: { boardId: z.string(), name: z.string().min(1).max(200), workspaceId: z.string(), keepCards: z.boolean().default(true) },
      annotations: write,
    },
    async ({ boardId, ...rest }) => {
      const b = await api.board.copy({ id: boardId, ...rest });
      return text({ id: b.id, url: `${base}/b/${b.id}` });
    },
  );

  server.registerTool(
    "get_archived",
    { title: "Archived items", description: "A board's archived cards and lists (restore them with update_card / update_list).", inputSchema: { boardId: z.string() }, annotations: read },
    async ({ boardId }) => {
      const { cards, lists } = await api.board.archived({ id: boardId });
      return text({
        cards: cards.map((c) => ({ id: c.id, title: c.title, list: c.list.name, url: `${base}/c/${c.id}` })),
        lists: lists.map((l) => ({ id: l.id, name: l.name })),
      });
    },
  );

  server.registerTool(
    "board_activity",
    {
      title: "Board activity",
      description: "Recent activity on a board, newest first (30 per page).",
      inputSchema: { boardId: z.string(), cursor: z.string().optional().describe("`next` from the previous page") },
      annotations: read,
    },
    async ({ boardId, cursor }) => {
      const { items, next } = await api.board.activity({ id: boardId, cursor });
      return text({
        items: items.map((a) => ({ type: a.type, by: a.actor.name, card: a.card?.title, data: a.data, at: a.createdAt })),
        next,
      });
    },
  );

  server.registerTool(
    "get_workspace",
    { title: "Get workspace", description: "A workspace's members (with IDs and roles) and boards, including closed ones.", inputSchema: { workspaceId: z.string() }, annotations: read },
    async ({ workspaceId }) => {
      const w = await api.workspace.get({ id: workspaceId });
      return text({
        id: w.id,
        name: w.name,
        description: w.description,
        myRole: w.myRole,
        members: w.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.invitedEmail ?? m.user.email,
          role: m.role,
          pending: m.user.isGhost ? (m.user.invitedEmail ? "invited, hasn't logged in" : "imported from Trello") : undefined,
        })),
        boards: w.boards.map((b) => ({ id: b.id, name: b.name, visibility: b.visibility, archived: b.closed, url: `${base}/b/${b.id}` })),
      });
    },
  );

  server.registerTool(
    "create_workspace",
    { title: "Create workspace", description: "Create a workspace with you as its admin.", inputSchema: { name: z.string().min(1).max(100) }, annotations: write },
    async (input) => text({ id: (await api.workspace.create(input)).id }),
  );

  server.registerTool(
    "update_workspace",
    {
      title: "Update workspace",
      description: "Rename a workspace or change its description (workspace admins only).",
      inputSchema: { workspaceId: z.string(), name: z.string().min(1).max(100).optional(), description: z.string().max(2000).optional() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ workspaceId, ...rest }) => {
      await api.workspace.update({ id: workspaceId, ...rest });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "search_users",
    {
      title: "Search users",
      description: "Find people who have logged in to Hackban by name or username (or an exact email), to get the user IDs other tools take.",
      inputSchema: { query: z.string().min(2).max(100) },
      annotations: read,
    },
    async ({ query }) => text((await api.board.searchUsers({ q: query })).map(({ id, name, username, email }) => ({ id, name, username: username ?? undefined, email: email ?? undefined }))),
  );

  const invitee = {
    userId: z.string().optional().describe("Someone who has logged in (IDs from get_board or get_workspace)"),
    email: z.string().optional().describe("Or an email: they're added now and join for real when they first log in"),
  };

  server.registerTool(
    "add_board_member",
    {
      title: "Add board member",
      description: "Add someone to a board by user ID or email, or change a member's role (board admins only). Board-only: it doesn't add them to the workspace.",
      inputSchema: { boardId: z.string(), ...invitee, role: z.enum(["admin", "normal", "observer"]).default("normal") },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ boardId, ...rest }) => {
      await api.board.addMember({ id: boardId, ...rest });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "join_board",
    {
      title: "Join board",
      description: "Join a board you can see through its workspace (as a normal member), so you can be assigned to its cards.",
      inputSchema: { boardId: z.string() },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ boardId }) => {
      await api.board.join({ id: boardId });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "set_invite_link",
    {
      title: "Board invite link",
      description: "Turn a board's invite link on (anyone with it can join the board as the given role) or off, or reset it so the old link stops working. Board admins only.",
      inputSchema: { boardId: z.string(), enabled: z.boolean(), role: z.enum(["normal", "observer"]).optional(), reset: z.boolean().optional() },
      annotations: write,
    },
    async ({ boardId, ...rest }) => {
      const b = await api.board.setInviteLink({ id: boardId, ...rest });
      return text({ url: b.inviteToken ? `${base}/join/${b.inviteToken}` : null, role: b.inviteRole });
    },
  );

  server.registerTool(
    "join_by_invite",
    {
      title: "Join with invite link",
      description: "Join a board from an invite link someone gave you (the link or just its token).",
      inputSchema: { link: z.string().max(2048) },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ link }) => {
      const { boardId } = await api.board.joinByInvite({ token: link.trim().split("/").filter(Boolean).pop() ?? "" });
      return text({ boardId, url: `${base}/b/${boardId}` });
    },
  );

  server.registerTool(
    "add_workspace_member",
    {
      title: "Add workspace member",
      description: "Add someone to a workspace by user ID or email, or change a member's role (workspace admins only).",
      inputSchema: { workspaceId: z.string(), ...invitee, role: z.enum(["admin", "normal"]).default("normal") },
      annotations: { ...write, idempotentHint: true },
    },
    async ({ workspaceId, ...rest }) => {
      await api.workspace.addMember({ id: workspaceId, ...rest });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "notifications",
    {
      title: "Notifications",
      description: "Your latest 50 notifications (assignments, comments on watched cards). Pass markRead to mark them all read, or readIds to mark just those.",
      inputSchema: { markRead: z.boolean().default(false), readIds: z.array(z.string()).max(50).default([]) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ markRead, readIds }) => {
      const list = await api.notification.list();
      if (markRead) await api.notification.markAllRead();
      else for (const id of readIds) await api.notification.markRead({ id });
      return text(list.map((n) => ({ id: n.id, type: n.type, read: n.read, at: n.createdAt, ...n.data, url: n.data.cardId ? `${base}/c/${n.data.cardId}` : undefined })));
    },
  );

  server.registerTool(
    "update_profile",
    {
      title: "Update profile",
      description: "Change your display name or username (2–32 lowercase letters, numbers or underscores; null clears it).",
      inputSchema: { name: z.string().min(1).max(100).optional(), username: z.string().nullable().optional() },
      annotations: { ...write, idempotentHint: true },
    },
    async (input) => {
      await api.me.update(input);
      const { id, name, username } = await api.me.profile();
      return text({ id, name, username });
    },
  );

  server.registerTool(
    "my_activity",
    {
      title: "My activity",
      description: "What you've done across all boards, newest first (30 per page).",
      inputSchema: { cursor: z.string().optional().describe("`next` from the previous page") },
      annotations: read,
    },
    async ({ cursor }) => {
      const { items, next } = await api.me.activity({ cursor });
      return text({
        items: items.map((a) => ({ type: a.type, board: a.board?.name, card: a.card?.title, data: a.data, at: a.createdAt })),
        next,
      });
    },
  );

  return server;
}
