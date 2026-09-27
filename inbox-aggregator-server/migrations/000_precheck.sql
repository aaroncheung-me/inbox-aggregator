-- Run this BEFORE 001_multi_account.sql. It changes nothing, it only looks.
-- Run each query separately in the Supabase SQL Editor.

-- 1. Duplicate accounts (same user + same email). Must return NO rows.
--    001 adds a rule that each email can only be connected once per user.
select user_id, email_address, count(*) as copies, array_agg(id order by id) as account_ids
from public.accounts
group by user_id, email_address
having count(*) > 1;

-- 2. Messages whose account no longer exists. Must be 0.
--    001 links messages to accounts, which fails if any point at a missing account.
select count(*) as orphaned_messages
from public.messages m
where m.account_id is not null
  and not exists (select 1 from public.accounts a where a.id = m.account_id);

-- 3. Which user each account belongs to. All should be
--    00000000-0000-0000-0000-000000000001 (the placeholder user the server uses until login exists).
select id, email_address, user_id
from public.accounts
order by id;
