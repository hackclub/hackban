import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { applyBoard, mergeUsers, type ImportStats } from "~/server/import/apply";
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

async function workspaceFor(userId: string, orgId: string | null, orgNames: Map<string, string>) {
  if (orgId) {
    const ws = await db.workspace.upsert({
      where: { trelloId: orgId },
      create: { trelloId: orgId, name: orgNames.get(orgId) ?? "Imported workspace" },
      update: {},
    });
    await db.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: ws.id, userId } },
      create: { workspaceId: ws.id, userId, role: "admin" },
      update: {},
    });
    return ws.id;
  }
  const first = await db.workspaceMember.findFirst({ where: { userId }, orderBy: { workspace: { createdAt: "asc" } } });
  if (first) return first.workspaceId;
  const ws = await db.workspace.create({ data: { name: "Imported", members: { create: { userId, role: "admin" } } } });
  return ws.id;
}

export const importRouter = createTRPCRouter({
  trelloBoards: protectedProcedure.input(creds).mutation(async ({ input }) => {
    try {
      const [{ boards, orgs }, who] = await Promise.all([listBoards(input), me(input)]);
      return { boards, orgs, me: who };
    } catch (e) {
      throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
    }
  }),

  startApi: protectedProcedure
    .input(creds.extend({ boardIds: z.array(z.string()).min(1), workspaceId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.trelloImport.create({ data: { userId: ctx.session.user.id, source: "api" } });
      // Credentials live only in this closure; they are never persisted.
      void runImport(job.id, ctx.session.user.id, input.workspaceId, {
        kind: "api",
        creds: { key: input.key, token: input.token },
        boardIds: input.boardIds,
      });
      return job;
    }),

  startJson: protectedProcedure
    .input(
      z.object({
        files: z.array(z.string()).min(1),
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
      const job = await ctx.db.trelloImport.create({ data: { userId: ctx.session.user.id, source: "json" } });
      void runImport(job.id, ctx.session.user.id, input.workspaceId, { kind: "json", boards, creds: input.creds });
      return job;
    }),

  job: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const job = await ctx.db.trelloImport.findFirstOrThrow({ where: { id: input.id, userId: ctx.session.user.id } });
    return {
      ...job,
      log: JSON.parse(job.log) as string[],
      result: JSON.parse(job.result) as ImportStats[] | Record<string, never>,
    };
  }),

  /** Placeholder members created by imports on boards the user can see. */
  ghosts: protectedProcedure.query(({ ctx }) =>
    ctx.db.user.findMany({
      where: {
        isGhost: true,
        boards: { some: { board: { members: { some: { userId: ctx.session.user.id } } } } },
      },
      select: { id: true, name: true, image: true },
    }),
  ),

  /** "This Trello member is me" — fold a ghost's history into the current account. */
  claimGhost: protectedProcedure.input(z.object({ ghostId: z.string() })).mutation(async ({ ctx, input }) => {
    // Only ghosts on a board the claimer already belongs to can be claimed, so a
    // stranger can't take over someone's imported history (and board access).
    const ghost = await ctx.db.user.findFirst({
      where: {
        id: input.ghostId,
        isGhost: true,
        boards: { some: { board: { members: { some: { userId: ctx.session.user.id } } } } },
      },
    });
    if (!ghost) throw new TRPCError({ code: "NOT_FOUND" });
    const self = await ctx.db.user.findUniqueOrThrow({ where: { id: ctx.session.user.id } });
    if (self.trelloId) throw new TRPCError({ code: "BAD_REQUEST", message: "Your account is already linked to a Trello member." });
    await mergeUsers(ghost.id, self.id);
  }),
});
