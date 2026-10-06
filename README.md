# Mdverse

A production-oriented Markdown viewer/editor built with **Astro 7** and **Supabase**.

The starting point is `visor-markdown.html`, a self-contained static viewer. The migration to a
component-based, multi-user application with real persistence and collaboration is planned in
[PLAN_VISOR_MARKDOWN_PRODUCCION.md](./PLAN_VISOR_MARKDOWN_PRODUCCION.md).

## Language policy

The whole project is written in **English**: UI copy, code identifiers, database tables/columns/enums
and documentation. See block 1.4 of the plan.

## Stack

- **Astro 7** with SSR (`output: 'server'`)
- **Cloudflare adapter** (`@astrojs/cloudflare`) — deployment target: Cloudflare Pages/Workers via GitHub
- **Tailwind CSS v4**, compiled at build time (no CDN)
- **Supabase** (Auth, Postgres + RLS, Realtime) — planned, see the plan

## Requirements

- Node `>=22.12`
- pnpm

## Commands

| Command         | Action                                             |
| :-------------- | :------------------------------------------------- |
| `pnpm install`  | Install dependencies                               |
| `pnpm dev`      | Start the dev server at `localhost:4321`           |
| `pnpm build`    | Build for production into `./dist/`                |
| `pnpm preview`  | Preview the production build                       |
| `pnpm sync`     | Generate Astro types (`.astro/`)                   |
| `pnpm check`    | Typecheck the project (`astro check`)              |
| `pnpm lint`     | Lint with ESLint                                   |
| `pnpm format`   | Format with Prettier                               |
| `pnpm db:types` | Regenerate Supabase types (needs the Supabase CLI) |

## Environment variables

Copy `.env.example` to `.env` and fill in the Supabase values. Only `PUBLIC_`-prefixed variables
reach the browser; `SUPABASE_SECRET_KEY` is server-only and must never be exposed.

## Project status

- **Phase 0 — Foundations:** done (SSR + Cloudflare adapter, strict TypeScript, Tailwind v4, ESLint/Prettier, CI).
- **Phase 1 — Componentization:** done. The single-file viewer is now split into tested modules and Astro components, with feature parity and no CDN dependencies.
- Next: **Phase 2 — Supabase infrastructure** (project, env, `@supabase/ssr`, auth).

## Structure

- `src/lib/markdown` — render pipeline (marked + DOMPurify), highlighting, Mermaid, slugs, TOC.
- `src/lib/editor` — pure edit commands, find/replace, text helpers, preferences, export.
- `src/lib/documents` — document store and legacy draft migration.
- `src/lib/app` — editor and standalone-preview orchestrators.
- `src/components` — `ui/` primitives and `app/` feature components.
- `src/pages` — `/` (editor) and `/preview?doc=<id>` (preview with index).
- `tests/unit` — Vitest suite (run with `pnpm test`).
