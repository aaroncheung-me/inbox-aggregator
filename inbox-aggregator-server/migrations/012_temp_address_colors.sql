-- 012: a color for each temp address, like the one each account has, so the
-- emails it received stand out in the inbox. Picked by the server when the
-- address is made; addresses made before this get one below.
-- Paste this whole file into the Supabase SQL Editor and run it.

begin;

alter table public.temp_addresses add column if not exists color text;

-- the same palette as accounts (ACCOUNT_COLORS in lib/accounts.js), taken in turn
with ranked as (
  select id, row_number() over (partition by user_id order by id) - 1 as position
  from public.temp_addresses
  where color is null
),
palette as (
  select array['#93CDE6', '#F5BE8F', '#9FD8B0', '#CDA8EC', '#E9D17A', '#F2A7A7', '#A9B3EE', '#EFA7CC'] as colors
)
update public.temp_addresses t
set color = palette.colors[(ranked.position % array_length(palette.colors, 1)) + 1]
from ranked, palette
where t.id = ranked.id;

commit;
