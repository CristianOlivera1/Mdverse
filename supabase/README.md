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
```

No CLI? Paste the contents of `migrations/*.sql` into Dashboard → SQL Editor, in
file order, and regenerate the types locally afterwards.

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
