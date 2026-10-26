import assert from "node:assert/strict";
import { test } from "bun:test";
import { z } from "zod";

import { memberInput, userForInvite } from "~/server/invite";

type Db = Parameters<typeof userForInvite>[0];
const fakeDb = (realId: string | null) => {
  const upserts: unknown[] = [];
  const db = {
    user: {
      findFirst: async () => (realId ? { id: realId } : null),
      upsert: async (args: unknown) => (upserts.push(args), { id: "ghost" }),
    },
  } as unknown as Db;
  return { db, upserts };
};

test("email invites reuse a logged-in account, else make an invited ghost", async () => {
  const real = fakeDb("real");
  assert.equal(await userForInvite(real.db, "Jane@HackClub.com"), "real");
  assert.equal(real.upserts.length, 0);

  const none = fakeDb(null);
  assert.equal(await userForInvite(none.db, " Jane.Doe@HackClub.com "), "ghost");
  assert.deepEqual(none.upserts[0], {
    where: { invitedEmail: "jane.doe@hackclub.com" },
    create: { name: "jane.doe", invitedEmail: "jane.doe@hackclub.com", isGhost: true },
    update: {},
    select: { id: true },
  });
});

test("addMember takes exactly one of a user or a valid email", () => {
  const input = memberInput(z.enum(["normal"]).default("normal"));
  assert.equal(input.safeParse({ id: "b", userId: "u" }).success, true);
  assert.equal(input.parse({ id: "b", email: " A@B.co " }).email, "a@b.co");
  assert.equal(input.safeParse({ id: "b" }).success, false);
  assert.equal(input.safeParse({ id: "b", userId: "u", email: "a@b.co" }).success, false);
  assert.equal(input.safeParse({ id: "b", email: "not-an-email" }).success, false);
});
