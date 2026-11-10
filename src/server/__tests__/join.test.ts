import assert from "node:assert/strict";
import { test } from "bun:test";

import { boardRouter } from "~/server/api/routers/board";

type Vis = "private" | "workspace" | "public";
const caller = (visibility: Vis, member: boolean, inWorkspace: boolean) => {
  const upserts: unknown[] = [];
  const db = {
    board: {
      findUnique: async () => ({
        visibility,
        members: member ? [{ role: "normal" }] : [],
        workspace: { members: inWorkspace ? [{}] : [] },
      }),
    },
    boardMember: { upsert: async (a: unknown) => upserts.push(a) },
    activity: { create: async () => ({}) },
  };
  const ctx = { db, session: { user: { id: "u" } }, headers: new Headers() };
  return { join: () => boardRouter.createCaller(ctx as never).join({ id: "b" }), upserts };
};

test("only workspace members who aren't on a visible board can join it", async () => {
  const cases: [Vis, boolean, boolean, "joined" | "noop" | "forbidden"][] = [
    // visibility, board member, in workspace, outcome
    ["workspace", false, true, "joined"],
    ["public", false, true, "joined"],
    ["public", false, false, "forbidden"],
    ["private", false, true, "forbidden"],
    ["workspace", true, true, "noop"],
  ];
  for (const [vis, m, ws, want] of cases) {
    const c = caller(vis, m, ws);
    const got = await c.join().then(() => (c.upserts.length ? "joined" : "noop"), () => "forbidden");
    assert.equal(got, want, `${vis} member=${m} ws=${ws}`);
  }
});
