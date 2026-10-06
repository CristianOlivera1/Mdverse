# Plan de Producción — Visor de Markdown (Mdverse)

> **Documento de planificación. No incluye implementación.**
> Objetivo: convertir el archivo estático `visor-markdown.html` (~824 líneas, monolítico, 100 % cliente con `localStorage`) en una aplicación Astro de producción con Supabase: autenticación, base de datos, colaboración en tiempo real, compartir documentos, versionado y performance optimizada.
>
> Aplican las siguientes **restricciones confirmadas por el cliente**:
> 1. **Idioma: inglés en todo el proyecto** — UI, código, tablas/columnas/enums de base de datos, mensajes y documentación (ver Bloque 1.4).
> 2. **Editores ilimitados y con nombre** — la plantilla trae solo 2 editores fijos (`a`/`b`); el objetivo son N documentos/pestañas, cada uno con nombre propio editable (ver Bloque 5.4).
> 3. **Compartir** — enlace público **o** invitación por correo con rol **editor** o **lector** (ver Bloques 6 y 8.4).
> 4. **Despliegue en Cloudflare** (Pages/Workers conectado a GitHub) (ver Bloque 10).
> 5. **Sin fotos de perfil** — no se almacenan avatares; los avatares se representan con iniciales (ver Bloques 6 y 7).
>
> Autor: Buffy (Codebuff) · Fecha: 2026-10-06 · Estado: **borrador para aprobación**
> Stack base actual: Astro `7.3.6` · Node `>=22.12` · pnpm · `astro.config.mjs` vacío.

---

## Índice

