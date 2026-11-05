-- ============================================================================
-- Mdverse — collections: fixes for 20261104000000_collections
--
-- `20261104000000_collections.sql` was applied before two bugs in it were
-- fixed, so the database still holds the old function bodies. This file only
-- replaces what changed; the table, column, indexes, policies and grants from
-- the original migration are untouched.
--
--   1. `private.ensure_default_collection` declared a variable called `found`,
--      which PL/pgSQL already owns, so the function body failed to compile and
--      every insert without a collection id would have failed with it.
--   2. `public.bump_document_revision` also compared `collection_id`, so filing
--      a document bumped its revision and every opened tab reported a phantom
--      revision conflict right after a move.
--
-- Apply:   supabase db push      (or paste this file in Dashboard → SQL Editor)
-- Verify:  supabase db advisors  /  pnpm db:rls
-- Re-runnable: every statement is guarded.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Moving between collections is not an edit
-- ---------------------------------------------------------------------------
create or replace function public.bump_document_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.revision = old.revision
     and (to_jsonb(new) - 'revision' - 'updated_at' - 'collection_id')
         is distinct from
         (to_jsonb(old) - 'revision' - 'updated_at' - 'collection_id') then
    new.revision := old.revision + 1;
  end if;

  return new;
end;
$$;

comment on function public.bump_document_revision() is
  'Bumps revision for any change except a move between collections, so optimistic concurrency keeps working without phantom conflicts.';

-- ---------------------------------------------------------------------------
-- 2. The default collection helper compiles
-- ---------------------------------------------------------------------------
create or replace function private.ensure_default_collection(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Deliberately not named `found`: that is PL/pgSQL's own variable.
  v_default_id uuid;
begin
  select c.id into v_default_id
    from public.collections c
   where c.owner_id = p_user_id
     and c.is_default
   limit 1;

  if v_default_id is not null then
    return v_default_id;
  end if;

  insert into public.collections (owner_id, name, is_default)
  values (p_user_id, 'General', true)
  on conflict do nothing
  returning id into v_default_id;

  -- A concurrent insert may have won the unique index; read it back.
  if v_default_id is null then
    select c.id into v_default_id
      from public.collections c
     where c.owner_id = p_user_id
       and c.is_default
     limit 1;
  end if;

  return v_default_id;
end;
$$;

comment on function private.ensure_default_collection(uuid) is
  'Returns the owner''s default collection, creating the General one on first use. SECURITY DEFINER so a trigger can call it without the caller''s RLS.';

-- ---------------------------------------------------------------------------
-- 3. Filing trigger, rebuilt so it points at the fixed helper
-- ---------------------------------------------------------------------------
create or replace function private.file_document_in_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.collection_id is null then
    new.collection_id := private.ensure_default_collection(new.owner_id);
    return new;
  end if;

  -- A collection must belong to the document owner. An unknown or foreign id
  -- falls back to the default collection instead of failing the insert.
  if not exists (
    select 1
      from public.collections c
     where c.id = new.collection_id
       and c.owner_id = new.owner_id
  ) then
    new.collection_id := private.ensure_default_collection(new.owner_id);
  end if;

  return new;
end;
$$;

drop trigger if exists documents_file_collection on public.documents;
create trigger documents_file_collection
  before insert or update of collection_id, owner_id on public.documents
  for each row
  execute function private.file_document_in_collection();

-- ---------------------------------------------------------------------------
-- 4. Backfill again: accounts created since the first run, documents that
--    arrived without a collection, and owners whose default never got created
--    because the helper above failed to compile.
-- ---------------------------------------------------------------------------
insert into public.collections (owner_id, name, is_default)
select distinct d.owner_id, 'General', true
  from public.documents d
 where not exists (
   select 1 from public.collections c
    where c.owner_id = d.owner_id
      and c.is_default
 )
on conflict do nothing;

update public.documents d
   set collection_id = c.id
  from public.collections c
 where d.collection_id is null
   and c.owner_id = d.owner_id
   and c.is_default;
