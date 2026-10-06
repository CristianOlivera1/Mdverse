-- ============================================================================
-- Mdverse — phase 3: documents, collaboration and history
--
-- Apply:   supabase link --project-ref <ref> && supabase db push
--          (or paste this file in Dashboard → SQL Editor)
-- Verify:  supabase db advisors   /   pnpm db:rls   (tests/db/rls.mjs)
--
-- Re-runnable: every statement is guarded (`if not exists`, `create or replace`,
-- `drop ... if exists`), so the file can be applied again after an edit.
--
-- Design notes
--   * One row in `documents` per editor tab: unlimited, each with its own title
--     and slug. Renaming never changes the slug (public links must stay stable).
--   * Authorization is expressed once, in the `private` helpers, and read by the
--     policies. The helpers are SECURITY DEFINER because a policy on `documents`
--     that reads `document_collaborators` (which itself has policies referencing
--     `documents`) is recursive and Postgres rejects it. They live outside the
--     exposed schema, take the caller's id as a parameter — they never read an
--     ambient session — and only that one parameter is trusted.
--   * `(select auth.uid())` everywhere instead of `auth.uid()`, so the function is
--     evaluated once per statement (initplan) instead of once per row.
--   * UPDATE policies carry USING *and* WITH CHECK: without the check a
--     collaborator could rewrite `owner_id` and take the document.
--   * Roles: reader (read), editor (read + write), admin (co-owner: manages
--     people and links). Only the owner deletes.
-- ============================================================================

-- Secrets for share links / invitations. Supabase ships pgcrypto in the
-- `extensions` schema and the reference below is schema-qualified, so it does not
-- depend on the session search_path. On a project where pgcrypto lives elsewhere,
-- this is the first statement that fails — move it to that schema and re-run.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'document_visibility' and n.nspname = 'public') then
    create type public.document_visibility as enum ('private', 'unlisted', 'public');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where t.typname = 'collaborator_role' and n.nspname = 'public') then
    create type public.collaborator_role as enum ('reader', 'editor', 'admin');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Reconcile a database where these tables were created by hand
-- ---------------------------------------------------------------------------
-- This project applied the design DDL from the plan (block 6) directly in the
-- SQL Editor, which produced two kinds of drift: columns this code expects and
-- the search index language. `create table if not exists` cannot fix either, so
-- the differences are repaired explicitly here. Everything is idempotent, so the
-- file converges a hand-made schema and a fresh one to the same result.

alter table if exists public.document_versions
  add column if not exists title text not null default '';

alter table if exists public.document_collaborators
  add column if not exists updated_at timestamptz not null default now();

comment on column public.document_versions.title is
  'Title of the replaced revision, so restoring an old version restores the heading too.';

-- `on conflict (document_id, revision)` needs a unique index or constraint. A
-- constraint created by hand and a unique index are both acceptable, so this
-- looks for either before adding one.
do $$
begin
  if to_regclass('public.document_versions') is null then
    return;
  end if;

  if not exists (
    select 1
      from pg_index i
     where i.indrelid = 'public.document_versions'::regclass
       and i.indisunique
       and (
         select array_agg(a.attname::text order by a.attname)
           from unnest(i.indkey) as key
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = key
       ) = array['document_id', 'revision']
  ) then
    execute 'create unique index document_versions_document_revision_idx
               on public.document_versions (document_id, revision)';
  end if;
end
$$;

-- Guardrails for a schema that was created without them: a buggy client must fail
-- loudly instead of storing a 1 GB document or a 10 000 character title.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('documents', 'documents_title_length',   'char_length(title) between 1 and 200'),
      ('documents', 'documents_revision_positive', 'revision >= 1'),
      ('documents', 'documents_content_size',   'octet_length(content) <= 1048576'),
      ('documents', 'documents_slug_format',    'slug ~ ''^[^/?#[:space:]]{1,64}$'''),
      ('comments',  'comments_body_length',     'char_length(body) between 1 and 4000'),
      ('document_invitations', 'document_invitations_email_shape',
       'email ~ ''^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$''')
    ) as t(table_name, constraint_name, expression)
  loop
    if to_regclass('public.' || spec.table_name) is null then
      continue;
    end if;

    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = ('public.' || spec.table_name)::regclass
         and c.conname = spec.constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%s)',
        spec.table_name, spec.constraint_name, spec.expression
      );
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled',
  slug text not null unique,
  content text not null default '',
  visibility public.document_visibility not null default 'private',
  last_edited_by uuid references auth.users (id) on delete set null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_title_length check (char_length(title) between 1 and 200),
  constraint documents_revision_positive check (revision >= 1),
  -- Guardrails, not product limits: a runaway client must fail loudly.
  constraint documents_content_size check (octet_length(content) <= 1048576),
  constraint documents_slug_format check (slug ~ '^[^/?#[:space:]]{1,64}$')
);