- [Bloque 0 — Resumen ejecutivo](#bloque-0--resumen-ejecutivo)
- [Bloque 1 — Objetivos, alcance y principios](#bloque-1--objetivos-alcance-y-principios)
- [Bloque 2 — Auditoría del `visor-markdown.html` actual](#bloque-2--auditoría-del-visor-markdownhtml-actual)
- [Bloque 3 — Arquitectura objetivo](#bloque-3--arquitectura-objetivo)
- [Bloque 4 — Estructura de carpetas propuesta](#bloque-4--estructura-de-carpetas-propuesta)
- [Bloque 5 — Plan de componentización (monolito → componentes)](#bloque-5--plan-de-componentización-monolito--componentes)
- [Bloque 6 — Base de datos en Supabase (esquema, RLS, índices)](#bloque-6--base-de-datos-en-supabase-esquema-rls-índices)
- [Bloque 7 — Autenticación y sesiones](#bloque-7--autenticación-y-sesiones)
- [Bloque 8 — Colaboración en tiempo real y resolución de conflictos](#bloque-8--colaboración-en-tiempo-real-y-resolución-de-conflictos)
- [Bloque 9 — Variables de entorno](#bloque-9--variables-de-entorno)
- [Bloque 10 — Configuración manual en el Dashboard de Supabase](#bloque-10--configuración-manual-en-el-dashboard-de-supabase)
- [Bloque 11 — Dependencias a instalar y tooling](#bloque-11--dependencias-a-instalar-y-tooling)
- [Bloque 12 — Fases de implementación (roadmap por hitos)](#bloque-12--fases-de-implementación-roadmap-por-hitos)
- [Bloque 13 — Performance y optimización](#bloque-13--performance-y-optimización)
- [Bloque 14 — Seguridad (alineado a skills de `.agents`)](#bloque-14--seguridad-alineado-a-skills-de-agents)
- [Bloque 15 — Testing y calidad](#bloque-15--testing-y-calidad)
- [Bloque 16 — Mejoras funcionales futuras (backlog)](#bloque-16--mejoras-funcionales-futuras-backlog)
- [Bloque 17 — Riesgos y mitigaciones](#bloque-17--riesgos-y-mitigaciones)
- [Bloque 18 — Criterios de aceptación / Definition of Done](#bloque-18--criterios-de-aceptación--definition-of-done)
- [Anexo A — Mapeo skills `.agents` → bloques del plan](#anexo-a--mapeo-skills-agents--bloques-del-plan)
- [Anexo B — Checklist de arranque en 1 página](#anexo-b--checklist-de-arranque-en-1-página)

---

## Bloque 0 — Resumen ejecutivo

El archivo `visor-markdown.html` es un visor/editor de Markdown **muy completo en UI pero frágil en arquitectura**: un único documento HTML con Tailwind por CDN, todas las librerías por CDN (`marked`, `DOMPurify`, `highlight.js`, `mermaid`, `iconify`) y **toda la persistencia en `localStorage`** (claves `mdviewer:*`). No hay usuarios, no hay servidor, no hay compartir, no hay versionado; si el usuario limpia el navegador, pierde todo.

Este plan lo lleva a producción **sin perder ni una funcionalidad actual** y añadiendo la capa que hoy no existe:

| Hoy (estático) | Producción (con Supabase) |
|---|---|
| Contenido en `localStorage` (por navegador) | Documentos en Postgres con dueño y permisos |
| 2 editores fijos (`a`/`b`), sin nombre | **N documentos/pestañas**, cada uno con **nombre propio** renombrable |
| Sincronización entre pestañas vía evento `storage` | Colaboración multiusuario en tiempo real (Realtime) |
| Sin usuarios | Auth (email/OTP + OAuth) con sesión SSR por cookies |
| Sin compartir | **Enlace público** o **invitación por correo** con rol **editor/lector** |
| Export HTML/PDF en cliente | Export server-side (HTML/PDF/DOCX) opcional |
| Tailwind + libs por CDN | Build con Vite/Tailwind, bundle tree-shaken y cacheado |

**Principio clave:** *evolución, no reescritura*. Primero se extrae el monolito a componentes **con paridad funcional** (misma UX, todavía `localStorage`), y solo después se conecta Supabase. Así cada fase es desplegable y reversible.

**Idioma:** desde la Fase 0, **todo el proyecto pasa a inglés** (UI, código, base de datos y docs). El texto en español del `visor-markdown.html` se traduce durante la Fase 1 (ver Bloque 1.4).
**Destino de despliegue:** **Cloudflare** (Pages/Workers conectado a GitHub).

---

## Bloque 1 — Objetivos, alcance y principios

### 1.1 Objetivos

1. **Paridad funcional total** con `visor-markdown.html` como línea base (ver Bloque 2).
2. **Persistencia real y multiusuario** con Supabase (Postgres + Auth + Realtime + Storage).
3. **Colaboración** tipo Google Docs acotada: presencia, cursores, edición concurrente y comentarios.
4. **Producción de verdad**: SSR, seguridad (RLS + CSP), observabilidad, rendimiento medible y despliegue reproducible.
5. **Código mantenible**: componentes pequeños, TypeScript estricto, lógica de Markdown/editor en módulos puros y testeables.
6. **Idioma único: inglés** en toda la aplicación (UI, código y base de datos) — ver Bloque 1.4.
7. **Editores ilimitados y nombrados**: pasar de los 2 editores fijos a N documentos/pestañas con nombre propio.
8. **Compartir flexible**: enlace público y/o invitación por correo, con rol **editor** o **lector**.

### 1.2 Fuera de alcance (esta iteración)

- App móvil nativa (solo web responsive).
- Offline-first completo (PWA + CRDT persistido) → se deja como fase opcional (Bloque 16).
- Facturación / planes de pago (se diseña con el workspace listo para añadirlo).
- Editor colaborativo con OT completo desde el día 1 (se planifica en dos niveles, ver Bloque 8).

### 1.3 Principios de diseño (senior)

- **Islas y módulos puros:** la UI son componentes Astro; la lógica de Markdown/editor son módulos `.ts` sin dependencias del DOM global, testeables con Vitest.
- **Server-first para datos, cliente-first para edición:** las lecturas/escrituras de documentos pasan por el servidor Astro (Actions/endpoints) con validación; el cliente accede a Supabase solo donde RLS lo permite de forma explícita.
- **Seguridad por defecto:** RLS activado en *todas* las tablas de esquemas expuestos; nunca `service_role` en el navegador; secretos solo server-side.
- **Degradación elegante:** sin sesión se sigue pudiendo escribir localmente (como hoy); al iniciar sesión se ofrece **importar los borradores locales**.
- **Medir antes de optimizar:** presupuesto de rendimiento explícito (Bloque 13) verificado con Lighthouse CI.

### 1.4 Política de idioma: inglés en todo el proyecto

**Decisión:** la aplicación completa, el código y la base de datos usan **inglés**. No hay multi-idioma (i18n) en esta iteración; el español queda fuera del producto.

| Ámbito | Regla | Ejemplo |
|---|---|---|
| UI (textos visibles) | Inglés | `Untitled`, `Editor`, `Preview`, `Search`, `Replace`, `Copy`, `Download`, `Clear`, `Index` |
| Nombre de documento por defecto | Inglés | `"Untitled"` en lugar de `"Sin título"` |
| Rutas / URLs | Inglés | `/dashboard`, `/editor/[id]`, `/preview/[id]`, `/d/[slug]`, `/settings` |
| Base de datos: tablas | Inglés, `snake_case`, plural | `documents`, `document_collaborators`, `share_links`, `document_invitations` |
| Base de datos: columnas | Inglés, `snake_case` | `owner_id`, `title`, `content`, `visibility`, `updated_at` |
| Base de datos: enums | Inglés | `document_visibility = ('private','unlisted','public')`, `collaborator_role = ('reader','editor','admin')` |
| Funciones / triggers SQL | Inglés | `handle_new_user`, `set_updated_at`, `bump_revision` |
| Código (variables, tipos, clases, componentes) | Inglés | `PreviewPane.astro`, `renderMarkdown()`, `DocumentService`, `CollaboratorRole` |
| Mensajes de error / validación | Inglés | `"Document not found"`, `"You don't have permission"` |
| Commits, ramas, PRs | Inglés | `feat(editor): add named tabs` |
| Documentación (`README`, este plan, comentarios) | Inglés desde la Fase 0 | — |
| Contenido del documento de bienvenida | Inglés | Se reescribe la plantilla de bienvenida (atajos, ejemplos) |
| Fechas y hora | `en-US` vía `Intl` | `new Date().toLocaleTimeString('en-US')` |

**Notas de implementación:**
- **No** se introduce ninguna librería de i18n (nada de `astro-i18n`, `i18next`). Si algún día se quiere multi-idioma, se construirá sobre claves ya en inglés.
- La plantilla actual de bienvenida (`# Bienvenido a tu visor de Markdown`, tabla de atajos, etc.) se reescribe en inglés durante la Fase 1.
- Los `slug` de encabezado se mantienen compatibles con GitHub (ya son agnósticos al idioma).
- Los nombres de roles expuestos en la UI son `Editor` y `Reader` (equivalente a "editor" y "lector").

---

## Bloque 2 — Auditoría del `visor-markdown.html` actual

### 2.1 Inventario de funcionalidades (lo que NO se puede perder)

| Área | Funcionalidad actual | Evidencia en el archivo |
|---|---|---|
| Editores | 2 paneles **fijos** (`Editor 1` / `Editor 2`), pestañas, foco/estado activo — hoy **no** se pueden crear más ni renombrar | `MT(id)`, `setAct()`, `panels` |
| Idioma | Textos de UI y contenido de ejemplo en **español** (a migrar a inglés) | `DEFAULTS`, `toast`, placeholders |
| Persistencia | Autosave a `localStorage` con debounce adaptativo | clave `mdviewer:panel-${id}:content`, `flush()` |
| Guardado | En `input` (debounce 80–350 ms), `pagehide`, `visibilitychange` | `save()`, listeners |
| Split | Divisor arrastrable código/preview, `--split` persistido | `.rz`, `setSplit()` |
| Preview | Render en vivo con `marked` + `DOMPurify` | `renderInto()` |
| Diff de DOM | *Patching* para no perder scroll/SVG ni parpadear | `patch()` |
| Código | Resaltado `highlight.js` con caché | `hlCache`, `hljs.highlight` |
| Diagramas | Mermaid con caché de SVG y manejo de error | `renderMermaid()`, `svgCache` |
| Slug | IDs de encabezado compatibles con GitHub | `slug()` |
| Enlaces | Externos → `target=_blank`; internos → scroll en el panel | listener `a[href^="#"]` |
| Índice (TOC) | Sidebar + versión flotante móvil, scroll-spy con `rAF` | `bootPreview()`, `mark()`, `buildToc()` |
| Vista en pestaña | `?preview=a|b` abre solo la vista con índice | `bootPreview()` |
| Sync entre pestañas | Evento `storage` re-renderiza la pestaña de preview | listener `storage` |
| Scroll sincronizado | Bidireccional por proporción, sin bucles, toggle | `link()`, `syncOn`, clave `mdviewer:sync` |
| Zoom de texto | 70 %–180 %, persistido | `setZoom()`, `mdviewer:zoom` |
| Atajos VS Code | `Ctrl+B/I/E/K`, `Ctrl+Shift+X/L/K`, `Ctrl+H`, `Ctrl+/`, `Ctrl+L`, `Ctrl+Enter`, `Alt+↑/↓`, `Shift+Alt+↑/↓`, `Tab`/`Shift+Tab` | `keydown` handler |
| Formato | Barra con negrita, cursiva, tachado, código, enlace, H1–H3, cita, listas, tareas, tabla, bloque, Mermaid, línea, undo/redo, buscar | `FMT_GROUPS`, `ops` |
| Listas inteligentes | Enter continúa listas/numeradas/tareas/citas | `listEnter()` |
| Buscar/Reemplazar | Con distinguir mayúsculas, contador y "reemplazar todo" | `openFind()`, `replaceAll()`, `rx()` |
| Undo/Redo | Nativo vía `document.execCommand` | `ops.undo/redo`, `edit()` |
| Export | Copiar, descargar `.md`, exportar HTML, exportar PDF (print) | `ops.copy/download/html/pdf`, `exportDoc()` |
| Limpiar | Editor activo / todos, con confirmación | `ops.clear`, `clearall` |
| Estado | Línea/columna, líneas/palabras/caracteres, toasts | `pos()`, `info()`, `toast()` |
| Responsive | Tabs código/vista en móvil; menús reposicionados | CSS media queries, `openMenu()` |
| Accesibilidad base | `role`, `aria-label`, `aria-selected`, foco visible, `prefers-reduced-motion` | atributos ARIA y CSS |

### 2.2 Problemas del estado actual (por qué no es producción)

| # | Problema | Impacto |
|---|---|---|
| 1 | **Tailwind por CDN** (`cdn.tailwindcss.com`) | No apto para producción: compila en runtime, sin purge, riesgo de parpadeo y de caída del CDN. |
| 2 | **5 librerías por CDN sin fijar integridad** | Sin SRI, sin control de versión, dependencia de terceros y latencia. Mermaid (~grande) se carga siempre. |
| 3 | **`localStorage` como única persistencia** | Se pierde al limpiar el navegador; límite ~5 MB; sin compartir ni respaldo; contenido no indexable. |
| 4 | **`document.execCommand`** | API *deprecated*; sostiene undo/redo del editor → deuda técnica a documentar. |
| 5 | **Monolito de ~824 líneas** | Todo acoplado (DOM, estado, render, export) → difícil de testear y evolucionar. |
| 6 | **Sin usuarios ni permisos** | No hay dueño, roles ni auditoría. |
| 7 | **Sin servidor** | No hay SSR, ni SEO para documentos públicos, ni export server-side, ni webhooks. |
| 8 | **`innerHTML` con HTML del usuario** | Mitigado con DOMPurify, pero la superficie XSS debe revisarse por skill de seguridad (ver Bloque 14). |
| 9 | **Sin tests ni CI** | Cualquier refactor es riesgoso. |
| 10 | **Sin observabilidad** | No hay errores, métricas ni trazas. |
| 11 | **Editores fijos (2) y sin nombre** | El usuario no puede tener más documentos ni identificarlos por nombre. |
| 12 | **UI y contenido en español** | Requisito del cliente: **todo en inglés** (Bloque 1.4). |
| 13 | **Sin compartir** | No existe enlace público ni invitación por correo con rol. |
| 14 | **Sin hosting definido** | No hay destino de despliegue; el cliente usará Cloudflare. |

---

## Bloque 3 — Arquitectura objetivo

### 3.1 Diagrama lógico

```
┌──────────────────────────── Navegador ────────────────────────────┐
│  Astro (islas) + módulos TS puros                                 │
│  Editor (CodePane) · Preview (MarkdownRenderer) · TOC · Toolbar   │
│  Estado local: nanostores · Persistencia local: IndexedDB/local   │
│  Realtime cliente: supabase-js (Realtime channels + presence)     │
└───────┬───────────────────────────────────────────────┬──────────┘
        │ fetch (cookies)                                │ WS (Realtime)
        ▼                                                ▼
┌─────────────────── Astro SSR (Cloudflare adapter) ───────────────┐
│  Middleware: sesión Supabase + guards de ruta                    │
│  Actions/Endpoints: validación (Zod), lógica de negocio          │
│  Render server-side de Markdown para páginas públicas (SEO)      │
│  Export server-side (HTML/PDF/DOCX) [opcional, fase 5]           │
└───────────────────────────────┬──────────────────────────────────┘
                                │ supabase-js (server) / SQL
                                ▼
┌────────────────────────────── Supabase ───────────────────────────┐
│  Auth (email/OTP, OAuth) · Postgres + RLS · Realtime · Storage    │
│  Edge Functions (opcional): exports, webhooks, jobs programados   │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 Decisiones de arquitectura (ADR resumido)

| Decisión | Elección | Motivo |
|---|---|---|
| Renderizado | **SSR on-demand** con adapter de **Cloudflare** (`@astrojs/cloudflare`) | Necesitamos cookies de sesión, endpoints y SEO; y el cliente desplegará en Cloudflare. |
| Estado de editor | **nanostores** (o store propio) + módulos puros | Ligero, islas-friendly, fácil de testear; evita meter React/Vue solo por el estado. |
| Acceso a datos | Lecturas directas cliente→Supabase con **RLS**; mutaciones sensibles por **Astro Actions** | RLS es la frontera de seguridad; las Actions validan y centralizan reglas. |
| Tiempo real | **Supabase Realtime** (Postgres Changes + Broadcast + Presence) | Nativo, sin servidor extra; suficiente para la Fase 4. |
| Conflicto | Fase 4: autosave con **LWW + control de versión**; Fase opcional: **Yjs (CRDT)** | Entrega incremental sin sobre-ingeniería. |
| Markdown | `marked` + `DOMPurify` (mismas libs, ahora bundladas) | Paridad y seguridad ya probadas. |
| Estilos | **Tailwind v4** vía plugin de Vite + tokens CSS (`--z`, `--split`) | Quita el CDN y mantiene el diseño. |
| Tipos | TypeScript estricto + tipos generados de Supabase (`database.types.ts`) | Seguridad de tipos end-to-end. |
| Idioma | **Inglés** en UI, código y base de datos | Requisito del cliente (Bloque 1.4). |
| Validación | **Zod** en la frontera (Actions/endpoints) | Evita datos sucios en Postgres. |

### 3.3 Presupuesto de rendimiento (objetivo)

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| LCP (editor cargado) | < 2.0 s en 4G rápido | Lighthouse CI |
| JS inicial transferido | < 150 KB gzip (sin Mermaid) | `astro build` + bundle report |
| Mermaid | Carga diferida, < 0 ms hasta el primer bloque | Dynamic import + IntersectionObserver |
| Interacción (INP) | < 200 ms | Lighthouse / campo |
| Render de doc 10k palabras | < 16 ms por patch incremental | Benchmark en Vitest |

---

## Bloque 4 — Estructura de carpetas propuesta

```
mdverse/
├─ astro.config.mjs                 # adapter Cloudflare, tailwind, alias, env schema
├─ wrangler.jsonc                   # configuración Cloudflare (assets, compat flags, envs)
├─ tsconfig.json                    # strict, paths (@/*)
├─ .env.example                     # plantilla de variables (Bloque 9)
├─ README.md
├─ PLAN_VISOR_MARKDOWN_PRODUCCION.md
├─ src/
│  ├─ env.d.ts                      # tipado de import.meta.env
│  ├─ middleware.ts                 # sesión Supabase + guards
│  ├─ layouts/
│  │  ├─ BaseLayout.astro           # <html>, metas, fuentes, CSS global
│  │  ├─ EditorLayout.astro         # chrome del editor (header/footer)
│  │  └─ PublicLayout.astro         # documento público (SEO)
│  ├─ components/
│  │  ├─ ui/                        # primitivas reutilizables
│  │  │  ├─ Icon.astro              # iconos (lucide, sin CDN de iconify)
│  │  │  ├─ Popover.astro           # .pop con posicionamiento automático
│  │  │  ├─ Switch.astro            # .sw
│  │  │  ├─ Toast.astro             # avisos del footer
│  │  │  ├─ Button.astro
│  │  │  └─ ConfirmDialog.astro
│  │  ├─ header/
│  │  │  ├─ AppHeader.astro         # barra superior completa
│  │  │  ├─ DocumentTabs.astro      # pestañas de documentos abiertos (N, con nombre)
│  │  │  ├─ TabRenameInput.astro    # renombrar el documento/pestaña activo
│  │  │  ├─ PanelToggle.astro       # código / vista (móvil)
│  │  │  ├─ ExportMenu.astro        # copiar, .md, HTML, PDF
│  │  │  ├─ ViewMenu.astro          # sync scroll, zoom, popout
│  │  │  └─ ClearMenu.astro
│  │  ├─ editor/
│  │  │  ├─ EditorPane.astro        # contenedor de un documento
│  │  │  ├─ CodePane.astro          # <textarea> + status
│  │  │  ├─ Splitter.astro          # divisor arrastrable
│  │  │  ├─ FormatToolbar.astro     # barra de formato Markdown
│  │  │  ├─ FindReplace.astro       # buscar/reemplazar
│  │  │  └─ StatusBar.astro         # Ln/Col, líneas/palabras, toasts
│  │  ├─ preview/
│  │  │  ├─ PreviewPane.astro       # contenedor de la vista
│  │  │  ├─ MarkdownRenderer.astro  # aplica el pipeline de render
│  │  │  ├─ MermaidBlock.astro      # carga diferida de Mermaid
│  │  │  ├─ Toc.astro               # índice (sidebar)
│  │  │  └─ TocFloat.astro          # índice móvil
│  │  ├─ auth/
│  │  │  ├─ AuthButton.astro
│  │  │  ├─ UserMenu.astro
│  │  │  └─ LoginForm.astro
│  │  └─ collab/
│  │     ├─ PresenceBar.astro       # conectados, como iniciales (sin fotos)
│  │     ├─ ShareModal.astro        # invitar + enlace público
│  │     └─ CommentsPanel.astro
│  ├─ lib/
│  │  ├─ markdown/
│  │  │  ├─ renderer.ts             # marked + slugs + enlaces
│  │  │  ├─ sanitize.ts             # DOMPurify con allowlist
│  │  │  ├─ highlight.ts            # hljs con lenguajes acotados + caché
│  │  │  ├─ mermaid.ts              # init, render, caché, lazy
│  │  │  ├─ slug.ts                 # slug estilo GitHub
│  │  │  └─ patch.ts                # DOM diff incremental
│  │  ├─ editor/
│  │  │  ├─ commands.ts             # wrap/pre/block/lists/fence…
│  │  │  ├─ shortcuts.ts            # mapa de atajos VS Code
│  │  │  ├─ findReplace.ts          # búsqueda, conteo, reemplazo
│  │  │  ├─ split.ts                # % del divisor
│  │  │  ├─ zoom.ts                 # tamaño de texto
│  │  │  └─ persistence.ts          # IndexedDB/local + migración a nube
│  │  ├─ supabase/
│  │  │  ├─ client.ts               # createBrowserClient
│  │  │  ├─ server.ts               # createServerClient (cookies)
│  │  │  ├─ database.types.ts       # tipos generados (supabase gen types)
│  │  │  └─ realtime.ts             # canales, presencia, reconexión
│  │  ├─ documents/
│  │  │  ├─ queries.ts              # selects tipados (RLS)
│  │  │  ├─ mutations.ts            # create/rename/delete/update
│  │  │  ├─ versions.ts             # snapshots y restauración
│  │  │  └─ permissions.ts          # dueño/colaborador/rol
│  │  ├─ schemas/                   # Zod (documento, comentario, invitación)
│  │  └─ utils/                     # slug, format, debounce, ids
│  ├─ stores/
│  │  ├─ editor.ts                  # documento activo, dirty, zoom, split
│  │  ├─ session.ts                 # usuario y sesión
│  │  └─ collab.ts                  # peers, cursores, estado de conexión
│  ├─ actions/                      # Astro Actions (server)
│  │  ├─ documents.ts               # create, update, delete, restore
│  │  ├─ collaborators.ts           # invitar, cambiar rol, quitar
│  │  ├─ comments.ts
│  │  └─ export.ts                  # HTML/PDF/DOCX server-side
│  ├─ pages/
│  │  ├─ index.astro                # landing o redirect a /dashboard
│  │  ├─ login.astro
│  │  ├─ dashboard.astro            # lista de documentos
│  │  ├─ editor/[id].astro          # editor de un documento
│  │  ├─ preview/[id].astro         # vista con índice (equivale a ?preview=)
│  │  ├─ d/[slug].astro             # documento público (SSR + SEO)
│  │  ├─ settings.astro             # perfil y preferencias
│  │  └─ auth/callback.ts           # callback OAuth
│  ├─ styles/
│  │  ├─ global.css                 # Tailwind + tokens (--z, --split)
│  │  └─ markdown.css               # .prose y estilos de exportación
│  └─ content/                      # content collections (docs de ayuda, opcional)
├─ supabase/
│  ├─ config.toml
│  ├─ schemas/                      # esquema declarativo (fuente de verdad)
│  ├─ migrations/                   # migraciones generadas/revisadas
│  └─ seed.sql                      # datos de desarrollo
├─ tests/
│  ├─ unit/                         # Vitest: lib/*
│  ├─ e2e/                          # Playwright: flujos de editor
│  └─ db/                           # pruebas de RLS (pgTAP o SQL)
├─ public/
│  ├─ fonts/                        # Inter + JetBrains Mono (self-host)
│  └─ favicon.svg
└─ .github/workflows/ci.yml         # typecheck, lint, test, build, Lighthouse
```

> **Nota:** la convención `src/pages` es obligatoria en Astro; el resto son convenciones recomendadas (`components`, `layouts`, `styles`). Ver skill `astro` en `.agents/skills/astro/SKILL.md`.

---

## Bloque 5 — Plan de componentización (monolito → componentes)

### 5.1 Estrategia de extracción (sin romper nada)

1. **Fase 1a — CSS:** mover el `<style>` a `src/styles/global.css` y `markdown.css`; reemplazar Tailwind CDN por Tailwind v4 vía Vite. Mantener los tokens `--z` y `--split`.
2. **Fase 1b — Librerías:** sustituir los 5 `<script src>` CDN por dependencias npm importadas en módulos (`lib/markdown/*`). Los iconos (`iconify-icon`) pasan a `components/ui/Icon.astro` (SVG estáticos de Lucide) o a una carga local, eliminando el CDN de Iconify.
3. **Fase 1c — Módulos puros:** extraer de `lib/*` la lógica sin DOM global: `slug`, `patch`, `commands`, `findReplace`, `shortcuts`, `renderer`, `sanitize`.
4. **Fase 1d — Componentes Astro:** partir el HTML en los componentes del Bloque 4, respetando los mismos `data-*` para no reescribir los handlers de golpe. **Además se generaliza el par fijo `a`/`b` a N pestañas dinámicas con nombre editable.**
5. **Fase 1e — Orquestador cliente:** un único módulo de "app" que conecta componentes y stores (equivalente a `bootEditor()`), hasta sustituirlo por islas independientes.
6. **Verificación:** suite de paridad (Bloque 15) que reproduce el checklist del Bloque 2.1 antes de tocar Supabase.

### 5.2 Mapeo función → componente → módulo

| Función actual | Componente destino | Módulo/servicio |
|---|---|---|
| `MT(id)`, `initPanel()` | `EditorPane.astro` + `CodePane.astro` | `stores/editor.ts`, `lib/editor/*` |
| `#editors`, tabs A/B (**fijas**) | `DocumentTabs.astro` + `TabRenameInput.astro` | `stores/editor.ts` (lista dinámica de pestañas) |
| `.rz`, `setSplit()` | `Splitter.astro` | `lib/editor/split.ts` |
| `renderInto()`, `patch()` | `MarkdownRenderer.astro` | `lib/markdown/renderer.ts`, `patch.ts` |
| `DOMPurify.sanitize` | — | `lib/markdown/sanitize.ts` |
| `hljs` + `hlCache` | — | `lib/markdown/highlight.ts` |
| `renderMermaid` + `svgCache` | `MermaidBlock.astro` | `lib/markdown/mermaid.ts` (lazy) |
| `slug()` | — | `lib/markdown/slug.ts` |
| `buildToc()`, `mark()` | `Toc.astro`, `TocFloat.astro` | `lib/markdown/toc.ts` (scroll-spy) |
| `bootPreview()` (`?preview=`) | `pages/preview/[id].astro` | `stores/editor.ts` |
| `wrap/pre/block/fence/lines` | `FormatToolbar.astro` | `lib/editor/commands.ts` |
| `keydown` (atajos) | — | `lib/editor/shortcuts.ts` |
| `openFind/replaceAll` | `FindReplace.astro` | `lib/editor/findReplace.ts` |
| `setZoom()`, menú vista | `ViewMenu.astro` | `lib/editor/zoom.ts` |
| `exportDoc()` (HTML/PDF) | `ExportMenu.astro` | `actions/export.ts` (server) + cliente |
| `ops.copy/download` | `ExportMenu.astro` | `lib/editor/exportClient.ts` |
| `toast`, `pos`, `info` | `StatusBar.astro` | `stores/editor.ts` |
| `store` (localStorage) | — | `lib/editor/persistence.ts` (IndexedDB) |
| Menús/popovers | `ui/Popover.astro` | `lib/ui/positioning.ts` |
| Header acciones | `AppHeader.astro` | `stores/editor.ts` |

### 5.3 Migración del estado

- **Sustituir `localStorage` por IndexedDB** (vía `idb-keyval` o similar) para tolerar documentos grandes y drafts offline.
- **Importación one-time:** al iniciar sesión, detectar claves `mdviewer:panel-*` y ofrecer importarlas como documentos (evita pérdida de datos en la transición).
- **Claves actuales a versionar:** `mdviewer:panel-a:content`, `mdviewer:panel-b:content`, `mdviewer:zoom`, `mdviewer:split`, `mdviewer:sync`, `mdviewer:tab`, `mdviewer:toc`.

### 5.4 De 2 editores fijos a N pestañas con nombre

Hoy `bootEditor()` crea exactamente dos editores (`a` y `b`) y los fija en el HTML. El modelo objetivo:

- **Documento = pestaña.** Cada documento tiene `id` (uuid), `title` (nombre visible, editable) y `content`.
- **N pestañas abiertas**, cada una con su propio scroll, zoom de split y estado (se generaliza lo que hoy se guarda por editor `a`/`b`).
- **Crear:** botón `+ New` en `DocumentTabs` (o `Cmd/Ctrl+T`). Crea un documento `Untitled` y lo abre.
- **Renombrar:** doble clic en el título de la pestaña, `Cmd/Ctrl+Shift+R`, o menú contextual de la pestaña. Persiste `title` con debounce y validación de longitud.
- **Cerrar:** botón `×` en la pestaña (confirmación si hay cambios sin guardar) y `Cmd/Ctrl+W`.
- **Reordenar:** arrastrar pestañas; el orden se guarda en las preferencias del usuario.
- **Persistencia del nombre:** en local (IndexedDB) antes de iniciar sesión; en `documents.title` tras conectar Supabase.
- **Título del navegador** (`document.title`) = nombre del documento activo.
- **Límite configurable** de pestañas abiertas (p. ej. 20) para no agotar memoria; al superarlo se cierra la más antigua, pero el documento permanece en el dashboard.

---

## Bloque 6 — Base de datos en Supabase (esquema, RLS, índices)

> Diseño alineado a `.agents/skills/supabase-postgres-best-practices` (índices, tipos, concurrencia) y a `.agents/skills/supabase` (RLS, checklist de seguridad).

### 6.1 Diagrama entidad-relación (resumen)

```
auth.users 1───1 profiles
auth.users 1───* documents (owner_id)
documents  *───* profiles  vía document_collaborators (role)
documents 1───* document_versions
documents 1───* comments (autor: profiles)
documents 1───* share_links
documents 1───* document_invitations
profiles   1───* comments
```

### 6.2 Tablas (DDL de diseño, no ejecutado)

```sql
-- Enums
create type document_visibility as enum ('private', 'unlisted', 'public');
create type collaborator_role   as enum ('reader', 'editor', 'admin');

-- Perfiles (SIN foto: el avatar se representa con iniciales de display_name)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Documentos (cada fila = una pestaña con nombre propio; sin límite de cantidad)
create table public.documents (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade,
  title          text not null default 'Untitled',
  slug           text unique not null,
  content        text not null default '',
  visibility     document_visibility not null default 'private',
  last_edited_by uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- versión incremental para concurrencia optimista (LWW controlado)
  revision       int not null default 1
);

-- Colaboradores
create table public.document_collaborators (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        collaborator_role not null default 'reader',
  invited_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);

-- Invitaciones pendientes por correo (se materializan al registrarse)
create table public.document_invitations (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  email       text not null,
  role        collaborator_role not null default 'reader',
  token       text unique not null default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid not null references auth.users(id) on delete cascade,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (document_id, email)
);

-- Historial de versiones (snapshots)
create table public.document_versions (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  revision    int not null,
  content     text not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (document_id, revision)
);

-- Comentarios (opcional: hilos y anclas)
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  parent_id   uuid references public.comments(id) on delete cascade,
  body        text not null,
  anchor      jsonb,            -- {from,to,quote} para comentarios anclados
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Enlaces de compartición con token, rol y caducidad
create table public.share_links (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  token       text unique not null default encode(gen_random_bytes(24), 'hex'),
  role        collaborator_role not null default 'reader',
  expires_at  timestamptz,
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
```

### 6.3 Índices (siguiendo `query-` del skill de Postgres)

```sql
create index documents_owner_idx        on public.documents (owner_id, updated_at desc);
create index documents_slug_idx         on public.documents (slug);
create index collab_user_idx            on public.document_collaborators (user_id, document_id);
create index versions_doc_idx           on public.document_versions (document_id, revision desc);
create index comments_doc_idx           on public.comments (document_id, created_at desc);
create index invitations_email_idx      on public.document_invitations (email) where accepted_at is null;
create index comments_unresolved_idx    on public.comments (document_id) where resolved = false;
-- Búsqueda de texto (título/contenido) — se activa en Fase 5
alter table public.documents
  add column search tsvector
  generated always as (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(content,''))) stored;
create index documents_search_idx on public.documents using gin (search);
```

### 6.4 RLS — reglas base (todas las tablas expuestas)

```sql
alter table public.profiles               enable row level security;
alter table public.documents              enable row level security;
alter table public.document_collaborators enable row level security;
alter table public.document_versions      enable row level security;
alter table public.comments               enable row level security;
alter table public.share_links            enable row level security;
alter table public.document_invitations   enable row level security;
```

**Patrones obligatorios** (derivados del checklist del skill `supabase`):

- Usar `(select auth.uid())` en lugar de `auth.uid()` para permitir el *initplan* y mejorar rendimiento.
- `TO authenticated` **junto con** predicado de propiedad (evita BOLA/IDOR); **nunca** `auth.role()`.
- `UPDATE` con **`USING` + `WITH CHECK`** (evita reasignar `owner_id`).
- **Nunca** usar `user_metadata`/`raw_user_meta_data` para autorización; usar `app_metadata`.
- Vistas con `security_invoker = true` (Postgres 15+) → Supabase ya usa PG ≥ 15.
- Evitar `SECURITY DEFINER`; si es imprescindible, fuera del esquema expuesto + chequeo de `auth.uid()`.

Ejemplo de política de documentos (lectura para dueño o colaborador):

```sql
create policy "documents_select_owner_or_collab"
  on public.documents for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.document_collaborators c
      where c.document_id = documents.id and c.user_id = (select auth.uid())
    )
    or visibility = 'public'
  );

create policy "documents_insert_own"
  on public.documents for insert
  to authenticated
  with check ( owner_id = (select auth.uid()) );

create policy "documents_update_owner_or_editor"
  on public.documents for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.document_collaborators c
               where c.document_id = documents.id
                 and c.user_id = (select auth.uid())
                 and c.role in ('editor','admin'))
  )
  with check (
    owner_id = (select auth.uid())
    or exists (select 1 from public.document_collaborators c
               where c.document_id = documents.id
                 and c.user_id = (select auth.uid())
                 and c.role in ('editor','admin'))
  );
```

> Las políticas completas de las 6 tablas se documentarán como parte de la Fase 3 (diseño por tabla, con pruebas de RLS en `tests/db/`).

### 6.5 Triggers y funciones

| Trigger | Propósito |
|---|---|
| `handle_new_user` (AFTER INSERT en `auth.users`) | Crea fila en `profiles` con `username` derivado. |
| `set_updated_at` (BEFORE UPDATE) | Actualiza `updated_at` en documentos/comentarios. |
| `bump_revision` (BEFORE UPDATE en `documents`) | Incrementa `revision` para concurrencia optimista. |
| `snapshot_version` (AFTER UPDATE en `documents`) | Inserta en `document_versions` cuando cambia `content` (o cada N revisión para no inflar). |

### 6.6 Storage

- Bucket `doc-images` (privado por defecto; público solo para imágenes de documentos `public`). **No se almacenan fotos de perfil**: los avatares de usuario/presencia se muestran como iniciales.
- Ruta por convención: `{user_id}/{document_id}/{filename}`.
- Políticas: `INSERT`, `SELECT` y `UPDATE` para dueño/colaborador-editor. **Upsert requiere INSERT + SELECT + UPDATE** (si falta uno, el reemplazo falla en silencio — según checklist del skill).
- Límite de tamaño y tipos MIME permitidos en el bucket.

---

## Bloque 7 — Autenticación y sesiones

- **Librería:** `@supabase/ssr` + `@supabase/supabase-js` (versiones fijadas y lockfile commiteado).
- **Métodos:** email con OTP/magic link (por defecto) y OAuth (Google, GitHub). Opcional: contraseña.
- **Sesión SSR:** cookies gestionadas en `src/middleware.ts` con `createServerClient`; el middleware refresca tokens y protege `/dashboard`, `/editor/*`, `/settings`.
- **Cliente:** `createBrowserClient` solo con clave publicable (nunca `service_role`).
- **Autorización:** decisiones basadas en `app_metadata` y RLS, nunca en `user_metadata`.
- **Perfil:** trigger `handle_new_user` + tabla `profiles` (`username`, `display_name`). **Sin foto de perfil** (avatares = iniciales).
- **Invitados:** modo local sin sesión (paridad con hoy); botón "Iniciar sesión para sincronizar" + importación de borradores locales.
- **Cierre de sesión:** `signOut` explícito; para operaciones sensibles, validar `session_id` contra `auth.sessions`.

---

## Bloque 8 — Colaboración en tiempo real y resolución de conflictos

### 8.1 Nivel 1 (Fase 4) — Realtime práctico

- **Presencia:** canal `doc:{id}` con `presence` de Supabase (quién está conectado, nombre, color, última actividad) → `PresenceBar` con **iniciales** (sin fotos).
- **Edición en vivo:** `postgres_changes` sobre `documents` (UPDATE) para reflejar cambios remotos + `broadcast` para mensajes efímeros (cursores, selección).
- **Autosave:** debounce (reusar la lógica adaptativa actual) → Action `updateDocument` con `revision`; si `revision` cambió, se muestra aviso de conflicto y se ofrece recargar/mezclar.
- **Cursores remotos:** `broadcast` throttleado (≤ 20 Hz) con `{userId, from, to}`; no se persiste.
- **Reconexión:** backoff exponencial; estado de conexión en `stores/collab.ts` y en el badge "Sincronizado / Sin conexión" (el actual `#pv-status`).
- **Offline:** los cambios se encolan en IndexedDB y se reenvían al reconectar.

### 8.2 Nivel 2 (Fase opcional, recomendado a futuro) — CRDT con Yjs

- Sustituir el editor por **CodeMirror 6 + y-codemirror.next** y sincronizar con **Yjs**.
- Transporte: `y-websocket` (servidor propio/Nitro) **o** `y-supabase`/transporte sobre Realtime Broadcast.
- Persistencia offline: `y-indexeddb`.
- Snapshots periódicos a `document_versions` (cada N segundos de inactividad o cada X updates).
- **Beneficio:** merge sin conflictos, cursores reales, mejor undo/redo (soluciona la deuda de `document.execCommand`).

### 8.3 Recomendación de secuencia

Lanzar Nivel 1 para tener colaboración real rápido; medir uso de conflicto; migrar a Nivel 2 si los casos concurrentes lo justifican. Este enfoque evita el riesgo de introducir CRDT en la fase 1 del proyecto.

### 8.4 Compartir: enlace público e invitación por correo

Requisito explícito del cliente. Dos mecanismos, ambos gestionados desde `ShareModal`.

**A) Invitación por correo con rol (acceso restringido)**
- El dueño escribe uno o varios correos y elige rol **editor** o **lector** para cada uno.
- Si el correo ya tiene cuenta → se crea la fila en `document_collaborators` y se notifica.
- Si no la tiene → se registra una **invitación pendiente** (`document_invitations`) y se envía un correo (Supabase Auth invite o Resend). Al registrarse, la invitación se materializa automáticamente asociando el `email`.
- Roles: **`reader`** (solo lectura; opcionalmente puede comentar) y **`editor`** (puede editar contenido). `admin` queda reservado para co-dueños.

**B) Enlace público con token**
- Genera una URL `…/d/{slug}?k={token}` (o `/share/{token}`) con rol fijo (`reader` por defecto, `editor` opcional).
- Parámetros: **caducidad** (`expires_at`), **revocación** inmediata, y elección entre **público descubrible** (`visibility = 'public'`, indexable) o **no listado** (`unlisted`, solo con token).
- Por seguridad, **editar siempre requiere estar autenticado**: un token con rol `editor` solo autoriza a usuarios con sesión iniciada que lo abran.
- Si quien abre el enlace no tiene sesión, se le invita a registrarse/iniciar sesión para conservar el acceso y la autoría de sus cambios.

**Reglas de autorización**
- Lectura de documento privado: dueño o colaborador autenticado.
- Escritura: dueño, colaborador `editor`/`admin`, o token `role='editor'` **+ usuario autenticado**.
- Cambio de rol y revocación: solo dueño o `admin`.
- Toda decisión se aplica en **RLS** (no solo en la UI).

---

## Bloque 9 — Variables de entorno

> En Astro **solo** las variables con prefijo `PUBLIC_` llegan al navegador. Todo lo demás es server-only. Nunca exponer `service_role`/secret key.

### 9.1 `.env.example` (plantilla)

```dotenv
# ── Supabase (cliente + servidor) ─────────────────────────────
PUBLIC_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICABLE
# (compat: la antigua "anon key" también sirve como publicable)

# ── Solo servidor — NUNCA exponer al navegador ────────────────
SUPABASE_SECRET_KEY=TU_SECRET_KEY_SERVIDOR
# (compat legado: SUPABASE_SERVICE_ROLE_KEY)

# ── Site ──────────────────────────────────────────────────────
PUBLIC_SITE_URL=http://localhost:4321
# En producción: https://tu-dominio.com

# ── Solo desarrollo local / CLI / CI (no subir al repo) ───────
SUPABASE_PROJECT_REF=tu_project_ref
SUPABASE_ACCESS_TOKEN=sbp_...        # token personal con scope mínimo (preferir scoped PAT)
SUPABASE_DB_PASSWORD=...             # solo para supabase db push / pull

# ── Opcional (según funciones de fases posteriores) ───────────
RESEND_API_KEY=                       # SMTP/emails transaccionales (Fase 6)
SENTRY_DSN=                           # observabilidad (Fase 6)
```

### 9.2 Reglas de manejo

| Regla | Detalle |
|---|---|
| `.env` en `.gitignore` | Ya existe `.gitignore`; verificar que incluya `.env*` salvo `.env.example`. |
| Fijar versiones | `supabase-js` y `@supabase/ssr` con versión exacta + lockfile commiteado (skill `supabase`). |
| Sin secretos en el cliente | El cliente browser solo usa `PUBLIC_SUPABASE_URL` + clave publicable. |
| Producción | Configurar las variables en **Cloudflare** (Settings → Environment variables) y no en el repo. |
| CI | `SUPABASE_ACCESS_TOKEN` como **scoped PAT**, no el token clásico de cuenta completa. |
| Rotación | Plan de rotación de la secret key; una sola vez por entorno. |

---

## Bloque 10 — Configuración manual en el Dashboard de Supabase

> Estos pasos los ejecutas **tú** (requieren tu cuenta). Añade una captura o check al completarlos.

| # | Tarea | Dónde | Notas |
|---|---|---|---|
| 1 | Crear proyecto | Dashboard → New project | Región **cercana** al público (p. ej. `sa-east-1` São Paulo si el público es Perú). Guardar contraseña de DB. |
| 2 | Obtener API keys | Settings → API | Copiar URL, **publishable key**; guardar la **secret key** solo en servidor. |
| 3 | Definir URL del sitio | Authentication → URL Configuration | `Site URL` = dominio productivo; `Redirect URLs` = `http://localhost:4321/auth/callback`, `https://tu-dominio/auth/callback`. |
| 4 | Activar proveedores | Authentication → Providers | Email (OTP o password) y OAuth (Google/GitHub con Client ID/Secret). |
| 5 | SMTP propio | Authentication → SMTP | Recomendado en producción (entrega fiable de magic links). |
| 6 | Aplicar migraciones | CLI: `supabase link` + `supabase db push` | O pegar el SQL en el SQL Editor si no usas CLI. |
| 7 | Exponer tablas a la Data API | Integrations → Data API settings | Si recién creadas no aparecen: `GRANT` explícito a `authenticated` **con RLS activado** (ver skill `supabase`). |
| 8 | Activar Realtime | Database → Replication | Añadir `documents`, `document_collaborators`, `comments` a la publicación `supabase_realtime`. |
| 9 | Crear bucket de Storage | Storage → New bucket | `doc-images` (privado) + políticas (INSERT/SELECT/UPDATE). |
| 10 | Revisar advisors | CLI `supabase db advisors` o Dashboard → Advisors | Corregir warnings de RLS/permisos antes de producción. |
| 11 | Backups | Settings → Database → Backups | Definir política (PITR según plan) y probar restauración. |
| 12 | Presupuesto/alarmas | Settings → Billing | Alerta de uso para evitar sorpresas con Realtime/egress. |
| 13 | Conectar GitHub a Cloudflare | Cloudflare Dashboard → Workers & Pages → Create → Pages → **Connect to Git** | Cada push a `main` despliega a producción. |
| 14 | Configurar build en Cloudflare | Settings → Builds | Build `pnpm build`, output `dist/`, `NODE_VERSION=22`; runtime: adapter Cloudflare. |
| 15 | Cargar variables de entorno en Cloudflare | Settings → Environment variables | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `PUBLIC_SITE_URL` (prod). |
| 16 | Dominio + SSL | Cloudflare → Custom domains | Añadir dominio y verificar HTTPS + cabeceras de seguridad. |
| 17 | (Opcional) `supabase gen types` | CLI | Regenerar `database.types.ts` tras cada migración. |
| 18 | Fotos de perfil | — | **No aplica:** no se almacenan avatares. |

### 10.1 Flujo local con CLI

```bash
pnpm dlx supabase init            # crea supabase/config.toml
pnpm dlx supabase start           # entorno local (Docker)
supabase migration new init_schema
# editar supabase/schemas/ y generar migración (esquema declarativo preferido)
supabase db pull init_schema --local --yes
supabase migration list --local
supabase db advisors              # revisar antes de commitear
```

---

## Bloque 11 — Dependencias a instalar y tooling

### 11.1 Runtime

| Paquete | Uso |
|---|---|
| `@astrojs/cloudflare` | Adapter SSR para Cloudflare Workers/Pages (habilita cookies, Actions, endpoints). |
| `@supabase/supabase-js` | Cliente Supabase. |
| `@supabase/ssr` | Sesión SSR con cookies. |
| `marked` | Parseo de Markdown (misma lib, ahora bundlada). |
| `dompurify` | Sanitización HTML. |
| `highlight.js` (**import selectivo**) | Resaltado de código, solo lenguajes usados. |
| `mermaid` (**dynamic import**) | Diagramas, carga diferida. |
| `nanostores` (+ `@nanostores/persistent`) | Estado de editor/sesión/colaboración. |
| `zod` | Validación en Actions/endpoints. |
| `idb-keyval` (o `dexie`) | Persistencia local robusta. |
| `lucide-static` o SVG inline | Iconos sin CDN de Iconify. |
| `tailwindcss` + `@tailwindcss/vite` | Tailwind v4 en build. |
| `@astrojs/sitemap` (opcional) | SEO de documentos públicos. |

### 11.2 Desarrollo / calidad

| Paquete | Uso |
|---|---|
| `typescript` (strict) | Tipado. |
| `vitest` | Tests unitarios de `lib/*`. |
| `@playwright/test` | E2E de flujos del editor. |
| `eslint` + `prettier` (+ `eslint-plugin-astro`) | Lint/formato. |
| `supabase` (CLI, vía `pnpm dlx`) | Migraciones, tipos, advisors. |
| `@lhci/cli` | Presupuesto de rendimiento en CI. |

> Antes de implementar, **verificar versiones y APIs vigentes** (`pnpm info <pkg> version`, docs oficiales) — el skill `supabase` recuerda que Supabase cambia con frecuencia.

### 11.3 Tooling

- **TS strict** + `paths` (`@/*` → `src/*`) y tipos generados de la DB.
- **Scripts** en `package.json`: `dev`, `build`, `preview`, `check` (`astro check`), `test`, `test:e2e`, `lint`, `format`, `db:types`.
- **CI** (`.github/workflows/ci.yml`): typecheck → lint → unit → e2e → build → Lighthouse. Node 22.
- **Pre-commit** (opcional): husky + lint-staged.

---

## Bloque 12 — Fases de implementación (roadmap por hitos)

> Cada fase termina con un **artefacto desplegable** y criterios de aceptación propios.

### Fase 0 — Fundaciones (½–1 día) ✅ *completada en este repo*
- Adapter **Cloudflare**, TypeScript strict, Tailwind v4, lint/format, CI esqueleto.
- Se fija la **política inglés-only** (Bloque 1.4).
- `astro check` y `astro build` en verde.
- **Entregable:** repo listo para trabajar, sin cambios funcionales visibles.

### Fase 1 — Extracción a componentes con paridad (2–4 días) ✅ *completada en este repo*
- Todo el Bloque 5, sigue en **`localStorage`** (IndexedDB se aplaza a la Fase 3).
- Suite de paridad que cubre el inventario del Bloque 2.1 (**62 tests, 7 archivos**).
- **Entregable:** mismo visor, ya componentizado, sin CDNs.

**Implementación real (rutas):**

| Módulo | Contenido |
|---|---|
| `src/lib/markdown/*` | `render` (marked + DOMPurify + `patch` incremental), `highlight` (solo 20 lenguajes registrados), `mermaid` (import diferido con caché de SVG), `slug`, `toc`, `highlightTheme` |
| `src/lib/editor/*` | `commands` (puras: devuelven un `EditOp` que el adaptador aplica con `execCommand` para conservar el undo/redo nativo), `findReplace`, `text`, `prefs`, `exportDocument` |
| `src/lib/documents/*` | `types`, `store` (títulos `Untitled`, `Untitled 2`, …), `migrate` (importación de borradores `mdviewer:*`) |
| `src/lib/app/*` | `editorApp` y `previewApp` (orquestadores) |
| `src/components/ui`, `src/components/app` | `Icon`, `AppHeader`, `DocumentTabs`, `ExportMenu`, `ViewMenu`, `ClearMenu`, `EditorPane`, `FindReplaceBar`, `FormatToolbar`, `StatusBar`, `TocPanel` |
| `src/pages` | `/` (editor) y `/preview?doc=<id>` (vista con índice, sincronizada entre pestañas por el evento `storage`) |

- Iconos con **`@lucide/astro`** (compilados a SVG en build, sin JS de cliente) y **`@tailwindcss/typography`** para el `prose`.

**Bugs del original corregidos durante el port (documentados en el código):**

1. **Slug de encabezados repetidos:** el original asignaba `-1` a la 3.ª aparición y siguientes; ahora numera `-1`, `-2`, … de forma secuencial (`render.ts`).
2. **Desmarcar cita:** al quitar `>`, el grupo de captura incluía el propio marcador y quedaba un `>` suelto (`>q`); ahora se elimina el prefijo completo (`commands.ts`).
3. **Renombrado de pestañas:** reconstruir el DOM en cada clic impedía el doble clic para renombrar; ahora los nodos de pestaña se reutilizan (`editorApp.ts`).

**Desviaciones conscientes:** `EditorPane` agrupa los antiguos `CodePane`/`PreviewPane`/`Splitter` en un solo componente; `IndexedDB` y `nanostores` se posponen a la Fase 3.

### Fase 2 — Infra Supabase (1–2 días)
- Proyecto Supabase, `.env`, `@supabase/ssr`, middleware, login/logout, perfil, tipos generados.
- **Entregable:** login funcional y sesión persistente.

### Fase 3 — Documentos y persistencia real (3–5 días)
- Esquema del Bloque 6 + RLS + pruebas de RLS.
- Dashboard, crear/renombrar/eliminar, abrir en editor, autosave con `revision`, historial y restauración.
- **Editores ilimitados con nombre propio** (multi-pestaña) persistidos en `documents.title`.
- Migración de borradores locales al iniciar sesión.
- **Entregable:** documentos en Postgres con dueño, seguros por RLS.

### Fase 4 — Colaboración Nivel 1 (3–5 días)
- Realtime: presencia, cambios en vivo, cursores, estado de conexión, reconexión, offline queue.
- Compartir: invitación por correo con rol **editor/lector** + enlace público con token (ver 8.4).
- **Entregable:** dos usuarios editan el mismo documento en vivo.

### Fase 5 — Compartir público, comentarios y export server-side (3–4 días)
- Página pública `d/[slug]` SSR + SEO + cache headers.
- Comentarios (hilos, resolver, `@menciones`).
- Export server-side (HTML/PDF; DOCX opcional) + imágenes en Storage.
- **Entregable:** documento público indexable y export reproducible.

### Fase 6 — Hardening, performance y observabilidad (2–3 días)
- CSP/headers, rate limiting, auditoría con skill `security-audit`, adsorbers de Supabase, Sentry/analytics, Lighthouse CI con presupuesto.
- **Entregable:** producción endurecida y medida.

### Fase 7 — Mejoras avanzadas (backlog, ver Bloque 16)
- CRDT (Yjs + CodeMirror 6), búsqueda full-text, plantillas, IA, PWA offline.

---

## Bloque 13 — Performance y optimización

| # | Acción | Beneficio |
|---|---|---|
| 1 | Tailwind compilado (sin CDN) | Elimina el `JIT` en runtime y el riesgo de parpadeo. |
| 2 | Bundle de libs locales + versiones fijas | Sin latencia de CDN ni riesgo de caída; cacheado con hash. |
| 3 | **Mermaid con `dynamic import` + IntersectionObserver** | Mermaid es pesado; solo se carga si hay diagramas visibles. |
| 4 | `highlight.js` con **solo los lenguajes usados** (registro selectivo) | Reduce bundle drásticamente. |
| 5 | Mantener `patch()` (diff de DOM) | Sin parpadeo, sin perder scroll/SVG. |
| 6 | `requestAnimationFrame` para scroll-spy y posiciones | Evita thrashing de layout. |
| 7 | Web Worker para render de Markdown de docs largos | Mantiene la UI a 60 fps. |
| 8 | IndexedDB para drafts | Sin límite práctico de 5 MB de `localStorage`. |
| 9 | SSR + cache de documentos públicos | SEO y TTFB bajo. |
| 10 | Fuentes self-hosted + `font-display: swap` + preload | Sin FOUT ni conexión a Google Fonts. |
| 11 | Índices Postgres (Bloque 6.3) + `(select auth.uid())` en RLS | Consultas y políticas eficientes. |
| 12 | Conexión Realtime única por documento + throttle de cursores | Evita saturar el canal. |
| 13 | Presupuesto en CI (Lighthouse + bundle size) | Evita regresiones. |
| 14 | Compresión de imágenes en Storage + `srcset` | Menos bytes en documentos con imágenes. |

---

## Bloque 14 — Seguridad (alineado a skills de `.agents`)

### 14.1 Checklist de Supabase (del skill `supabase`)

- [ ] RLS activado en **todas** las tablas de esquemas expuestos.
- [ ] Sin `auth.role()`; usar `TO authenticated` + predicado de propiedad.
- [ ] `UPDATE` con `USING` **y** `WITH CHECK`.
- [ ] Sin autorización basada en `user_metadata`/`raw_user_meta_data` → usar `app_metadata`.
- [ ] Vistas con `security_invoker = true`.
- [ ] Evitar `SECURITY DEFINER`; si se usa, fuera de `public` + chequeo `auth.uid()`.
- [ ] Nunca `service_role`/secret key en el cliente.
- [ ] Upsert de Storage con INSERT + SELECT + UPDATE.
- [ ] PAT con scope mínimo para CLI/CI.
- [ ] Ejecutar `supabase db advisors` antes de cada despliegue.
- [ ] Al borrar usuarios: cerrar/revocar sesiones (los JWT existentes no se invalidan solos).

### 14.2 Checklist de seguridad de aplicación (skill `security-audit`)

- [ ] **XSS:** mantener sanitización con allowlist estricta (DOMPurify) para todo HTML generado de Markdown; revisar `CLIENT-SIDE.md` del skill.
- [ ] **CSP** estricta (sin `unsafe-inline` si es posible), `X-Content-Type-Options`, `Referrer-Policy`, HSTS.
- [ ] **CSRF:** cookies `SameSite=Lax/Strict` + verificación de origen en Actions.
- [ ] **Validación de entrada** con Zod en toda la frontera.
- [ ] **Rate limiting** en login/OTP y endpoints costosos (export).
- [ ] **Supply chain:** versiones fijadas, lockfile commiteado, revisar `SUPPLY-CHAIN-AND-RELEASE.md`.
- [ ] **Enlaces compartidos:** token de alta entropía + caducidad + revocación.
- [ ] **Auditoría de acceso** (quién editó qué) usando `document_versions` + `last_edited_by`.
- [ ] **Secretos:** nunca en logs ni en errores del cliente.
- [ ] **Permisos de Storage** verificados con pruebas (no confiar en la UI).

---

## Bloque 15 — Testing y calidad

| Nivel | Herramienta | Qué cubre |
|---|---|---|
| Unit | Vitest | `slug`, `patch`, `commands`, `findReplace`, `shortcuts`, `renderer`, `sanitize`, `permissions`. |
| Componente | Vitest + DOM | Render de nuevos módulos sin regresión visual lógica. |
| E2E | Playwright | Escribir → guardar → recargar → exportar → abrir preview con índice; login; compartir. |
| DB/RLS | SQL/pgTAP (o `supabase test`) | Un usuario no puede leer/editar documentos ajenos; colaborador sin rol editor no puede escribir. |
| Paridad | Checklist del Bloque 2.1 | Cada funcionalidad actual probada antes y después de cada fase. |
| Performance | Lighthouse CI | LCP, size de bundle y regresiones. |

---

## Bloque 16 — Mejoras funcionales futuras (backlog)

**Corto plazo (alto valor, bajo riesgo)**
- Dashboard con carpetas, etiquetas, favoritos y búsqueda full-text (`tsvector` ya previsto).
- Galería de plantillas (README, acta, paper, changelog) y documentos de ejemplo.
- Editor: **CodeMirror 6** (undo/redo moderno, sin `execCommand`), modo Vim, minimapa, autocompletado de Markdown.
- Export **DOCX** y PDF server-side con motor real (mejor que `print()`).
- Importar desde URL, portapapeles o repositorio GitHub.

**Medio plazo (colaboración y publicación avanzadas)**
- CRDT con **Yjs** (cursores estilo Figma, offline real, sin conflictos).
- Comentarios con anclas al texto y menciones con notificaciones (Realtime/email).
- Historial con **diff visual** entre versiones y restauración parcial.
- Publicación tipo blog (`d/[slug]`) con RSS, sitemap y dominio personalizado.
- Enlaces compartidos con contraseña, expiración y límite de usos.
- PWA offline completa (`y-indexeddb`, service worker, instalación).

**Largo plazo (producto/plataforma)**
- Workspaces/organizaciones, roles de equipo y facturación.
- **API pública** con PAT + webhooks (integrar con Notion/Slack/GitHub).
- **IA**: resumir, autocompletar, traducir, generar diagramas Mermaid desde texto, búsqueda semántica con **pgvector**.
- Auditoría avanzada (activity feed), 2FA y SSO SAML para empresas.
- Integraciones de exportación (Notion, Google Docs, Confluence).

---

## Bloque 17 — Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Regresión al quitar los CDNs | Media | Alto | Fase 1 con paridad + suite E2E de paridad. |
| Pérdida de drafts locales al migrar | Baja | Alto | Importación one-time explícita + mantener local hasta confirmar. |
| Conflictos de edición simultánea (LWW pierde datos) | Media | Alto | Aviso de conflicto por `revision`; snapshots; ruta a CRDT (Yjs). |
| Coste/latencia de Realtime con muchos usuarios | Baja | Medio | Throttle de cursores, canales por documento, medir y migrar si aplica. |
| Mermaid/Lighthouse pesado | Media | Medio | Lazy load + presupuesto de bundle en CI. |
| RLS mal escrito (fuga entre usuarios) | Media | Crítico | Patrones del checklist + tests de RLS obligatorios en CI. |
| Cambios de API de Supabase | Media | Medio | Versiones fijadas + consultar changelog/docs antes de implementar (skill `supabase`). |
| Complejidad del adapter SSR / hosting | Baja | Medio | Empezar con `@astrojs/node`; documentar alternativa Vercel/Netlify. |
| `execCommand` deprecado deja de funcionar | Baja | Medio | Plan de migración a CodeMirror 6 (Fase 7 / backlog). |

---

## Bloque 18 — Criterios de aceptación / Definition of Done

**Por fase** (además de lo indicado en el Bloque 12):

- [ ] `astro check`, `lint` y `build` en verde.
- [ ] Tests unit + E2E del incremento pasando en CI.
- [ ] Pruebas de RLS para cualquier tabla/permiso nuevo.
- [ ] Sin secretos en el cliente ni en el repo.
- [ ] Presupuesto de rendimiento respetado (Bloque 13).
- [ ] Documentación actualizada (`README` + este plan marcado por fase).
- [ ] Migración de Supabase revisada y `db advisors` sin warnings críticos.

**Criterios globales de "producción" (fin del roadmap):**

- [ ] Un usuario crea una cuenta, escribe, cierra el navegador y recupera su documento.
- [ ] Dos usuarios editan el mismo documento y ven cambios/presencia en vivo.
- [ ] Un documento puede compartirse por enlace con rol y caducidad y quedar público y indexable (si aplica).
- [ ] El historial permite restaurar una versión anterior.
- [ ] El editor publica HTML y PDF reproducibles.
- [ ] Todas las funcionalidades del inventario original (Bloque 2.1) siguen operativas.
- [ ] Ninguna tabla expuesta carece de RLS; ningún secreto llega al navegador.
- [ ] **Toda la UI y la base de datos están en inglés** (sin textos en español).
- [ ] Se pueden **crear N editores/pestañas**, cada uno con **nombre propio** editable.
- [ ] Se puede **compartir** por **enlace público** y por **invitación a un correo** con rol **editor** o **lector**.
- [ ] **No** existe almacenamiento de fotos de perfil.
- [ ] El despliegue en **Cloudflare** (conectado a GitHub) sirve la app con las variables de entorno correctas.

---

## Anexo A — Mapeo skills `.agents` → bloques del plan

| Skill | Ruta | Bloques que la aplican |
|---|---|---|
| **astro** | `.agents/skills/astro/SKILL.md` | 3 (SSR + adapter), 4 (estructura), 5 (componentes), 11 (tooling/`astro check`), 12 (Fase 0). |
| **supabase** | `.agents/skills/supabase/SKILL.md` | 6 (RLS/checklist), 7 (Auth/`@supabase/ssr`), 8 (Realtime), 9 (env/secretos), 10 (CLI/dashboard/advisors), 14 (seguridad). |
| **supabase-postgres-best-practices** | `.agents/skills/supabase-postgres-best-practices/SKILL.md` | 6.3 (índices `query-`), 6.2 (tipos y esquema `schema-`), 6.4 (RLS `security-`), 6.5 (triggers/concurrencia `lock-`), 13 (perf). |
| **security-audit** | `.agents/skills/security-audit/SKILL.md` + `CLIENT-SIDE.md`, `SUPPLY-CHAIN-AND-RELEASE.md`, `WEB-PROTOCOL-AND-AUTH.md`, `DATA-ISOLATION-AND-LIFECYCLE.md` | 14.2 (XSS/CSP/CSRF), 6.6 (Storage), 9 (secretos), 15 (pruebas), 12 (Fase 6). |

---

## Anexo B — Checklist de arranque en 1 página

**Tú (manual, Supabase):** crear proyecto → copiar URL + publishable + secret → configurar Site/Redirect URLs → activar email + OAuth → SMTP → migraciones (`supabase link`/`db push`) → Data API grants → activar Realtime → bucket `doc-images` → `db advisors` → backups/alarmas → variables en el host.

**Yo (código, por fases):** Fase 0 fundaciones → Fase 1 componentización con paridad → Fase 2 auth SSR → Fase 3 documentos + RLS → Fase 4 colaboración Nivel 1 → Fase 5 público/comentarios/export → Fase 6 hardening → Fase 7 backlog.

**Nunca:** `service_role` en el cliente · `auth.role()` en políticas · `user_metadata` para autorización · tablas sin RLS · versiones sin fijar · secretos en el repo.

---

*Fin del plan. Documento vivo: se actualiza al cerrar cada fase.*
