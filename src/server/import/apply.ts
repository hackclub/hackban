import { db } from "~/server/db";
import { DEFAULT_LABEL_COLORS } from "~/server/api/routers/board";
import { sequentialKeys } from "~/server/api/pos";
import { touch } from "~/server/api/access";
import { saveFile } from "~/server/storage";

import { downloadAttachment, type TrelloCreds } from "./trello-api";
import { type TrelloBoard, type TrelloMember } from "./types";

export type ImportStats = {
  board: string;
  boardId: string;
  lists: number;
  cards: number;
  labels: number;
  checklists: number;
  checkItems: number;
  comments: number;
  attachments: number;
  filesDownloaded: number;
  warnings: string[];
};

const byPos = <T extends { pos: number }>(a: T, b: T) => a.pos - b.pos;
const date = (s: string | null | undefined) => (s ? new Date(s) : null);

/**
 * Re-import support without cross-tenant takeover: a row is only reused when
 * it already belongs to the board being imported (`findScoped`). A Trello id
 * that exists anywhere else gets a fresh row with no trelloId, so an uploaded
 * JSON can never rewrite or re-parent someone else's data.
 */
async function scopedUpsert<T>(opts: {
  trelloId: string;
  findScoped: () => Promise<{ id: string } | null>;
  existsGlobally: () => Promise<number>;
  create: (trelloId: string | null) => Promise<T>;
  update: (id: string) => Promise<T>;
}): Promise<T> {
  const mine = await opts.findScoped();
  if (mine) return opts.update(mine.id);
  return opts.create((await opts.existsGlobally()) > 0 ? null : opts.trelloId);
}

/** Trello object ids embed their creation time in the first 8 hex chars. */
const createdAtFromId = (id: string) => new Date(parseInt(id.slice(0, 8), 16) * 1000);

async function ensureUser(m: TrelloMember, importerId: string, importerTrelloId: string | null) {
  if (m.id === importerTrelloId) return importerId;
  const existing = await db.user.findUnique({ where: { trelloId: m.id } });
  if (existing) return existing.id;
  const u = await db.user.create({
    data: {
      trelloId: m.id,
      name: m.fullName,
      image: m.avatarUrl ? `${m.avatarUrl}/170.png` : null,
      isGhost: true,
    },
  });
  return u.id;
}

/**
 * Upsert a Trello board into Hackban. Every row is keyed on its Trello id, so
 * running the same import again updates in place instead of duplicating.
 */
