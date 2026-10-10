<div align="center">
<picture>
  <source
    media="(prefers-color-scheme: dark)"
    srcset="public/svg/logo-calligraphy-black.svg"
  />

  <img
    width="50%"
    alt="Mdverse"
    src="public/svg/logo-calligraphy.svg"
  />
</picture>

  <img src="https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white" alt="Astro 7" /> <img src="https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white" alt="Supabase" /> <img src="https://img.shields.io/badge/Tailwind-v4-38BDF8?logo=tailwindcss&logoColor=white" alt="Tailwind v4" /> <img src="https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare" /> <img src="https://img.shields.io/badge/Deploy-pages.dev-F6821F?logo=cloudflare&logoColor=white" alt="Deploy pages.dev" />
</div>

<p align="center">Write Markdown with live preview — solo or together, in the browser, backed by real accounts.</p>

<p align="center"><a href="https://mdverse.dev"><strong>Live demo</strong></a> · <a href="#quickstart">Get started</a> · <a href="https://mdverse.dev/dashboard">Open dashboard</a></p>

<img width="1179" height="675" alt="Mdverse editor with live preview" src="https://github.com/user-attachments/assets/9833b93e-4808-48a5-95c9-f69493cb1ad1" />

## Why Mdverse

Six reasons writers stay:

- **See it as you write.** Live preview with syntax highlighting, Mermaid diagrams, math equations, footnotes, and task lists.
- **Never lose work.** Autosave with a revision guard that warns before overwriting, plus per-document version history with one-click restore.
- **Write together, live.** Shared cursors, presence avatars, roles, and threaded comments with mentions and resolve states.
- **Share on your terms.** Invite by email, open share links, approve access requests, or publish a read-only page.
- **Take it anywhere.** Copy, download `.md`, or export real HTML, PDF, and Word — with images embedded.
- **Private by default.** Owner-only access enforced by Supabase Row Level Security, verified emails, and rate-limited auth.

## Features

| Area | What you get |
|---|---|
| ✍️ Editor | Live preview, code highlighting, Mermaid, KaTeX math, footnotes, task lists, tables, draggable tabs, find & replace with match highlights, auto-generated index with deep links |
| 🤝 Collaboration | Live cursors and presence, reader/editor/admin roles, email invites, share links, access requests, threaded comments with mentions |
| 📢 Publishing | Public SEO-ready pages with social cards, sitemap and `llms.txt`, one-file HTML/Markdown exports |
| 🖼️ Media | Drag, paste, or upload images (Supabase Storage) with instant feedback |
| 🔐 Accounts | Email + GitHub/Google OAuth, Resend-verified emails, honeypot and rate-limited auth, guest drafts with one-click import |
| 📱 Everywhere | Responsive layout with mobile overflow menu, floating toasts, and skeleton loading states |

## How it works

1. **Write** in Markdown and watch the preview update live, with index and search at hand.
   Code blocks, equations, diagrams, and smart lists all render instantly.
2. **Organize** from the dashboard: open documents in draggable named tabs and switch freely.
   Create, rename, and delete without losing your place.
3. **Sign in to keep it:** a verified email or OAuth saves your work, unlocks history, comments, and sharing.
   Guests import their local drafts once, then everything syncs to their account.

> Guests edit locally in the browser. Signing in offers a one-time import of local drafts.

## Perfect for

One editor, many jobs:

| Use case | What you get |
|---|---|
| Notes | Fast capture with autosave and instant search |
| Docs | Clean structure with index, equations, code blocks, and diagrams |
| Teams | Shared editing with roles, comments, and access control |
| Blog drafts | Distraction-free writing with HTML, PDF, and Word export |
| Study | Versioned notes with tasks you can revisit and restore |

## Your data is safe

Your words stay yours:

- **Owner-only by default:** Row Level Security limits each document to its owner and invited collaborators.
- **Verified identities:** every account confirms its email through a single branded sender.
- **Abuse-resistant:** rate-limited auth, honeypot traps, and server-side validation on titles, content, and permissions.
- **Yours to take:** export anytime via copy, `.md`, HTML, PDF, or Word.

## Quickstart

Run it locally in under a minute:

```bash
pnpm install
cp .env.example .env # set PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL
pnpm dev # http://localhost:4321
```

All email (signup confirmation, password resets, invites) is sent through [Resend](https://resend.com); Supabase handles accounts and sessions only. Keep "Confirm email" **enabled** in the Supabase dashboard so unconfirmed addresses cannot sign in - the confirmation link itself always comes from Resend.

## Status

- **Done:** editor foundations, auth with verification, documents with history, realtime collaboration and sharing, comments with resolve states, public pages with SEO, and real HTML/PDF/Word exports.
- **Next:** polish driven by real usage — open an issue with what hurts most.

## Try it now

Open the **[live demo](https://mdverse.dev)**, write your first note, then sign in to keep it forever.