comment on table public.documents is
  'One Markdown document per editor tab. Title is user-facing and unique per owner; slug is the stable public identifier.';
comment on column public.documents.slug is
  'URL identifier, assigned once on insert and never changed by a rename. Unique across the whole table (public URLs have no owner segment).';
comment on column public.documents.revision is
  'Monotonic counter for optimistic concurrency: the client sends the revision it read and the update only applies when it still matches.';
comment on column public.documents.visibility is
  'private: owner + collaborators. unlisted: also reachable through a share link token (resolved server-side). public: world-readable and indexable.';

-- ---------------------------------------------------------------------------
-- Collaborators
-- ---------------------------------------------------------------------------
create table if not exists public.document_collaborators (
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.collaborator_role not null default 'reader',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (document_id, user_id)
);

comment on table public.document_collaborators is
  'Who can reach a document, and with which role. The owner is implicit (documents.owner_id) and is not duplicated here.';

-- ---------------------------------------------------------------------------
-- Pending invitations (materialised automatically on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.document_invitations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  email text not null,
  role public.collaborator_role not null default 'reader',
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  invited_by uuid not null references auth.users (id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint document_invitations_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  unique (document_id, email)
);

comment on table public.document_invitations is
  'Invitations aimed at an address that may not have an account yet. `private.handle_new_user_invitations` converts them into collaborators as soon as that address signs up.';

-- ---------------------------------------------------------------------------
-- Version history
-- ---------------------------------------------------------------------------
create table if not exists public.document_versions (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.documents (id) on delete cascade,
  revision integer not null,
  content text not null,
  title text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (document_id, revision)
);

comment on table public.document_versions is
  'Snapshot of the state *before* an edit (content + title of the replaced revision). Restoring a row recreates that text; it never rewrites history.';

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null,
  anchor jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_body_length check (char_length(body) between 1 and 4000)
);

comment on table public.comments is
  'Comment threads. `anchor` holds {from,to,quote} so the comment stays attached to a range of the document; readers may comment, only editors resolve.';

-- ---------------------------------------------------------------------------
-- Share links
-- ---------------------------------------------------------------------------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  role public.collaborator_role not null default 'reader',
  expires_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.share_links is
  'Tokenised links. The token is never listed through the Data API: only the owner/admin can read the row, and the public route resolves token → document server-side (phase 5).';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Names match the design DDL in the plan on purpose: on a database where those
-- indexes already exist these are no-ops instead of duplicates.
-- Dashboard: "my documents, most recently edited first".
create index if not exists documents_owner_idx on public.documents (owner_id, updated_at desc);
-- "Shared with me" without a sequential scan of the collaborators table.
create index if not exists collab_user_idx on public.document_collaborators (user_id, document_id);
create index if not exists versions_doc_idx on public.document_versions (document_id, revision desc);
create index if not exists comments_doc_idx on public.comments (document_id, created_at desc);
create index if not exists comments_unresolved_idx on public.comments (document_id) where resolved = false;
-- `lower(email)` because the trigger matcher is case-insensitive; the design
-- index on the raw column would not be used by that lookup.
create index if not exists document_invitations_email_lower_idx
  on public.document_invitations (lower(email))
  where accepted_at is null;
create index if not exists share_links_document_idx on public.share_links (document_id);
-- The unique constraint on `slug` already provides its index; the design DDL added
-- a second one, which only costs writes.
drop index if exists public.documents_slug_idx;