export async function applyBoard(opts: {
  tb: TrelloBoard;
  workspaceId: string;
  importerId: string;
  importerTrelloId: string | null;
  creds?: TrelloCreds;
  log: (msg: string) => Promise<void>;
}): Promise<ImportStats> {
  const { tb, workspaceId, importerId, creds, log } = opts;
  const warnings: string[] = [];

  if (opts.importerTrelloId) {
    // Claim the importer's Trello identity so their cards/comments map to them.
    const ghost = await db.user.findUnique({ where: { trelloId: opts.importerTrelloId } });
    if (ghost && ghost.id !== importerId) await mergeUsers(ghost.id, importerId);
    await db.user.update({ where: { id: importerId }, data: { trelloId: opts.importerTrelloId } });
  }

  // Members (including comment authors who may have left the board)
  const memberMap = new Map<string, string>();
  const allMembers = new Map(tb.members.map((m) => [m.id, m]));
  for (const a of tb.actions ?? []) {
    if (a.memberCreator && !allMembers.has(a.memberCreator.id)) allMembers.set(a.memberCreator.id, a.memberCreator);
  }
  for (const m of allMembers.values()) memberMap.set(m.id, await ensureUser(m, importerId, opts.importerTrelloId));

  const prefs = tb.prefs ?? {};
  const bgImage = prefs.backgroundImageScaled?.length
    ? [...prefs.backgroundImageScaled].sort((a, b) => b.width - a.width)[0]!.url
    : prefs.backgroundImage ?? null;
  const visibility = prefs.permissionLevel === "public" ? "public" : prefs.permissionLevel === "private" ? "private" : "workspace";
  const boardData = {
    name: tb.name,
    description: tb.desc,
    closed: tb.closed,
    background: prefs.backgroundColor ?? prefs.backgroundBottomColor ?? "#0079bf",
    bgImage,
    visibility,
  };
  // Re-importing updates in place, but only for an existing admin of that
  // board; otherwise anyone could rewrite (and become admin of) any board.
  const existingBoard = await db.board.findUnique({
    where: { trelloId: tb.id },
    include: { members: { where: { userId: importerId } } },
  });
  if (existingBoard && existingBoard.members[0]?.role !== "admin") {
    throw new Error(`"${tb.name}" was already imported by someone else. Ask one of its board admins to re-import it.`);
  }
  const board = existingBoard
    ? await db.board.update({ where: { id: existingBoard.id }, data: boardData })
    : await db.board.create({ data: { ...boardData, trelloId: tb.id, workspaceId } });
  await log(`Board "${tb.name}"`);

  // Only placeholder (ghost) members are added to boards/workspaces. A real
  // account matched by Trello id is someone else's identity: an uploaded JSON
  // must not be able to drop them into the importer's board or workspace.
  const ghostIds = new Set(
    (await db.user.findMany({ where: { id: { in: [...memberMap.values()] }, isGhost: true }, select: { id: true } })).map((u) => u.id),
  );
  for (const [tid, uid] of memberMap) {
    if (!tb.members.some((m) => m.id === tid)) continue;
    if (uid !== importerId && !ghostIds.has(uid)) continue;
    await db.boardMember.upsert({
      where: { boardId_userId: { boardId: board.id, userId: uid } },
      create: { boardId: board.id, userId: uid, role: uid === importerId ? "admin" : "normal" },
      update: {},
    });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: uid } },
      create: { workspaceId, userId: uid },
      update: {},
    });
  }
  await db.boardMember.upsert({
    where: { boardId_userId: { boardId: board.id, userId: importerId } },
    create: { boardId: board.id, userId: importerId, role: "admin" },
    update: { role: "admin" },
  });

  // Labels
  const labelMap = new Map<string, string>();
  for (const l of tb.labels) {
    const row = await scopedUpsert({
      trelloId: l.id,
      findScoped: () => db.label.findFirst({ where: { trelloId: l.id, boardId: board.id } }),
      existsGlobally: () => db.label.count({ where: { trelloId: l.id } }),
      create: (trelloId) => db.label.create({ data: { trelloId, boardId: board.id, name: l.name, color: l.color } }),
      update: (id) => db.label.update({ where: { id }, data: { name: l.name, color: l.color } }),
    });
    labelMap.set(l.id, row.id);
  }
  if (tb.labels.length === 0) {
    await db.label.createMany({ data: DEFAULT_LABEL_COLORS.map((color) => ({ boardId: board.id, color })) });
  }

  // Lists
  const listMap = new Map<string, string>();
  const lists = [...tb.lists].sort(byPos);
  const listKeys = sequentialKeys(lists.length);
  for (const [i, l] of lists.entries()) {
    const row = await scopedUpsert({
      trelloId: l.id,
      findScoped: () => db.list.findFirst({ where: { trelloId: l.id, boardId: board.id } }),
      existsGlobally: () => db.list.count({ where: { trelloId: l.id } }),
      create: (trelloId) =>
        db.list.create({ data: { trelloId, boardId: board.id, name: l.name, closed: l.closed, pos: listKeys[i]!, createdAt: createdAtFromId(l.id) } }),
      update: (id) => db.list.update({ where: { id }, data: { name: l.name, closed: l.closed, pos: listKeys[i]! } }),
    });
    listMap.set(l.id, row.id);
  }
  await log(`  ${lists.length} lists, ${tb.labels.length} labels`);

  // Cards (positions are per-list in Trello, so key them per list)
  const cardMap = new Map<string, string>();
  const cardsByList = new Map<string, typeof tb.cards>();
  for (const c of tb.cards) cardsByList.set(c.idList, [...(cardsByList.get(c.idList) ?? []), c]);
  let attachments = 0;
  let filesDownloaded = 0;
  let cardCount = 0;
  for (const [idList, cards] of cardsByList) {
    const listId = listMap.get(idList);
    if (!listId) {
      warnings.push(`${cards.length} cards reference unknown list ${idList}`);
      continue;
    }
    cards.sort(byPos);
    const keys = sequentialKeys(cards.length);
    for (const [i, c] of cards.entries()) {
      const data = {
        listId,
        title: c.name,
        description: c.desc,
        pos: keys[i]!,
        start: date(c.start),
        due: date(c.due),
        dueComplete: c.dueComplete,
        closed: c.closed,
        shortId: c.idShort ?? 0,
        coverColor: c.cover?.color ?? null,
        coverSize: c.cover?.size === "full" ? "full" : "normal",
      };
      // `data.listId` is always one of this board's lists, so moves stay in-board.
      const card = await scopedUpsert({
        trelloId: c.id,
        findScoped: () => db.card.findFirst({ where: { trelloId: c.id, list: { boardId: board.id } } }),
        existsGlobally: () => db.card.count({ where: { trelloId: c.id } }),
        create: (trelloId) => db.card.create({ data: { ...data, trelloId, createdAt: createdAtFromId(c.id) } }),
        update: (id) => db.card.update({ where: { id }, data }),
      });
      cardMap.set(c.id, card.id);
      cardCount++;

      await db.cardLabel.deleteMany({ where: { cardId: card.id } });
      const labelIds = c.idLabels.map((id) => labelMap.get(id)).filter((x): x is string => !!x);
      if (labelIds.length) await db.cardLabel.createMany({ data: labelIds.map((labelId) => ({ cardId: card.id, labelId })) });

      await db.cardMember.deleteMany({ where: { cardId: card.id } });
      const memberIds = c.idMembers.map((id) => memberMap.get(id)).filter((x): x is string => !!x);
      if (memberIds.length) await db.cardMember.createMany({ data: memberIds.map((userId) => ({ cardId: card.id, userId })) });

      for (const a of c.attachments ?? []) {
        attachments++;
        // Scoped to this card, so we never reuse another tenant's stored file.
        const existing = await db.attachment.findFirst({ where: { trelloId: a.id, cardId: card.id } });
        let storageKey = existing?.storageKey ?? null;
        if (a.isUpload && creds && !storageKey) {
          try {
            storageKey = await saveFile(await downloadAttachment(creds, a.url));
            filesDownloaded++;
          } catch (e) {
            warnings.push(`Could not download "${a.name}" on "${c.name}": ${(e as Error).message}`);
          }
        }
        const attachmentData = {
            cardId: card.id,
            name: a.name,
            url: a.url,
            mimeType: a.mimeType ?? null,
            size: a.bytes ?? null,
            isUpload: !!storageKey,
            storageKey,
            uploaderId: a.idMember ? memberMap.get(a.idMember) ?? null : null,
            createdAt: date(a.date) ?? undefined,
        };
        const row = existing
          ? await db.attachment.update({ where: { id: existing.id }, data: { name: a.name, storageKey, isUpload: !!storageKey } })
          : await db.attachment.create({
              data: { ...attachmentData, trelloId: (await db.attachment.count({ where: { trelloId: a.id } })) > 0 ? null : a.id },
            });
        if (storageKey && row.url !== `/api/files/${row.id}`) {
          await db.attachment.update({ where: { id: row.id }, data: { url: `/api/files/${row.id}` } });
        }
        if (c.cover?.idAttachment === a.id) {
          await db.card.update({ where: { id: card.id }, data: { coverAttachmentId: row.id } });
        }
      }
    }
  }
  await log(`  ${cardCount} cards, ${attachments} attachments (${filesDownloaded} files downloaded)`);

  // Checklists
  let checkItems = 0;
  for (const cl of tb.checklists) {
    const cardId = cardMap.get(cl.idCard);
    if (!cardId) continue;
    const [clKey] = sequentialKeys(1);
    const checklist = await scopedUpsert({
      trelloId: cl.id,
      findScoped: () => db.checklist.findFirst({ where: { trelloId: cl.id, card: { list: { boardId: board.id } } } }),
      existsGlobally: () => db.checklist.count({ where: { trelloId: cl.id } }),
      create: (trelloId) => db.checklist.create({ data: { trelloId, cardId, name: cl.name, pos: clKey! } }),
      update: (id) => db.checklist.update({ where: { id }, data: { name: cl.name } }),
    });
    const items = [...cl.checkItems].sort(byPos);
    const keys = sequentialKeys(items.length);
    for (const [i, it] of items.entries()) {
      checkItems++;
      const data = {
        checklistId: checklist.id,
        name: it.name,
        pos: keys[i]!,
        complete: it.state === "complete",
        due: date(it.due),
        memberId: it.idMember ? memberMap.get(it.idMember) ?? null : null,
      };
      await scopedUpsert({
        trelloId: it.id,
        findScoped: () => db.checkItem.findFirst({ where: { trelloId: it.id, checklistId: checklist.id } }),
        existsGlobally: () => db.checkItem.count({ where: { trelloId: it.id } }),
        create: (trelloId) => db.checkItem.create({ data: { ...data, trelloId } }),
        update: (id) => db.checkItem.update({ where: { id }, data }),
      });
    }
  }
  // Checklist positions are relative per card in Trello; re-key them in order.
  const clByCard = new Map<string, typeof tb.checklists>();
  for (const cl of tb.checklists) clByCard.set(cl.idCard, [...(clByCard.get(cl.idCard) ?? []), cl]);
  for (const cls of clByCard.values()) {
    const keys = sequentialKeys(cls.length);
    for (const [i, cl] of [...cls].sort(byPos).entries()) {
      await db.checklist.updateMany({ where: { trelloId: cl.id, card: { list: { boardId: board.id } } }, data: { pos: keys[i]! } });
    }
  }
  await log(`  ${tb.checklists.length} checklists, ${checkItems} items`);

  // Comments
  let comments = 0;
  for (const a of tb.actions ?? []) {
    if (a.type !== "commentCard" || !a.data.card || !a.data.text) continue;
    const cardId = cardMap.get(a.data.card.id);
    const authorId = memberMap.get(a.idMemberCreator) ?? importerId;
    if (!cardId) continue;
    const text = a.data.text;
    await scopedUpsert({
      trelloId: a.id,
      findScoped: () => db.comment.findFirst({ where: { trelloId: a.id, cardId } }),
      existsGlobally: () => db.comment.count({ where: { trelloId: a.id } }),
      create: (trelloId) => db.comment.create({ data: { trelloId, cardId, authorId, text, createdAt: new Date(a.date) } }),
      update: (id) => db.comment.update({ where: { id }, data: { text } }),
    });
    comments++;
  }
  await log(`  ${comments} comments`);

  await db.activity.create({
    data: { boardId: board.id, actorId: importerId, type: "importBoard", data: JSON.stringify({ name: tb.name }) },
  });
  touch(board.id);

  return {
    board: tb.name,
    boardId: board.id,
    lists: lists.length,
    cards: cardCount,
    labels: tb.labels.length,
    checklists: tb.checklists.length,
    checkItems,
    comments,
    attachments,
    filesDownloaded,
    warnings,
  };
}

