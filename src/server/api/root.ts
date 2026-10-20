import { adminRouter } from "~/server/api/routers/admin";
import { boardRouter } from "~/server/api/routers/board";
import { cardRouter } from "~/server/api/routers/card";
import { importRouter } from "~/server/api/routers/import";
import { listRouter } from "~/server/api/routers/list";
import { meRouter } from "~/server/api/routers/me";
import { notificationRouter, searchRouter } from "~/server/api/routers/misc";
import { workspaceRouter } from "~/server/api/routers/workspace";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  workspace: workspaceRouter,
  board: boardRouter,
  list: listRouter,
  card: cardRouter,
  notification: notificationRouter,
  search: searchRouter,
  import: importRouter,
  admin: adminRouter,
  me: meRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