-- Full-text search (phase 5 exposes it; the column is maintained from day one so
-- enabling search later needs no backfill). English is the product language: a
-- column built elsewhere with another configuration is rebuilt, since a
-- generated expression cannot be altered in place and wrong stemming would
-- silently degrade results. Dropping it loses nothing — it is derived data.
do $$
declare
  current_expression text;
begin
  select pg_get_expr(d.adbin, d.adrelid) into current_expression
    from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.documents'::regclass
     and a.attname = 'search';

  if current_expression is not null and position('english' in current_expression) = 0 then
    execute 'alter table public.documents drop column search';
    current_expression := null;
  end if;

  if current_expression is null and not exists (
    select 1 from pg_attribute
     where attrelid = 'public.documents'::regclass and attname = 'search'
  ) then
    execute $sql$
      alter table public.documents
        add column search tsvector
        generated always as (
          to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
        ) stored
    $sql$;
  end if;
end
$$;

create index if not exists documents_search_idx on public.documents using gin (search);

-- ---------------------------------------------------------------------------
-- updated_at / revision / history triggers
-- ---------------------------------------------------------------------------
drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row
  execute function public.set_updated_at();

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row
  execute function public.set_updated_at();

drop trigger if exists document_collaborators_set_updated_at on public.document_collaborators;
create trigger document_collaborators_set_updated_at
  before update on public.document_collaborators
  for each row
  execute function public.set_updated_at();

-- Optimistic concurrency: the client sends `revision` in its WHERE clause and
-- the server bumps it here, so the next writer with stale data updates 0 rows.
create or replace function public.bump_document_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.revision = old.revision then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_bump_revision on public.documents;
create trigger documents_bump_revision
  before update on public.documents
  for each row
  execute function public.bump_document_revision();

-- Snapshot the replaced state. Throttled by REVISION_INTERVAL: autosave would
-- otherwise store a row every few seconds of typing. The most recent minutes are
-- therefore not individually recoverable — a deliberate trade for a history that
-- stays browsable and cheap.
create or replace function public.snapshot_document_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  last_snapshot timestamptz;
begin
  if old.content is not distinct from new.content and old.title = new.title then
    return new;
  end if;

  select max(created_at) into last_snapshot
    from public.document_versions
   where document_id = old.id;

  if last_snapshot is not null and last_snapshot > now() - interval '10 minutes' then
    return new;
  end if;

  insert into public.document_versions (document_id, revision, content, title, created_by)
  values (old.id, old.revision, old.content, old.title, (select auth.uid()))
  on conflict (document_id, revision) do nothing;

  return new;
end;
$$;

comment on function public.snapshot_document_version() is
  'Keeps a snapshot of the replaced revision at most once every 10 minutes (and only when text changed).';

drop trigger if exists documents_snapshot_version on public.documents;
create trigger documents_snapshot_version
  after update on public.documents
  for each row
  execute function public.snapshot_document_version();

-- ---------------------------------------------------------------------------
-- Slugs
-- ---------------------------------------------------------------------------
-- Same rule as `slugifyHeading` in src/lib/markdown/slug.ts, expressed with the
-- database locale's character classes (accented letters count as letters). The
-- app supplies a slug when it wants exact parity; this is the fallback for
-- inserts coming straight from SQL or the Data API.
create or replace function private.slugify(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    nullif(
      left(
        trim(both '-' from
          regexp_replace(                       -- collapse runs of separators
            regexp_replace(                     -- spaces become dashes
              regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:][:space:]_-]', '', 'g'),
              '[[:space:]]+', '-', 'g'
            ),
            '-{2,}', '-', 'g'
          )
        ),
        64
      ),
      ''
    ),
    'document'
  );
$$;

comment on function private.slugify(text) is
  'Lowercase, punctuation stripped, spaces to dashes, capped at 64 characters. Mirrors src/lib/markdown/slug.ts.';

