-- 006: search functions for basic search and the AI assistant.
-- Paste this whole file into the Supabase SQL Editor and run it.
--
-- Both functions take the same optional filters (null = don't filter):
--   sender_filter     text the sender must contain, case-insensitive ("dr patel", "@eyecare.com")
--   after_date        received on or after this time
--   before_date       received before this time
--   attachments_only  only messages with attachments

begin;

-- replaced by search_messages_semantic below
drop function if exists public.match_messages(vector, uuid, integer, bigint[]);

-- Meaning-based search: nearest embeddings first.
create or replace function public.search_messages_semantic(
  query_embedding vector,
  match_user_id uuid,
  match_account_ids bigint[],
  match_count integer default 10,
  sender_filter text default null,
  after_date timestamptz default null,
  before_date timestamptz default null,
  attachments_only boolean default false
)
returns table(
  id bigint, account_id bigint, subject text, sender text, snippet text, body text,
  received_at timestamptz, has_attachments boolean, score double precision
)
language sql
stable
as $$
  select
    m.id, m.account_id, m.subject, m.sender, m.snippet, m.body, m.received_at, m.has_attachments,
    1 - (m.embedding <=> query_embedding) as score
  from public.messages m
  join public.accounts a on a.id = m.account_id
  where a.user_id = match_user_id
    and m.account_id = any(match_account_ids)
    and m.embedding is not null
    and (sender_filter is null or strpos(lower(m.sender), lower(sender_filter)) > 0)
    and (after_date is null or m.received_at >= after_date)
    and (before_date is null or m.received_at < before_date)
    and (not attachments_only or m.has_attachments)
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- Keyword search over subject, sender and body, best matches first.
--   match_any = false: search_query is search-box syntax, every word must appear
--                      ("glasses prescription", "\"visit summary\"", "rx or prescription", "-newsletter")
--   match_any = true:  any of the words may appear, more matches rank higher
--                      (used when the query is a whole question, not keywords)
-- An empty search_query applies only the filters, newest first.
create or replace function public.search_messages_keyword(
  search_query text,
  match_user_id uuid,
  match_account_ids bigint[],
  match_count integer default 10,
  match_offset integer default 0,
  match_any boolean default false,
  sender_filter text default null,
  after_date timestamptz default null,
  before_date timestamptz default null,
  attachments_only boolean default false
)
returns table(
  id bigint, account_id bigint, subject text, sender text, snippet text, body text,
  received_at timestamptz, has_attachments boolean, is_read boolean, score double precision
)
language sql
stable
as $$
  with q as (
    select case
      when coalesce(trim(search_query), '') = '' then null
      -- plainto_tsquery joins the words with &; swapping in | makes them alternatives
      when match_any then replace(plainto_tsquery('english', search_query)::text, '&', '|')::tsquery
      else websearch_to_tsquery('english', search_query)
    end as tsq
  )
  select
    m.id, m.account_id, m.subject, m.sender, m.snippet, m.body, m.received_at, m.has_attachments, m.is_read,
    coalesce(ts_rank_cd(m.fts, q.tsq), 0)::double precision as score
  from public.messages m
  join public.accounts a on a.id = m.account_id
  cross join q
  where a.user_id = match_user_id
    and m.account_id = any(match_account_ids)
    and (q.tsq is null or m.fts @@ q.tsq)
    and (sender_filter is null or strpos(lower(m.sender), lower(sender_filter)) > 0)
    and (after_date is null or m.received_at >= after_date)
    and (before_date is null or m.received_at < before_date)
    and (not attachments_only or m.has_attachments)
  order by score desc, m.received_at desc nulls last
  limit match_count
  offset match_offset;
$$;

-- Only the server calls these. By default Postgres lets anyone execute a new
-- function, including the public anon key, so take that away.
revoke execute on function public.search_messages_semantic(vector, uuid, bigint[], integer, text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
revoke execute on function public.search_messages_keyword(text, uuid, bigint[], integer, integer, boolean, text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.search_messages_semantic(vector, uuid, bigint[], integer, text, timestamptz, timestamptz, boolean)
  to service_role;
grant execute on function public.search_messages_keyword(text, uuid, bigint[], integer, integer, boolean, text, timestamptz, timestamptz, boolean)
  to service_role;

commit;
