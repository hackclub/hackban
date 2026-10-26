-- Runs before `prisma db push` on every boot. db push refuses changes it
-- classifies as risky (e.g. adding a unique index), even when the column is
-- brand new and empty. Apply those here, idempotently, so db push sees them
-- as already in sync. Never put anything destructive in this file.

-- Board invite links (unique index on a new, all-NULL column).
ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "inviteToken" TEXT;
ALTER TABLE "Board" ADD COLUMN IF NOT EXISTS "inviteRole" TEXT NOT NULL DEFAULT 'normal';
CREATE UNIQUE INDEX IF NOT EXISTS "Board_inviteToken_key" ON "Board"("inviteToken");

-- Email invites (unique index on a new, all-NULL column).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "invitedEmail" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_invitedEmail_key" ON "User"("invitedEmail");
