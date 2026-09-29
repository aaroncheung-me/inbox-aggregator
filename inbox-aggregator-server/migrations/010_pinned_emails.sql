-- 010: pinned emails.
-- A pin lives only in the app (it doesn't star the email in Gmail). Pinned
-- emails show in a "Pinned" group above Received, most recently pinned first.
-- Syncing never touches this column, so pins survive re-syncs.
-- Paste this whole file into the Supabase SQL Editor and run it.

begin;

alter table public.messages add column if not exists pinned_at timestamptz;

-- the Pinned group only ever reads the few pinned emails
create index if not exists messages_pinned_idx on public.messages (account_id, pinned_at desc)
  where pinned_at is not null;

commit;
