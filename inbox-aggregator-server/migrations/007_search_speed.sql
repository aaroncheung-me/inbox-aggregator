-- 007: make the search functions from 006 fast enough to stay under
-- Supabase's statement timeout.
--   * meaning search compared the question against every stored embedding
--     (~13k x 1536 numbers read from disk per search); an HNSW index lets it
--     check a few hundred nearby candidates instead
--   * keyword search built its query in a CTE, which kept Postgres from using
--     the full-text index, so it read every message
-- Paste this whole file into the Supabase SQL Editor and run it. Building the
-- index can take a minute.

begin;

-- An index needs a fixed vector size. Every embedding so far comes from
-- text-embedding-3-small, which is 1536 numbers.
alter table public.messages alter column embedding type vector(1536);

create index if not exists messages_embedding_hnsw_idx
  on public.messages using hnsw (embedding vector_cosine_ops);

-- Same signature and results as in 006; only how they run changes.
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
language plpgsql
stable
-- how many candidates the index looks at per search (default 40)
set hnsw.ef_search = 100
as $$
#variable_conflict use_column
declare
  -- the user's own accounts among those asked for, worked out once up front
  owned bigint[] := array(
    select a.id from public.accounts a
    where a.user_id = match_user_id and a.id = any(match_account_ids)
  );
begin
  if sender_filter is null and after_date is null and before_date is null and not attachments_only then
    -- no filters: the index walks straight to the nearest embeddings
    return query
      select m.id, m.account_id, m.subject, m.sender, m.snippet, m.body, m.received_at, m.has_attachments,
             1 - (m.embedding <=> query_embedding)
      from public.messages m
      where m.account_id = any(owned) and m.embedding is not null
      order by m.embedding <=> query_embedding
      limit match_count;
  else
    -- filters: rank only the emails that pass them, exactly. The "+ 0" keeps
    -- Postgres off the index, which would find the nearest emails overall and
    -- then throw away the ones failing the filters, often leaving too few.
    return query
      select m.id, m.account_id, m.subject, m.sender, m.snippet, m.body, m.received_at, m.has_attachments,
             1 - (m.embedding <=> query_embedding)
      from public.messages m
      where m.account_id = any(owned)
        and m.embedding is not null
        and (sender_filter is null or strpos(lower(m.sender), lower(sender_filter)) > 0)
        and (after_date is null or m.received_at >= after_date)
        and (before_date is null or m.received_at < before_date)
        and (not attachments_only or m.has_attachments)
      order by (m.embedding <=> query_embedding) + 0
      limit match_count;
  end if;
end;
$$;

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
language plpgsql
stable
as $$
#variable_conflict use_column
declare
  owned bigint[] := array(
    select a.id from public.accounts a
    where a.user_id = match_user_id and a.id = any(match_account_ids)
  );
  tsq tsquery;
begin
  if coalesce(trim(search_query), '') <> '' then
    tsq := case
      -- plainto_tsquery joins the words with &; swapping in | makes them alternatives
      when match_any then replace(plainto_tsquery('english', search_query)::text, '&', '|')::tsquery
      else websearch_to_tsquery('english', search_query)
    end;
    -- only common words like "the" or "my": nothing to search for
    if numnode(tsq) = 0 then
      return;
    end if;
  end if;

  if tsq is null then
    -- filters only, newest first
    return query
      select m.id, m.account_id, m.subject, m.sender, m.snippet, m.body, m.received_at, m.has_attachments, m.is_read,
             0::double precision
      from public.messages m
      where m.account_id = any(owned)
        and (sender_filter is null or strpos(lower(m.sender), lower(sender_filter)) > 0)
        and (after_date is null or m.received_at >= after_date)
        and (before_date is null or m.received_at < before_date)
        and (not attachments_only or m.has_attachments)
      order by m.received_at desc nulls last
      limit match_count offset match_offset;
  else
    -- "fts @@ tsq" with tsq as a plain value lets Postgres use the full-text index
    return query
      select m.id, m.account_id, m.subject, m.sender, m.snippet, m.body, m.received_at, m.has_attachments, m.is_read,
             ts_rank_cd(m.fts, tsq)::double precision as rank
      from public.messages m
      where m.account_id = any(owned)
        and m.fts @@ tsq
        and (sender_filter is null or strpos(lower(m.sender), lower(sender_filter)) > 0)
        and (after_date is null or m.received_at >= after_date)
        and (before_date is null or m.received_at < before_date)
        and (not attachments_only or m.has_attachments)
      order by rank desc, m.received_at desc nulls last
      limit match_count offset match_offset;
  end if;
end;
$$;

-- pgvector 0.8+ can keep walking the index when the account filter drops
-- candidates (e.g. with some accounts hidden). Older versions skip this.
do $$
begin
  if (select string_to_array(extversion, '.')::int[] >= array[0, 8, 0] from pg_extension where extname = 'vector') then
    execute 'alter function public.search_messages_semantic(vector, uuid, bigint[], integer, text, timestamptz, timestamptz, boolean)
             set hnsw.iterative_scan = relaxed_order';
  end if;
end $$;

commit;

-- refresh the planner's statistics now that the index exists
analyze public.messages;
