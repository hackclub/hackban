import assert from "node:assert/strict";
import { test } from "bun:test";

import { importRouter } from "~/server/api/routers/import";

const job = { id: "j", log: "[]", result: "{}" };
const allowed = (isAdmin: boolean, canImport: boolean) => {
  const ctx = {
    db: { trelloImport: { findFirstOrThrow: async () => job } },
    session: { user: { id: "u", isAdmin, canImport } },
    headers: new Headers(),
  };
  return importRouter.createCaller(ctx as never).job({ id: "j" }).then(() => true, () => false);
};

test("Trello import is open to site admins and granted importers only", async () => {
  assert.equal(await allowed(true, false), true);
  assert.equal(await allowed(false, true), true);
  assert.equal(await allowed(false, false), false);
});
