-- 003: per-account color and inbox visibility.
-- Paste this whole file into the Supabase SQL Editor and run it.

begin;

alter table public.accounts
  add column if not exists color text,
  -- unchecked accounts still sync; their messages are just left out of the inbox and AI search
  add column if not exists show_in_inbox boolean not null default true;

-- Give existing accounts colors from the same palette the server uses
-- (ACCOUNT_COLORS in lib/accounts.js), in the order they were connected.
with ranked as (
  select id, row_number() over (partition by user_id order by id) - 1 as position
  from public.accounts
  where color is null
),
palette as (
  select array['#F2A7A7', '#F5BE8F', '#E9D17A', '#9FD8B0', '#93CDE6', '#A9B3EE', '#CDA8EC', '#EFA7CC'] as colors
)
update public.accounts a
set color = palette.colors[(ranked.position % array_length(palette.colors, 1)) + 1]
from ranked, palette
where a.id = ranked.id;

commit;