-- Reserves a free slug by appending -1, -2, … — the same sequential convention
-- the renderer uses for repeated headings.
create or replace function private.unique_document_slug(p_base text, p_exclude_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text := p_base;
  suffix int := 0;
begin
  while exists (
    select 1 from public.documents d
     where d.slug = candidate
       and (p_exclude_id is null or d.id <> p_exclude_id)
  ) loop
    suffix := suffix + 1;
    candidate := left(p_base, 60) || '-' || suffix::text;
  end loop;

  return candidate;
end;
$$;

comment on function private.unique_document_slug(text, uuid) is
  'Sequential -N suffix on collision. A concurrent insert can still race the loop; the unique index rejects the loser and the App retries.';

create or replace function public.set_document_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := private.unique_document_slug(private.slugify(new.title));
  else
    new.slug := private.unique_document_slug(private.slugify(new.slug), new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists documents_set_slug on public.documents;
create trigger documents_set_slug
  before insert on public.documents
  for each row
  execute function public.set_document_slug();

-- ---------------------------------------------------------------------------
-- Authorization helpers (private: not reachable through the Data API)
-- ---------------------------------------------------------------------------
create or replace function private.document_role(p_document_id uuid, p_user_id uuid)
returns public.collaborator_role
language sql
stable
security definer
set search_path = ''
as $$
  select c.role
    from public.document_collaborators c
   where c.document_id = p_document_id
     and c.user_id = p_user_id;
$$;

create or replace function private.is_document_owner(p_document_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and exists (
           select 1 from public.documents d
            where d.id = p_document_id
              and d.owner_id = p_user_id
         );
$$;

/** Owner (any role) or collaborator: who may *reach* the document. */
create or replace function private.can_read_document(p_document_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and (
       exists (
         select 1 from public.documents d
          where d.id = p_document_id
            and (d.owner_id = p_user_id or d.visibility = 'public')
       )
       or private.document_role(p_document_id, p_user_id) is not null
     );
$$;

/** Owner or editor/admin: who may change the text. */
create or replace function private.can_edit_document(p_document_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and (
       exists (
         select 1 from public.documents d
          where d.id = p_document_id
            and d.owner_id = p_user_id
       )
       or private.document_role(p_document_id, p_user_id) in ('editor', 'admin')
     );
$$;

/** Owner or admin: who may hand out access (invitations, links) and delete. */
create or replace function private.can_manage_document(p_document_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
     and (
       exists (
         select 1 from public.documents d
          where d.id = p_document_id
            and d.owner_id = p_user_id
       )
       or private.document_role(p_document_id, p_user_id) = 'admin'
     );
$$;

/**
 * Stored `owner_id` of a document, for policies that must prove the column did
 * not move.
 *
 * A policy on `documents` cannot read `documents` directly: Postgres answers
 * `42P17: infinite recursion detected in policy for relation "documents"`,
 * because evaluating the policy re-evaluates the policy. Reading through a
 * SECURITY DEFINER function (owned by the table owner, so it bypasses RLS) is
 * what breaks the cycle.
 */
create or replace function private.document_owner(p_document_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.owner_id from public.documents d where d.id = p_document_id;
$$;

comment on function private.document_role(uuid, uuid) is
  'SECURITY DEFINER is what breaks the recursion between the documents and document_collaborators policies; the user id is a parameter, never read from the session.';

revoke execute on function private.document_role(uuid, uuid) from public;
revoke execute on function private.document_owner(uuid) from public;
revoke execute on function private.is_document_owner(uuid, uuid) from public;
revoke execute on function private.can_read_document(uuid, uuid) from public;
revoke execute on function private.can_edit_document(uuid, uuid) from public;
revoke execute on function private.can_manage_document(uuid, uuid) from public;
revoke execute on function private.unique_document_slug(text, uuid) from public;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.document_collaborators enable row level security;
alter table public.document_invitations enable row level security;
alter table public.document_versions enable row level security;
alter table public.comments enable row level security;
alter table public.share_links enable row level security;

-- documents ------------------------------------------------------------------
drop policy if exists documents_select_member_or_public on public.documents;
create policy documents_select_member_or_public
  on public.documents for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or visibility = 'public'
    or private.document_role(id, (select auth.uid())) is not null
  );

-- Anonymous visitors only ever see documents explicitly published.
drop policy if exists documents_select_public_anon on public.documents;
create policy documents_select_public_anon
  on public.documents for select
  to anon
  using (visibility = 'public');

drop policy if exists documents_insert_self on public.documents;
create policy documents_insert_self
  on public.documents for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

-- USING picks the rows (member with write rights), WITH CHECK pins the result:
-- `owner_id` cannot be reassigned, and a reader cannot promote themselves.
drop policy if exists documents_update_editor on public.documents;
create policy documents_update_editor
  on public.documents for update
  to authenticated
  using (private.can_edit_document(id, (select auth.uid())))
  with check (
    private.can_edit_document(id, (select auth.uid()))
    -- The stored owner cannot be reassigned by an editor. Comparing against the
    -- value already in the row needs `private.document_owner`: a subquery on
    -- `documents` here makes Postgres reject the policy as recursive
    -- (42P17) and every update fails, editors included.
    and owner_id = private.document_owner(id)
  );

drop policy if exists documents_delete_owner on public.documents;
create policy documents_delete_owner
  on public.documents for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- document_collaborators -----------------------------------------------------
drop policy if exists document_collaborators_select_member on public.document_collaborators;
create policy document_collaborators_select_member
  on public.document_collaborators for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or private.can_read_document(document_id, (select auth.uid()))
  );

drop policy if exists document_collaborators_insert_manager on public.document_collaborators;
create policy document_collaborators_insert_manager
  on public.document_collaborators for insert
  to authenticated
  with check (private.can_manage_document(document_id, (select auth.uid())));

drop policy if exists document_collaborators_update_manager on public.document_collaborators;
create policy document_collaborators_update_manager
  on public.document_collaborators for update
  to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())))
  with check (private.can_manage_document(document_id, (select auth.uid())));

drop policy if exists document_collaborators_delete_manager on public.document_collaborators;
create policy document_collaborators_delete_manager
  on public.document_collaborators for delete
  to authenticated
  using (
    private.can_manage_document(document_id, (select auth.uid()))
    -- A collaborator can always walk away from a document.
    or user_id = (select auth.uid())
  );

-- document_invitations -------------------------------------------------------
drop policy if exists document_invitations_select_manager_or_invitee on public.document_invitations;
create policy document_invitations_select_manager_or_invitee
  on public.document_invitations for select
  to authenticated
  using (
    private.can_manage_document(document_id, (select auth.uid()))
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists document_invitations_insert_manager on public.document_invitations;
create policy document_invitations_insert_manager
  on public.document_invitations for insert
  to authenticated
  with check (
    private.can_manage_document(document_id, (select auth.uid()))
    and invited_by = (select auth.uid())
  );

drop policy if exists document_invitations_delete_manager on public.document_invitations;
create policy document_invitations_delete_manager
  on public.document_invitations for delete
  to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())));

