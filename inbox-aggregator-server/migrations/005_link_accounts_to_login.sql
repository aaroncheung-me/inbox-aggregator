-- 005: hand the existing accounts (and so all their messages) from the
-- placeholder user to your real login, and tie accounts to Supabase users.
--
-- Before running:
--   1. Create your user under Authentication -> Users -> Add user.
--   2. If you sign in with a different address, change login_email below.

begin;

do $$
declare
  login_email text := 'aaronccc999@gmail.com'; -- the address you sign in with
  owner_id uuid;
begin
  select id into owner_id from auth.users where lower(email) = lower(login_email);
  if owner_id is null then
    raise exception 'No user with email %. Create it under Authentication -> Users first.', login_email;
  end if;

  update public.accounts
  set user_id = owner_id
  where user_id = '00000000-0000-0000-0000-000000000001';
end $$;

-- every account belongs to a real user; deleting a user deletes their accounts and messages
alter table public.accounts alter column user_id set not null;
alter table public.accounts
  add constraint accounts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

commit;
