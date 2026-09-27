-- 002: fixes found after running 001.
-- Paste this whole file into the Supabase SQL Editor and run it.

begin;

-- The code has always read and written this, but the column was never created.
alter table public.accounts add column if not exists last_synced_at timestamptz;

-- Tables created in the SQL Editor don't get access granted automatically in
-- this project, so the server (service_role) couldn't read or write attachments.
-- anon / authenticated are deliberately left out.
grant select, insert, update, delete on public.attachments to service_role;

do $$
begin
  execute format(
    'grant usage, select on sequence %s to service_role',
    pg_get_serial_sequence('public.attachments', 'id')
  );
end $$;

commit;