-- document_versions ----------------------------------------------------------
drop policy if exists document_versions_select_member on public.document_versions;
create policy document_versions_select_member
  on public.document_versions for select
  to authenticated
  using (private.can_read_document(document_id, (select auth.uid())));

drop policy if exists document_versions_insert_editor on public.document_versions;
create policy document_versions_insert_editor
  on public.document_versions for insert
  to authenticated
  with check (
    private.can_edit_document(document_id, (select auth.uid()))
    and coalesce(created_by, (select auth.uid())) = (select auth.uid())
  );

-- comments -------------------------------------------------------------------
drop policy if exists comments_select_member on public.comments;
create policy comments_select_member
  on public.comments for select
  to authenticated
  using (private.can_read_document(document_id, (select auth.uid())));

-- Readers may comment (the role decides writing the document, not discussing it).
drop policy if exists comments_insert_member on public.comments;
create policy comments_insert_member
  on public.comments for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and private.can_read_document(document_id, (select auth.uid()))
  );

drop policy if exists comments_update_author_or_editor on public.comments;
create policy comments_update_author_or_editor
  on public.comments for update
  to authenticated
  using (
    author_id = (select auth.uid())
    or private.can_manage_document(document_id, (select auth.uid()))
  )
  with check (
    author_id = (select auth.uid())
    or private.can_manage_document(document_id, (select auth.uid()))
  );

drop policy if exists comments_delete_author_or_manager on public.comments;
create policy comments_delete_author_or_manager
  on public.comments for delete
  to authenticated
  using (
    author_id = (select auth.uid())
    or private.can_manage_document(document_id, (select auth.uid()))
  );