/** Move everything owned by `fromId` (usually a ghost) onto `toId`, then delete `fromId`. */
export async function mergeUsers(fromId: string, toId: string) {
  const from = await db.user.findUniqueOrThrow({ where: { id: fromId } });
  await db.$transaction(async (tx) => {
    for (const m of await tx.boardMember.findMany({ where: { userId: fromId } })) {
      await tx.boardMember.upsert({
        where: { boardId_userId: { boardId: m.boardId, userId: toId } },
        create: { boardId: m.boardId, userId: toId, role: m.role },
        update: {},
      });
    }
    for (const m of await tx.workspaceMember.findMany({ where: { userId: fromId } })) {
      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: toId } },
        create: { workspaceId: m.workspaceId, userId: toId, role: m.role },
        update: {},
      });
    }
    for (const m of await tx.cardMember.findMany({ where: { userId: fromId } })) {
      await tx.cardMember.upsert({
        where: { cardId_userId: { cardId: m.cardId, userId: toId } },
        create: { cardId: m.cardId, userId: toId },
        update: {},
      });
    }
    await tx.comment.updateMany({ where: { authorId: fromId }, data: { authorId: toId } });
    await tx.activity.updateMany({ where: { actorId: fromId }, data: { actorId: toId } });
    await tx.checkItem.updateMany({ where: { memberId: fromId }, data: { memberId: toId } });
    await tx.attachment.updateMany({ where: { uploaderId: fromId }, data: { uploaderId: toId } });
    await tx.user.delete({ where: { id: fromId } });
    await tx.user.updateMany({ where: { id: toId, trelloId: null }, data: { trelloId: from.trelloId } });
  });
}
