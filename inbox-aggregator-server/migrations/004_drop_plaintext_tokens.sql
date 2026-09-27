-- 004: remove the old plaintext refresh_token column.
-- Every account's token now lives encrypted in `credentials`; the server no
-- longer reads or writes this column. Restart the server on the new code
-- BEFORE running this.

begin;

-- refuse to run if any account would lose its only credentials
do $$
begin
  if exists (select 1 from public.accounts where credentials is null and refresh_token is not null) then
    raise exception 'Some accounts still have only a plaintext token; sync them once before running this';
  end if;
end $$;

alter table public.accounts drop column refresh_token;

commit;