-- share_links -----------------------------------------------------------------
-- Deliberately owner/admin only: the token is a credential, so it never travels
-- to a client that has not been granted management of the document.
drop policy if exists share_links_select_manager on public.share_links;
create policy share_links_select_manager
  on public.share_links for select
  to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())));

drop policy if exists share_links_insert_manager on public.share_links;
create policy share_links_insert_manager
  on public.share_links for insert
  to authenticated
  with check (
    private.can_manage_document(document_id, (select auth.uid()))
    and created_by = (select auth.uid())
  );

drop policy if exists share_links_delete_manager on public.share_links;
create policy share_links_delete_manager
  on public.share_links for delete
  to authenticated
  using (private.can_manage_document(document_id, (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Grants (RLS is the gate; a role still needs the table privilege to reach it)
-- ---------------------------------------------------------------------------
revoke all on table public.documents from anon;
revoke all on table public.document_collaborators from anon;
revoke all on table public.document_invitations from anon;
revoke all on table public.document_versions from anon;
revoke all on table public.comments from anon;
revoke all on table public.share_links from anon;

grant select on table public.documents to anon;
grant select, insert, update, delete on table public.documents to authenticated;
grant select, insert, update, delete on table public.document_collaborators to authenticated;
grant select, insert, delete on table public.document_invitations to authenticated;
grant select, insert on table public.document_versions to authenticated;
grant select, insert, update, delete on table public.comments to authenticated;
grant select, insert, delete on table public.share_links to authenticated;

grant usage, select on sequence public.document_versions_id_seq to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.documents to service_role';
    execute 'grant all on table public.document_collaborators to service_role';
    execute 'grant all on table public.document_invitations to service_role';
    execute 'grant all on table public.document_versions to service_role';
    execute 'grant all on table public.comments to service_role';
    execute 'grant all on table public.share_links to service_role';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant usage on schema private to authenticated';
    execute 'grant execute on function private.can_read_document(uuid, uuid) to authenticated';
    execute 'grant execute on function private.can_edit_document(uuid, uuid) to authenticated';
    execute 'grant execute on function private.can_manage_document(uuid, uuid) to authenticated';
    execute 'grant execute on function private.is_document_owner(uuid, uuid) to authenticated';
    execute 'grant execute on function private.document_role(uuid, uuid) to authenticated';
    execute 'grant execute on function private.document_owner(uuid) to authenticated';
    execute 'grant execute on function private.unique_document_slug(text, uuid) to authenticated';
  end if;

end
$$;

-- ---------------------------------------------------------------------------
-- Invitations become collaborators on signup
-- ---------------------------------------------------------------------------
-- A second trigger on auth.users, so the accounts migration keeps owning
-- `handle_new_user` and this one owns everything about invitations.
create or replace function private.handle_new_user_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation record;
begin
  if new.email is null then
    return new;
  end if;

  for invitation in
    select i.id, i.document_id, i.role, i.invited_by
      from public.document_invitations i
     where i.accepted_at is null
       and lower(i.email) = lower(new.email)
  loop
    insert into public.document_collaborators (document_id, user_id, role, invited_by)
    values (invitation.document_id, new.id, invitation.role, invitation.invited_by)
    on conflict (document_id, user_id) do update
      set role = excluded.role,
          updated_at = now();

    update public.document_invitations
       set accepted_at = now()
     where id = invitation.id;
  end loop;

  return new;
end;
$$;

comment on function private.handle_new_user_invitations() is
  'Converts every pending invitation addressed to the new account into a collaborator row. SECURITY DEFINER because GoTrue writes auth.users as supabase_auth_admin, which has no rights on public tables.';

revoke execute on function private.handle_new_user_invitations() from public;

-- Only the auth admin role may fire it; nothing else can reach it. The grant
-- comes after the definition on purpose: `grant ... on function` resolves the
-- function at execution time.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema private to supabase_auth_admin';
    execute 'grant execute on function private.handle_new_user_invitations() to supabase_auth_admin';
  end if;
end
$$;

drop trigger if exists on_auth_user_created_invitations on auth.users;
create trigger on_auth_user_created_invitations
  after insert on auth.users
  for each row
  execute function private.handle_new_user_invitations();
