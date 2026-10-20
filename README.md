# Hackban

A self-hosted Trello for Hack Club: boards, lists, cards, drag and drop, live
collaboration, and a migrator that brings your Trello boards over. You log in
with Hack Club Auth, and it runs at [hackban.hackclub.com](https://hackban.hackclub.com).

## Features

- **Boards:** lists and cards with Trello-style drag and drop, labels, members, start/due dates,
  checklists, attachments (upload, drag-drop, paste), covers, comments,
  activity, watching, archive/restore, copy/move, and a quick editor (right-click
  or `e`).
- **Live updates:** changes appear for everyone viewing a board without
  refreshing.
- **Workspaces:** members and roles, logos, settings, board export (JSON),
  domain auto-join.
- **Trello import:** connect with a Trello API key + token, or upload board JSON
  exports. See [Importing from Trello](#importing-from-trello).
- **Admin panel** (`/admin`): site stats, users, every board and workspace,
  auto-join rules, import logs.
- **Personal settings** (`/me`): profile, your activity, your cards, theme
  (light/dark/system), keyboard shortcuts.

### Keyboard shortcuts (hover a card)

| Key       | Action                          |
| --------- | ------------------------------- |
| `Enter`   | Open card                       |
| `e`       | Quick edit (or right-click)     |
| `d`       | Toggle complete                 |
| `c`       | Archive                         |
| `Space`   | Join / leave card               |
| `1`–`0`   | Toggle the board's labels       |
| `q` / `x` | Show only my cards / clear filters |
| `w`       | Board menu                      |
| `/`       | Search                          |

## Stack

Next.js 15 (App Router) · tRPC 11 (live updates via server-sent events) ·
Prisma 6 + PostgreSQL · Auth.js v5 · Tailwind 4 · dnd-kit · Framer Motion.
Bun manages packages; Node runs the app.

```
src/
  app/                     pages + API routes
    _components/board/     board view, cards, lists, card modal, popovers
  server/
    api/routers/           tRPC: board, list, card, workspace, admin, import, me, …
    api/access.ts          permission checks + activity logging
    realtime.ts            in-process event bus behind the live-update stream
    import/                Trello client, JSON shape, idempotent apply
    autojoin.ts            domain auto-join rules
    storage.ts             uploaded files on disk
prisma/schema.prisma
```

## Running locally

You need [Bun](https://bun.sh), Node 20+, and a Postgres database.

```sh
bun install
cp .env.example .env    # fill it in (see below)

# a throwaway local Postgres, if you don't have one:
docker run -d --name hackban-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hackban -p 5432:5432 postgres:17

bun run db:push         # create/update tables from prisma/schema.prisma
bun dev                 # http://localhost:3000
```

### Environment

| Variable               | Required | Notes |
| ---------------------- | -------- | ----- |
| `DATABASE_URL`         | yes      | `postgresql://user:pass@host:5432/db` |
| `AUTH_SECRET`          | prod     | `npx auth secret` |
| `AUTH_HACKCLUB_ID`     | yes      | Hack Club Auth OAuth client ID |
| `AUTH_HACKCLUB_SECRET` | yes      | Hack Club Auth OAuth client secret |
| `AUTH_HACKCLUB_SCOPE`  | no       | Default `email name slack_id`. Must match the scopes enabled on the OAuth app; `slack_id` gives Slack avatars |
| `AUTH_URL`             | prod     | Public URL, e.g. `https://hackban.hackclub.com` |
| `AUTH_TRUST_HOST`      | prod     | `true` when behind a proxy |
| `ADMIN_EMAILS`         | no       | Comma-separated emails that are always site admins |
| `UPLOAD_DIR`           | no       | Where attachments are stored. Default `./uploads` |

### Hack Club Auth

Create an OAuth app at [auth.hackclub.com](https://auth.hackclub.com) with the
`email` and `name` scopes (plus `slack_id` for avatars), and add this redirect
URI for each origin you run on:

```
http://localhost:3000/api/auth/callback/hackclub
https://hackban.hackclub.com/api/auth/callback/hackclub
```

The app doesn't need the `openid` scope: it uses plain OAuth and reads the
profile from `/api/v1/me`.

## Admins and auto-join

- **Site admins** are anyone in `ADMIN_EMAILS` (applied on login), plus anyone
  promoted from **/admin → Users**. Site admins can see every board and
  workspace, "join as admin" to rescue a board whose admins have left, and
  manage auto-join for any workspace.
- **Auto-join:** add a rule like `@hackclub.com → Hack Club (as Member)` under
  **Workspace → Settings → Auto-join by email domain**, or **/admin → Auto-join**.
  Anyone who logs in with a matching email joins the workspace. Adding a rule
  also adds everyone who already has an account on that domain. Auto-join
  never changes an existing member's role, and removing a rule keeps the people
  it already added.
  - Workspace admins can only add **their own** domain, so nobody can pull an
    entire organization into their workspace. Site admins can add any domain.

## Importing from Trello

Go to **/import**:

1. **Connect your Trello account** (recommended): create a Power-Up at
   [trello.com/power-ups/admin](https://trello.com/power-ups/admin), paste its
   API key, click **Authorize** to get a read-only token, then pick boards.
   Hackban imports lists, cards, labels, checklists, all comments (with their
   original authors and dates), members, dates, covers, and downloads files
   uploaded to Trello cards. The token is never stored.
2. **Upload JSON exports:** in Trello, open the board menu → *Print, export,
   and share* → *Export as JSON*. Attachments stay as links to Trello unless
   you also provide a key + token.

Re-importing is safe: everything is matched by its Trello ID and updated in place,
not duplicated.

**Imported members:** Trello never shares members' emails, so each person
becomes a placeholder member. Once they've logged in to Hackban, a workspace
admin links them under **Workspace → Members → Link account…**, which moves
their cards, comments and board access over. (People can also claim themselves
with "This is me" on /import if they're already on one of the boards.)

## Deploying

The `Dockerfile` builds a standalone Next.js server:

- On boot it runs `prisma db push` (additive schema changes; it refuses
  destructive ones), then starts the server on port 3000.
- Uploaded files go to `UPLOAD_DIR` (`/data/uploads` in the image), so **mount a
  persistent volume at `/data`**.
- **Run exactly one replica.** Live updates use an in-process event bus.
  Scaling out needs a shared bus (e.g. Redis or Postgres `LISTEN/NOTIFY`) in
  `src/server/realtime.ts`.
- Give it **about 1 GB of memory**; the default 128 MB gets OOM-killed during
  boot.

Production runs on Orchard (project *Hackban* in YSWS) with an Orchard
Postgres database and a persistent volume for uploads. Pushes to `main`
auto-deploy.

## Scripts

```sh
bun dev            # dev server
bun run build      # production build
bun run typecheck  # tsc
bun run lint       # eslint
bun run db:push    # sync schema to DATABASE_URL
bun run db:studio  # Prisma Studio
```
