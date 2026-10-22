import assert from "node:assert/strict";
import { test } from "bun:test";

import { requireBoard } from "~/server/api/access";

type Vis = "private" | "workspace" | "public";
const fakeDb = (visibility: Vis, member: { role: string } | null, inWorkspace: boolean) =>
  ({
    board: {
      findUnique: async () => ({
        visibility,
        members: member ? [member] : [],
        workspace: { members: inWorkspace ? [{}] : [] },
      }),
    },
  }) as unknown as Parameters<typeof requireBoard>[0];

const can = async (db: ReturnType<typeof fakeDb>, write: boolean) =>
  requireBoard(db, "u", "b", write).then(() => true, () => false);

test("who can read and write a board", async () => {
  const cases: [Vis, { role: string } | null, boolean, boolean, boolean][] = [
    // visibility, board member, in workspace, canRead, canWrite
    ["private", null, true, false, false],
    ["private", { role: "normal" }, false, true, true],
    ["private", { role: "observer" }, true, true, false],
    ["workspace", null, true, true, true],
    ["workspace", null, false, false, false],
    ["public", null, false, true, false],
  ];
  for (const [vis, m, ws, read, write] of cases) {
    const db = fakeDb(vis, m, ws);
    assert.equal(await can(db, false), read, `read ${vis} ${m?.role} ${ws}`);
    assert.equal(await can(db, true), write, `write ${vis} ${m?.role} ${ws}`);
  }
});
