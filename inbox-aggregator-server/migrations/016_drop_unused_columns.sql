-- 016: remove columns nothing uses, so the database matches schema.sql.
--   * messages.category and ai_summary: per-email AI tagging, tried early and
--     turned off; 19 old emails had one, and the app never showed them.
--   * attachments.storage_path and embedding, notes.embedding: planned for
--     features built another way (attachments are read from the mailbox when
--     needed); always empty.
--   * note_addons.data: room for future kinds of add-on; never used.
-- Also: every account has an email address, so it's now required, and
-- accounts.user_id loses a leftover default that made up a random user id.
-- Safe to run before or after deploying: the server reads none of these.
-- Paste this whole file into the Supabase SQL Editor and run it. If anything
-- still depended on one of these columns, it stops and changes nothing.

begin;

alter table public.messages drop column category, drop column ai_summary;
alter table public.attachments drop column storage_path, drop column embedding;
alter table public.notes drop column embedding;
alter table public.note_addons drop column data;

alter table public.accounts
  alter column email_address set not null,
  alter column user_id drop default;

commit;
