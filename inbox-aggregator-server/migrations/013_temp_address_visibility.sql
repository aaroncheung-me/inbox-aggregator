-- 013: a show-in-inbox checkbox for each temp address, like accounts have.
-- Unchecked, the emails it received are left out of the inbox list (they're
-- still kept, counted and deleted with it as usual).
-- Paste this whole file into the Supabase SQL Editor and run it.

alter table public.temp_addresses add column if not exists show_in_inbox boolean not null default true;
