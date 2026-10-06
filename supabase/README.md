# Supabase

Schema and policies live in `migrations/` as plain SQL, so every environment is
built from the same source of truth. The CLI is pinned in `devDependencies`
(`pnpm supabase …` works without a global install).

## One-time setup

```bash
# 1. Link this repository to your project (needs a scoped personal access token).
pnpm supabase login
pnpm supabase link --project-ref <PROJECT_REF>

# 2. Optional: create supabase/config.toml for the local stack.
#    Do this BEFORE adding other config, or remove the file first.
pnpm supabase init
```

Then copy `.env.example` to `.env` and fill in `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Dashboard → Settings → API).

## Applying migrations

```bash
pnpm db:push        # supabase db push  → applies migrations/ to the linked project
pnpm db:advisors    # supabase db advisors → RLS/permission warnings
pnpm db:types       # regenerates src/lib/supabase/database.types.ts
pnpm db:rls         # tests/db/rls.mjs → verifies the policies against the live project
```

No CLI? Paste the contents of `migrations/*.sql` into Dashboard → SQL Editor, in
file order (a file per query, oldest timestamp first), and regenerate the types
locally afterwards.

## Rule: migrations are the only source of truth

Do **not** paste the design DDL from the plan: it documents the shape of the
schema, not the security that goes with it. Pasting it creates tables with row
level security enabled but **no policies**, which fails closed — the owner cannot
read even their own rows — and the application looks broken for reasons that are
invisible in the dashboard.

Every migration is written to be re-runnable and to reconcile a hand-made schema
(`create table if not exists`, `add column if not exists`, guarded constraints),
so applying the files on top of a database built by hand fixes it in place.

## Verifying security

`pnpm db:rls` creates two throwaway accounts (confirmed, never emailed), acts as
owners, collaborators and anonymous visitors through the Data API — the same path
a browser takes — and deletes them afterwards. It needs no database password and
no CLI: only the three keys already in `.env`.

```
pnpm db:rls

schema
  PASS  required tables exist (6)
accounts (signup triggers)
  PASS  profile row created for rls-check-… -1
…
22/22 checks passed
```

## Local stack (Docker)

```bash
pnpm db:start       # supabase start
pnpm db:reset       # supabase db reset → re-applies every migration from scratch
pnpm db:stop        # supabase stop
```

`db:reset` is the quickest way to check that a migration is replayable, and
`psql "$(pnpm supabase status -o env | grep DB_URL | cut -d= -f2-)"` gives you a
shell. Auth emails land in the local mail catcher (Inbucket/Mailpit) instead of
being sent.

## Rules

- Never commit real keys; `.env` is git-ignored and production values live in the
  Cloudflare dashboard.
- Grant the _secret_ key (`SUPABASE_SECRET_KEY`) only to server code — it bypasses
  RLS.
- Run `pnpm db:advisors` before every deploy; a missing RLS policy is a silent
  data leak.
