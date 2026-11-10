import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, importProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { applyBoard, type ImportStats } from "~/server/import/apply";
import { fetchBoard, listBoards, me, type TrelloCreds } from "~/server/import/trello-api";
import { type TrelloBoard } from "~/server/import/types";

const creds = z.object({ key: z.string().min(10), token: z.string().min(10) });

type Source =
  | { kind: "api"; creds: TrelloCreds; boardIds: string[] }
  | { kind: "json"; boards: TrelloBoard[]; creds?: TrelloCreds };

/** Runs detached from the request; progress is persisted on the job row. */
async function runImport(jobId: string, userId: string, workspaceId: string | null, source: Source) {
  const lines: string[] = [];
  const log = async (msg: string) => {
    lines.push(msg);
    await db.trelloImport.update({ where: { id: jobId }, data: { log: JSON.stringify(lines) } });
  };
  const results: ImportStats[] = [];
  try {
    await db.trelloImport.update({ where: { id: jobId }, data: { status: "running" } });
    const c = source.creds;
    const trelloMe = c ? await me(c) : null;
    const orgNames = new Map<string, string>();
    if (source.kind === "api") {
      for (const o of (await listBoards(source.creds)).orgs) orgNames.set(o.id, o.displayName);
    }
    const ids = source.kind === "api" ? source.boardIds : source.boards.map((b) => b.id);
    for (const [i, id] of ids.entries()) {
      await log(`[${i + 1}/${ids.length}] Fetching…`);
      const tb = source.kind === "api" ? await fetchBoard(source.creds, id) : source.boards[i]!;
      const wsId = workspaceId ?? (await workspaceFor(userId, tb.idOrganization ?? null, orgNames));
      results.push(
        await applyBoard({ tb, workspaceId: wsId, importerId: userId, importerTrelloId: trelloMe?.id ?? null, creds: c, log }),
      );
      await db.trelloImport.update({ where: { id: jobId }, data: { result: JSON.stringify(results) } });
    }
    await log("Done.");
    await db.trelloImport.update({ where: { id: jobId }, data: { status: "done" } });
  } catch (e) {
    await log(`Error: ${(e as Error).message}`);
    await db.trelloImport.update({ where: { id: jobId }, data: { status: "error", result: JSON.stringify(results) } });
  }
}

/**
 * Pick the workspace for an imported board. A Trello workspace maps to an
 * existing Hackban workspace only if the importer is already a member of it;
 * otherwise a new one is created (never join someone else's by Trello id).
 */
async function workspaceFor(userId: string, orgId: string | null, orgNames: Map<string, string>) {
  if (orgId) {
    const linked = await db.workspace.findUnique({ where: { trelloId: orgId }, include: { members: { where: { userId } } } });
    if (linked?.members.length) return linked.id;
    const ws = await db.workspace.create({
      data: {
        // trelloId is unique; leave it unset if another workspace already claimed it.
        trelloId: linked ? null : orgId,
        name: orgNames.get(orgId) ?? "Imported workspace",
        members: { create: { userId, role: "admin" } },
      },
    });
    return ws.id;
  }
  const first = await db.workspaceMember.findFirst({ where: { userId }, orderBy: { workspace: { createdAt: "asc" } } });
  if (first) return first.workspaceId;
  const ws = await db.workspace.create({ data: { name: "Imported", members: { create: { userId, role: "admin" } } } });
  return ws.id;
}

async function requireWorkspaceMember(userId: string, workspaceId: string | null) {
  if (!workspaceId) return;
  const m = await db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!m) throw new TRPCError({ code: "FORBIDDEN", message: "You're not a member of that workspace." });
}

// Site admins and granted importers only: imports create placeholder members and attribute history to Trello identities.
export const importRouter = createTRPCRouter({
  trelloBoards: importProcedure.input(creds).mutation(async ({ input }) => {
    try {
      const [{ boards, orgs }, who] = await Promise.all([listBoards(input), me(input)]);
      return { boards, orgs, me: who };
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    }
  }),

  startApi: importProcedure
    .input(creds.extend({ boardIds: z.array(z.string().max(64)).min(1).max(200), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await requireWorkspaceMember(ctx.session.user.id, input.workspaceId);
      const job = await ctx.db.trelloImport.create({ data: { userId: ctx.session.user.id, source: "api" } });
      // Credentials live only in this closure; they are never persisted.
      void runImport(job.id, ctx.session.user.id, input.workspaceId, {
        kind: "api",
        creds: { key: input.key, token: input.token },
        boardIds: input.boardIds,
      });
      return job;
    }),

  startJson: importProcedure
    .input(
      z.object({
        files: z.array(z.string().max(50 * 1024 * 1024)).min(1).max(50),
        workspaceId: z.string().nullable(),
        creds: creds.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let boards: TrelloBoard[];
      try {
        boards = input.files.map((f) => JSON.parse(f) as TrelloBoard);
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "One of the files isn't valid JSON." });
      }
      for (const b of boards) {
        if (!b.id || !Array.isArray(b.lists) || !Array.isArray(b.cards)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That doesn't look like a Trello board export." });
        }
      }
      await requireWorkspaceMember(ctx.session.user.id, input.workspaceId);
      const job = await ctx.db.trelloImport.create({ data: { userId: ctx.session.user.id, source: "json" } });
      void runImport(job.id, ctx.session.user.id, input.workspaceId, { kind: "json", boards, creds: input.creds });
      return job;
    }),

  job: importProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const job = await ctx.db.trelloImport.findFirstOrThrow({ where: { id: input.id, userId: ctx.session.user.id } });
    return {
      ...job,
      log: JSON.parse(job.log) as string[],
      result: JSON.parse(job.result) as ImportStats[] | Record<string, never>,
    };
  }),

  /** Placeholder members created by imports on boards the user can see. */
  ghosts: importProcedure.query(({ ctx }) =>
    ctx.db.user.findMany({
      where: {
        isGhost: true,
        boards: { some: { board: { members: { some: { userId: ctx.session.user.id } } } } },
      },
      select: { id: true, name: true, image: true },
    }),
  ),

  // Placeholder members are linked to real accounts by a site admin via
  // workspace.linkGhost. (A self-serve "this is me" claim was removed: a
  // crafted import could put any ghost on the attacker's board to claim it.)
});
