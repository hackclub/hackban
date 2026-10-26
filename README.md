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
    mcp.ts, oauth.ts       MCP server tools + its OAuth 2.1 provider
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

## Sharing boards with people outside a workspace

- **Board guests:** adding someone from a board's **Share** dialog makes them a
  member of *that board only*. They don't join the workspace, so they can't see
  its other boards. They're tagged **Guest**, and their boards appear under
  **Guest boards** on their home page.
- **Invite links:** in **Share**, a board admin can **Create link**. Anyone who
  opens it logs in with Hack Club and can join the board as a guest Member or
  Observer (admin's choice). **Reset link** invalidates the old one, and **Turn
  off link** disables it. Links never grant admin, and the token is only shown
  to board members.

## Moving boards

Board admins can move a board to any workspace they belong to from the board
menu (**… → Move board…**) or a board tile's **…** menu. Site admins can move
any board from **/admin → Boards**. Board members keep their access.
"Workspace" visibility then refers to the new workspace.

## Admins and auto-join

- **Site admins** are anyone in `ADMIN_EMAILS` (granted on login), plus anyone
  promoted from **/admin → Users**. Logging in never removes admin; to demote
  someone, remove them from `ADMIN_EMAILS` (if listed), then use **/admin → Users**. Site admins can see every board and
  workspace, "join as admin" to rescue a board whose admins have left, and
  manage auto-join for any workspace.
- **Auto-join:** add a rule like `@hackclub.com → Hack Club (as Member)` under
  **Workspace → Settings → Auto-join by email domain**, or **/admin → Auto-join**.
  Anyone who logs in with a matching email joins the workspace. Adding a rule
  also adds everyone who already has an account on that domain. Auto-join
  never changes an existing member's role, and removing a rule keeps the people
  it already added.
  - Workspace admins can only add **their own** domain, only as Member, and
    never a public email provider (gmail.com etc.). That way nobody can pull an
    entire organization into their workspace. Site admins can add any domain
    and role.

## Importing from Trello

Imports are site-admin only (the account menu → **Import from Trello**, or **/import**). Everyone else is asked to request one in #hackban. Admins:

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
becomes a placeholder member. Once they've logged in to Hackban, a **site
admin** links them under **Workspace → Members → Link account…**, which moves
their cards, comments and board access over. Linking is site-admin only
because it's irreversible and attributes imported history to a real account.

Imports can't touch other people's data: re-importing a Trello board only
updates it if you're already an admin of that Hackban board, rows are matched
only within the board being imported, and attachment downloads only go to
Trello's own hosts.

## MCP (Claude, Cursor, …)

Hackban is an MCP server at `https://hackban.hackclub.com/api/mcp`. Add that URL
as a custom connector in Claude (or with `claude mcp add --transport http hackban <url>`
in Claude Code, or in any MCP client). The client signs in with OAuth: you approve
it once on a Hackban consent page, and it then acts as you, with your permissions.
Revoke an app any time under **Settings → Connected apps** (`/me/settings`).

Tools: `whoami`, `list_workspaces`, `get_workspace`, `search`, `get_board`,
`get_archived`, `board_activity`, `get_card`, `my_cards`, `notifications`,
`create_board`, `update_board`, `add_board_member`, `add_workspace_member`,
`create_list`, `update_list`, `move_list`, `save_label`, `create_card`, `update_card`,
`move_card`, `copy_card`, `watch_card`, `add_comment`, `edit_comment`, `add_link`,
`set_card_label`, `set_card_member`, `add_checklist`, `rename_checklist`,
`add_check_item`, `update_check_item`. They call the same tRPC procedures as the web
app, so access checks, activity and live updates match. Nothing is permanently
deleted: cards, lists and boards can only be archived, and members can be added
(by user or email invite) but not removed. Site-admin powers aren't available over MCP.

Code: `src/server/mcp.ts` (tools), `src/server/oauth.ts` (OAuth 2.1: PKCE,
dynamic client registration, rotating refresh tokens), `src/app/oauth/authorize`
(consent page), and `src/app/api/{mcp,oauth}`.

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
