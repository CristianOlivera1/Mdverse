<div align="center">
<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="public/svg/logo-calligraphy-black.svg"
  />

  <img
    width="50%"
    alt="openvid"
    src="public/svg/logo-calligraphy.svg"
  />
</picture>

  <img src="https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white" alt="Astro 7" /> <img src="https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white" alt="Supabase" /> <img src="https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white" alt="Tailwind v4" /> <img src="https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare" /> <img src="https://img.shields.io/badge/Deploy-pages.dev-F6821F?logo=cloudflare&logoColor=white" alt="Deploy pages.dev" />
</div>

<p align="center">Write Markdown with live preview, organized in named documents.</p>

<p align="center"><a href="https://mdverse.dev"><strong>Live demo</strong></a> · <a href="#quickstart">Get started</a> · <a href="https://mdverse.dev/dashboard">Open dashboard</a></p>

<img width="1607" height="920" alt="openvid-1791518338477 (1)" src="https://github.com/user-attachments/assets/5078e6a5-8d31-4165-b618-de09dfd4ba06" />

## Why Mdverse

Four reasons writers stay:

- **See it as you write.** Live preview with code highlighting and Mermaid diagrams.
- **Never lose work.** Autosave with a revision guard that warns before overwriting.
- **Undo anything.** Per-document version history with one-click restore.
- **Private by default.** Owner-only access enforced by Supabase Row Level Security.

## Features

Everything from the classic viewer, now with real accounts and history:

- **Write faster:** live preview, syntax highlighting, and Mermaid diagrams side by side.
- **Stay organized:** unlimited named tabs, each backed by a real saved document.
- **Manage everything:** create, rename, delete, and reopen documents from the dashboard.
- **Recover with confidence:** browse version history and restore any earlier content.
- **Navigate long docs:** find and replace with match case, plus an auto-generated TOC.
- **Ship anywhere:** copy, download `.md`, export clean HTML, or print to PDF.
- **Publish it:** give a document a public, indexable page - with metadata for search and social, a sitemap entry, and one-file HTML or Markdown exports.
- **Start instantly:** work as a guest with local drafts, no signup required.
- **Keep it all:** sign in with email, GitHub, or Google and import drafts in one click.

## How it works

1. **Write** in Markdown and watch the preview update live, with TOC and search at hand.
   Code blocks, diagrams, and smart lists all render instantly.
2. **Organize** from the dashboard: open documents in named tabs and switch freely.
   Create, rename, and delete without losing your place.
3. **Sign in to keep it:** verified email or OAuth saves your work, unlocks history, and prepares sharing.
   Guests import their local drafts once, then everything syncs to their account.

> Guests edit locally in the browser. Signing in offers a one-time import of local drafts.

## Perfect for

One editor, many jobs:

| Use case | What you get |
|---|---|
| Notes | Fast capture with autosave and instant search |
| Docs | Clean structure with TOC, code blocks, and diagrams |
| Blog drafts | Distraction-free writing with HTML and PDF export |
| Study | Versioned notes you can revisit and restore |

## Your data is safe

Your words stay yours:

- **Owner-only by default:** Row Level Security limits each document to its owner and invited collaborators.
- **Validated end to end:** server-side checks guard titles, content, and permissions.
- **Yours to take:** export anytime via copy, `.md`, HTML, or print to PDF.

## Quickstart

Run it locally in under a minute:

```bash
pnpm install
cp .env.example .env # set PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY
pnpm dev # http://localhost:4321
```

## Status

- **Done:** Phases 0–4 - foundations, componentized editor, auth, documents with history, realtime collaboration and sharing.
- **In progress:** Phase 5 - public pages (`/d/:slug`) with SEO, sitemap and reproducible exports are live; comments are next.

## Try it now

Open the **[live demo](https://mdverse.dev)**, write your first note, then sign in to keep it forever.
