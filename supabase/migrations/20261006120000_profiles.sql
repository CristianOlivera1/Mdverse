-- ============================================================================
-- OpenMarkdown — phase 2: accounts, profiles and RLS
--
-- Apply:   supabase link --project-ref <ref> && supabase db push
-- Verify:  supabase db advisors
--
-- Design notes
--   * Avatars are initials only: no picture column, no avatar bucket.
--   * `public.profiles` is the only table the browser reads in phase 2; phases 3+
--     add documents, collaborators, invitations, versions, comments and links.
--   * RLS is enabled and every policy is scoped `to authenticated` — never via
--     `auth.role()`. Ownership predicates use `(select auth.uid())` so the
--     function is evaluated once per statement instead of once per row.
--   * The signup trigger lives in the `private` schema (unreachable through the
--     Data API) and its EXECUTE grant is narrowed to the auth admin role.
-- ============================================================================

create schema if not exists private;

comment on schema private is
  'Internal helpers. Not exposed through the Supabase Data API; nothing here is granted to anon.';

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,30}$'),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 60)
);

comment on table public.profiles is
  'Account profile. Avatars are rendered from the initials of display_name; no image is stored.';
comment on column public.profiles.username is
  'Unique handle, derived from the email at signup. Lowercase letters, digits and underscores.';

-- Reconcile a database where this table was created by hand (the design DDL in
-- the plan, block 6.2, has no check constraints). `create table if not exists`
-- above cannot add them afterwards, so they are added here. Idempotent, so the
-- file converges a hand-made schema and a fresh one.
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('profiles_username_format', 'username ~ ''^[a-z0-9_]{3,30}$'''),
      ('profiles_display_name_length', 'char_length(display_name) between 1 and 60')
    ) as t(constraint_name, expression)
  loop
    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = 'public.profiles'::regclass
         and c.conname = spec.constraint_name
    ) then
      execute format(
        'alter table public.profiles add constraint %I check (%s)',
        spec.constraint_name, spec.expression
      );
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (the default) and in `public`, because triggers resolve the
-- function by OID for the invoking role: keeping the default EXECUTE grant on a
-- non-definer function is what makes the trigger work for `authenticated`.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Signed-in users can read any profile: collaborators' names and avatars have to
-- be resolvable in phases 3-4. Anonymous visitors get nothing.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- UPDATE needs both USING (which rows) and WITH CHECK (which rows may result):
-- without WITH CHECK a user could rewrite a row to point at someone else.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Deleting an account is `auth.users`' business (`on delete cascade`).
revoke all on table public.profiles from anon;
grant select, insert, update on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Signup trigger: create the profile row for every new account
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username text;
  candidate text;
  suffix int := 0;
begin
  -- Mirror of `usernameFromEmail` in src/lib/auth/profile.ts — keep them in sync.
  -- `+tag` is a routing label, not part of the name, so it is dropped too.
  base_username := lower(split_part(coalesce(new.email, ''), '@', 1));
  base_username := split_part(base_username, '+', 1);
  base_username := regexp_replace(base_username, '[^a-z0-9_]', '', 'g');
  if base_username = '' then
    base_username := 'user';
  end if;
  if length(base_username) < 3 then
    base_username := base_username || 'user';
  end if;
  base_username := left(base_username, 24);

  candidate := base_username;
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    suffix := suffix + 1;
    candidate := left(base_username, 27) || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    -- Prefer the OAuth profile name, then the email local part.
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      initcap(replace(base_username, '_', ' '))
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

comment on function private.handle_new_user() is
  'Creates public.profiles on signup. SECURITY DEFINER is required because GoTrue inserts into auth.users as supabase_auth_admin, which has no rights on public.profiles.';

-- Only the auth admin role may fire it; nothing else can reach it.
revoke execute on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Role-dependent grants (guarded so the migration also runs on a plain Postgres)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema private to supabase_auth_admin';
    execute 'grant execute on function private.handle_new_user() to supabase_auth_admin';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on table public.profiles to service_role';
  end if;
end
$$;
