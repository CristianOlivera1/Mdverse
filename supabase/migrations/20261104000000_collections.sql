-- ============================================================================
-- Mdverse — collections: group editor tabs by collection
--
-- Apply:   supabase link --project-ref <ref> && supabase db push
--          (or paste this file in Dashboard → SQL Editor)
-- Verify:  supabase db advisors   /   pnpm db:rls   (tests/db/rls.mjs)
--
-- Re-runnable: every statement is guarded, so the file can be applied again
-- after an edit.
--
-- Design notes
--   * A collection belongs to one account (`owner_id`) and holds any number of
--     documents. `documents.collection_id` is the only link: a document lives
--     in exactly one collection, and every account has exactly one default
--     collection (`is_default`, enforced by a partial unique index).
--   * The editor used to show one flat row of tabs. On an existing production
--     database the backfill below gives every owner a `General` collection and
--     files their current documents into it, so nothing disappears.
--   * Collections are private to their owner. Collaborators keep seeing the
--     shared document, grouped by the editor under "Shared with me"; they never
--     read the owner's collection rows.
--   * `private.file_document_in_collection` is SECURITY DEFINER on purpose: a
--     collaborator editing a document must not be able to re-file it into
--     *their* default collection just because RLS hides the owner's rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'General',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_name_length check (char_length(btrim(name)) between 1 and 60)
);

comment on table public.collections is
  'A named group of editor documents, private to its owner. Every account has one default collection, which cannot be deleted.';
comment on column public.collections.is_default is
  'Where a new document lands when no collection is chosen, and where a deleted collection''s documents go. At most one row per owner.';

-- Two collections of the same account cannot share a name (case/space
-- insensitive); the default collection is unique per owner.
create unique index if not exists collections_owner_name_key
  on public.collections (owner_id, lower(btrim(name)));
create unique index if not exists collections_owner_default_key
  on public.collections (owner_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- Documents → collection
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists collection_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.documents'::regclass
       and c.conname = 'documents_collection_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_collection_id_fkey
      foreign key (collection_id) references public.collections (id) on delete set null;
  end if;
end
$$;

create index if not exists documents_collection_idx
  on public.documents (collection_id, updated_at desc);

-- Filing a document in another collection must not look like a text edit:
-- otherwise every open tab of a deleted collection would see a phantom
-- revision conflict. Comparing the whole row keeps the existing behaviour for
-- every other column (content, title, visibility, link_role, …) without this
-- file having to know the exact column list of a schema that also carries
-- `search`. Three keys are set aside: `revision` is the value being computed,
-- `updated_at` is the bookkeeping of the write itself, and `collection_id` is
-- the move. It is replaced *before* the backfill so filing the documents that
-- already exist keeps their revisions, and therefore their open tabs.
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
-- Backfill: existing tabs move into one default collection per owner
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

-- ---------------------------------------------------------------------------
-- Default collection helper + automatic filing
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

drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at
  before update on public.collections
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.collections enable row level security;

drop policy if exists collections_select_owner on public.collections;
create policy collections_select_owner
  on public.collections for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists collections_insert_owner on public.collections;
create policy collections_insert_owner
  on public.collections for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists collections_update_owner on public.collections;
create policy collections_update_owner
  on public.collections for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists collections_delete_owner on public.collections;
create policy collections_delete_owner
  on public.collections for delete
  to authenticated
  using (owner_id = (select auth.uid()) and not is_default);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on table public.collections from anon;
grant select, insert, update, delete on table public.collections to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.collections to service_role';
  end if;

end
$$;

-- No extra grant for `authenticated` on the helpers: they are SECURITY DEFINER
-- (owned by the migration role, so they read `collections` past the caller's
-- RLS) and only ever run from the trigger. The client provisions its default
-- collection with its own RLS-guarded insert into `public.collections`.
-- `authenticated` already has USAGE on schema private from the sharing phase.
