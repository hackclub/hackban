# Hackban

Hack Club's self-hosted Trello (Next.js 15 App Router, tRPC 11, Prisma 6 + Postgres, Auth.js v5, Tailwind 4, dnd-kit).
`README.md` covers features, layout, env vars, MCP and deploys. Read it before asking.

## Commands

```sh
bun dev              # http://localhost:3000 (needs DATABASE_URL + Hack Club Auth env, see README)
bun run typecheck    # tsc
bun run lint         # eslint
bun test             # src/server/__tests__, bun:test + node:assert/strict
bun run db:push      # sync prisma/schema.prisma to the database
```

Run typecheck, lint and the tests before you call a change done.

## Rules

- **Never `git push`** unless the user asks for that specific push. Pushing to `main` auto-deploys to production (Orchard).
- **Announce user-facing changes.** In the same change, add an entry at the top of `ANNOUNCEMENTS` in
  `src/app/_components/announcements.ts`: a new unique `id`, an ISO `date`, a few-word `title`, and a one-sentence `body`.
  Describe what the code actually does. A new top `id` turns on the megaphone's unseen dot for everyone, so never reuse
  or reorder ids. Leave out chores, refactors and internal fixes.
- Always write the name as "Hack Club": two words, both capitalized.
- Commit messages follow `feat: …` / `fix: …` / `chore: …`.

## Server conventions

- Every tRPC procedure that touches a board calls `requireBoard` (from `src/server/api/access.ts`) first. Pass `write = false` for reads. Never skip it.
- Mutations call `logActivity(...)` with `origin: ctx.clientId`. That call also publishes the live update. For a change with no activity entry, call `touch(boardId, cardId?, origin)` instead.
- MCP tools (`src/server/mcp.ts`) call the same tRPC procedures via `createCaller`, so they don't need separate
  access checks. Expose new card/list/board features there when it makes sense. Nothing gets hard-deleted over MCP.
- Positions use `fractional-indexing` (`posAfter`, `posAtEnd`, `sequentialKeys` in `src/server/api/pos.ts`).
- Schema changes deploy through `prisma db push` on boot, which refuses destructive changes. If a change needs
  something db push won't do (like a unique index on a new column), add idempotent SQL to `prisma/pre-push.sql`. Never put destructive SQL there.
- Production runs as a single replica with an in-process event bus. Don't add anything that assumes more than one.

## Client conventions

- Card edits are optimistic (`usePatchCard` in `board/optimistic.ts`). Use it instead of waiting on refetches.
- Colors come from CSS vars (`var(--color-…)`) so light and dark themes both work. Don't hard-code colors, except
  the Hack Club red logo.
- Icons are inline SVG paths in `PATHS` in `src/app/_components/ui.tsx`, rendered with `<Icon name="…" />`. Reuse `Popover`,
  `usePopoverState`, `MenuItem` and `Avatar` from `ui.tsx` rather than building new primitives.
- `localStorage` keys start with `hackban:`. Wrap every read and write in `try {} catch {}`, and read inside `useEffect` (SSR).
