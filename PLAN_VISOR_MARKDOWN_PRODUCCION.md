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
| Sin usuarios | Auth **email + contraseña con verificación por correo** y OAuth **GitHub/Google**, con sesión SSR por cookies |
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
- **Ayudantes de autorización con `boolean` estricto**: `select coalesce(<expresión>, false)`, nunca NULL. En una política un NULL equivale a «no permitido», pero en un guard de PL/pgSQL (`if not private.can_manage_document(...)`) **se salta el `raise`** y la función `SECURITY DEFINER` —que no tiene RLS detrás— queda abierta. El guard se escribe siempre `if private.can_...(...) is not true then`.

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

> Las políticas completas de las 6 tablas viven ahora en el código, no en este documento: `supabase/migrations/20261006130000_documents.sql` (una sección por tabla) y la verificación ejecutable en `tests/db/rls.mjs` (`pnpm db:rls`).
>
> **Corrección obligatoria al ejemplo de arriba.** El `exists (select 1 from public.document_collaborators …)` dentro de la política de `documents` es **recursivo**: las políticas de `document_collaborators` vuelven a consultar `documents`, y Postgres aborta con *infinite recursion detected in policy*. La solución aplicada es la que permite el propio checklist del Bloque 6: funciones `SECURITY DEFINER` **fuera** del esquema expuesto (`private.can_read_document`, `private.can_edit_document`, `private.can_manage_document`, `private.document_role`), con el `uid` como **parámetro** —nunca leído de la sesión—, `search_path = ''`, `EXECUTE` revocado de `public` y concedido solo a `authenticated`. Las políticas quedan de una línea y el plan de consulta deja de depender de RLS anidado.
>
> **Segunda trampa, medida en el proyecto real.** Que los *helpers* no recursen no basta: cualquier subconsulta sobre `documents` **dentro de una política de `documents`** vuelve a entrar en la política y Postgres la rechaza con el mismo `42P17`. Ocurrió con el `WITH CHECK` que fija `owner_id` (`owner_id = (select owner_id from public.documents d where d.id = documents.id)`), y como un error de política aborta la sentencia entera, **todo** `UPDATE` falló: autosave, renombrado, downgrade de rol y la publicación de un documento. Se corrigió leyendo el valor almacenado a través de otro helper `SECURITY DEFINER` (`private.document_owner(uuid)`), no del esquema expuesto.
>
> **Lección para el Bloque 15:** los 7 fallos no aparecieron leyendo el SQL, sino ejecutando `pnpm db:rls`. Una política solo está probada cuando una identidad real intenta lo que la política debería impedir.
>
> **Este DDL es documentación de diseño, no un script para pegar.** Aplicarlo a mano crea tablas con RLS activo y **sin políticas**, que es un estado cerrado en falso: el dueño no puede leer ni su propia fila y la app parece rota por motivos invisibles en el dashboard. La única fuente de verdad ejecutable son los archivos de `supabase/migrations/`, que además reconcilian un esquema creado a mano (`add column if not exists`, constraints guardadas, corrección del idioma del índice de búsqueda).

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
- **Métodos (decisión del cliente, 2026-10-06):** **email + contraseña** con **verificación por correo** obligatoria, más OAuth **GitHub** y **Google**. El magic link queda descartado.

| Pantalla | Ruta | Ruta servidor |
|---|---|---|
| Iniciar sesión | `/login` | `POST /auth/signin` |
| Crear cuenta | `/signup` | `POST /auth/signup` → correo de confirmación |
| Reenviar confirmación | `/login?error=email_not_confirmed` | `POST /auth/resend` |
| Recuperar contraseña | `/forgot-password` | `POST /auth/password/forgot` |
| Elegir contraseña nueva (protegida) | `/reset-password` | `POST /auth/password/update` |
| OAuth / retorno | `/auth/oauth/:provider`, `/auth/callback` | `GET` (PKCE `?code=` y `?token_hash=&type=`) |

- **Política de contraseñas:** mínimo 8 caracteres con letra y número (`src/lib/auth/password.ts`), espejo de *Authentication → Settings → Minimum password length*; 72 caracteres máximo porque bcrypt trunca ahí.
- **Anti-enumeración:** ni `/auth/resend` ni `/auth/password/forgot` revelan si el correo existe, y un fallo de acceso siempre responde `invalid_credentials` (salvo dirección sin confirmar, que ofrece reenviar el enlace).
- **Mensajes de validación nativos:** los del navegador (`pattern`, `minlength`) salen en el idioma del navegador del usuario; los textos propios del producto están en inglés (Bloque 1.4).
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

**Lo que la Fase 4 implementó de verdad** (ver el detalle en el Bloque 12, Fase 4): presencia, `postgres_changes` sobre `documents`, `broadcast` de cursores con throttle, badge *Synced / Offline*, backoff exponencial y reintento al volver la red. **Aplazado:** la cola en IndexedDB (hoy el texto sin guardar vive en memoria y se reintenta; un cierre de pestaña sin red lo pierde — decisión consciente, anotada aquí) y los canales privados con políticas sobre `realtime.messages` (hoy el topic es `doc:{uuid}`: el uuid es la capacidad y solo lo conocen los miembros, pero el endurecimiento propio es el de la Fase 6).

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

**Implementado en la Fase 4:** invitación por correo con rol (una función `public.invite_collaborator` resuelve si la dirección tiene cuenta o no), cambio de rol, revocación de invitación y de acceso, enlaces con caducidad y revocación, visibilidad private/unlisted/public, la página `/documents/:id/share`, y `/s/:token` resolviendo el token en la base de datos. Un enlace con rol `editor` sigue exigiendo sesión: al abrirlo, `public.claim_share_link` crea la fila de colaborador con ese rol (sin degradar nunca un rol mayor). **Pendiente (Fase 5):** `d/[slug]` público e indexable con SEO y cabeceras de caché.

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
| 1 | Crear proyecto | Dashboard → New project | Región **cercana** al público (p. ej. `sa-east-1` São Paulo si el público es Perú). Guardar contraseña de DB. ✅|
| 2 | Obtener API keys | Settings → API | Copiar URL, **publishable key**; guardar la **secret key** solo en servidor. ✅|
| 3 | Definir URL del sitio | Authentication → URL Configuration | `Site URL` = dominio productivo; `Redirect URLs` = `http://localhost:4321/auth/callback`, `https://tu-dominio/auth/callback`. **Pendiente de añadir** (el middleware usa esta URL para el enlace de confirmación y el retorno OAuth).✅ |
| 4 | Activar proveedores | Authentication → Providers | Email (con **“Confirm email” activado**) y OAuth (Google/GitHub con Client ID/Secret). ✅ Verificado 2026-10-06: `mailer_autoconfirm=false`, proveedores `email`, `github` y `google` activos. |
| 4b | Política de contraseñas | Authentication → Settings | Longitud mínima **8** (debe coincidir con `PASSWORD_MIN_LENGTH`). ✅|
| 4c | Plantillas de correo | Authentication → Email Templates | “Confirm signup” y “Reset password” apuntan a `{{ .SiteURL }}/auth/callback` (así el enlace pasa por el intercambio PKCE). ✅|
| 5 | SMTP propio | Authentication → SMTP | Recomendado en producción (entrega fiable de magic links). ✅|
| 6 | Aplicar migraciones | CLI: `supabase link` + `supabase db push` | O pegar los archivos de `supabase/migrations/` en el SQL Editor, **en orden de nombre**. Ambos son idempotentes y reconciliadores: reaplicarlos es la forma prevista de actualizar un esquema ya creado a mano. ✅ Las tres migraciones (`profiles`, `documents`, `sharing`) aplicadas por el usuario y verificadas con `pnpm db:rls` (**32/32**). ✅ `20261006140000_sharing.sql` reaplicada y comprobada en vivo (funciones de compartir, y `documents` en la publicación de Realtime). ◐ **Reaplicar `20261006130000_documents.sql`**: corrige los ayudantes de autorización (`coalesce`, hallazgo 1) y es donde vive ahora el guard de publicación (hallazgo 5). |
| 7 | Exponer tablas a la Data API | Integrations → Data API settings | Si recién creadas no aparecen: `GRANT` explícito a `authenticated` **con RLS activado** (ver skill `supabase`).✅ |
| 8 | Activar Realtime | Database → Replication | La migración `20261006140000_sharing.sql` añade `documents` a `supabase_realtime` si la publicación existe (idempotente). `document_collaborators` y `comments` se añadirán cuando alguna fase emita cambios suyos. ✅ Aplicada y comprobada en vivo: dos clientes reciben el `UPDATE` de un documento privado y un extraño no recibe nada. |
| 9 | Crear bucket de Storage | Storage → New bucket | `doc-images` (privado) + políticas (INSERT/SELECT/UPDATE).✅ |
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
| `astro-icon` + `@iconify-json/lucide` (+ `@iconify-json/simple-icons`) | **Iconos con Iconify** desde npm: SVG inline en build, sin CDN y sin JS de cliente. La lista de iconos vive en `src/lib/ui/iconNames.ts` y alimenta `icon({ include })`, obligatorio con `output: 'server'` (si no, se empaqueta el set completo: ~1 938 iconos). |
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
- **Scripts** en `package.json`: `dev`, `build`, `preview`, `astro`, `sync`, `check` (`astro check`), `test`, `test:watch`, `test:db` (integración contra el proyecto real), `lint`, `lint:fix`, `format`, `format:check`, `db:start`, `db:stop`, `db:reset`, `db:push`, `db:advisors`, `db:rls` (RLS contra el proyecto real), `db:types`.
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

- Iconos con **Iconify** vía `astro-icon` + colecciones npm (compilados a SVG en build, sin CDN ni JS de cliente) — sustituyó a `@lucide/astro` en la Fase 2 por decisión del cliente. **`@tailwindcss/typography`** aporta el `prose`.

**Bugs del original corregidos durante el port (documentados en el código):**

1. **Slug de encabezados repetidos:** el original asignaba `-1` a la 3.ª aparición y siguientes; ahora numera `-1`, `-2`, … de forma secuencial (`render.ts`).
2. **Desmarcar cita:** al quitar `>`, el grupo de captura incluía el propio marcador y quedaba un `>` suelto (`>q`); ahora se elimina el prefijo completo (`commands.ts`).
3. **Renombrado de pestañas:** reconstruir el DOM en cada clic impedía el doble clic para renombrar; ahora los nodos de pestaña se reutilizan (`editorApp.ts`).

**Desviaciones conscientes:** `EditorPane` agrupa los antiguos `CodePane`/`PreviewPane`/`Splitter` en un solo componente; `IndexedDB` y `nanostores` se posponen a la Fase 3.

### Fase 2 — Infra Supabase y autenticación (1–2 días) ✅ *completada en este repo*
- Proyecto Supabase, `.env`, `@supabase/ssr`, middleware, login/logout, perfil, tipos generados.
- **Métodos de acceso (decisión del cliente):** **email + contraseña con verificación por correo** + OAuth **GitHub** y **Google** (ver Bloque 7).
- **Entregable cumplido:** acceso real, sesión persistente en cookies, pantallas de cuenta y degradación limpia sin Supabase.

**Implementación real (rutas):**

| Módulo | Contenido |
|---|---|
| `src/lib/supabase/*` | `env` (astra:env), `config` (normalización + URL de callback), `client` (navegador), `server` (cliente por request), `cookies`, `errors` (clasificación de errores de Auth), `types`, `database.types` |
| `src/lib/auth/*` | `session` (`getSession` → `getUser` → perfil), `profile` (correo/nombre/usuario/iniciales), `password` (política), `account` (view-model + métodos de acceso), `messages` (catálogo de avisos), `routes` (rutas protegidas), `redirect` (saneado de `next`) |
| `src/middleware.ts` | Refresco de cookies, `locals.supabase/user/profile`, guardas de ruta y `Cache-Control: private` en respuestas con sesión |
| `src/components/auth/*` | `AuthShell` (marco común + script de mostrar contraseña y comprobar la confirmación), `EmailField`, `PasswordField`, `OAuthButtons` |
| `src/pages/{login,signup,forgot-password,reset-password}.astro` | Las cuatro pantallas de acceso |
| `src/pages/auth/*` | `signin`, `signup`, `resend`, `password/forgot`, `password/update`, `oauth/[provider]`, `callback` (PKCE y OTP) |
| `src/pages/{dashboard,settings}.astro`, `settings/profile.ts` | Área de cuenta: perfil, estado de verificación, métodos de acceso y cambio de contraseña |
| `supabase/migrations/20261006120000_profiles.sql` | `public.profiles` + RLS + trigger `private.handle_new_user` |

**Decisiones de seguridad:** las respuestas con sesión nunca se cachean; la secret key no llega al navegador; los errores de Supabase se mapean a códigos (nunca se reenvía el mensaje del proveedor); `next` se sanea antes de cualquier redirección; ninguna respuesta revela si un correo tiene cuenta.

**Verificado contra el proyecto real (2026-10-06):** `/auth/v1/settings` → `mailer_autoconfirm=false` (confirmación por correo activa) y proveedores `email`, `github`, `google` habilitados; el inicio de sesión con credenciales falsas devuelve `invalid_credentials` y la pantalla lo muestra; `/auth/oauth/{google,github}` responde 302 a `…/auth/v1/authorize` con `redirect_to` apuntando a `/auth/callback?next=…`; las guardas de ruta redirigen con `next` preservado.

**Suite:** 108 tests en 8 archivos (`pnpm test`), `astro check` sin errores ni warnings (5 hints de `execCommand`/`print`), `astro build` en verde.

**Pendiente manual (Bloque 10):** aplicar la migración `profiles` (`pnpm db:push` o SQL Editor) y registrar las *Redirect URLs* en Supabase. Hasta entonces el perfil se deriva del correo y `/settings` no persiste.

### Fase 3 — Documentos y persistencia real (3–5 días) ✅ *código completo; reaplicar la migración de documentos*
- ✅ **Esquema del Bloque 6 + RLS**, en `supabase/migrations/20261006130000_documents.sql`: seis tablas, enums, índices, triggers (`updated_at`, `bump_document_revision`, `snapshot_document_version`, `set_document_slug`) y las funciones de autorización en `private`. Ver decisiones y correcciones en 6.4.
- ✅ **Pruebas de RLS** (32 escenarios, 32/32 al cerrar la fase; **36** tras la Fase 4), en `tests/db/rls.mjs` (`pnpm db:rls`) y **de integración** (9 escenarios), en `tests/integration/documents.test.ts` (`pnpm test:db`). Solo el proyecto real puede probar una política o un trigger. La Fase 4 añadió una tercera suite de integración (`tests/integration/sharing.test.ts`, 13 escenarios) y una de Realtime (`tests/integration/realtime.test.ts`, 5 escenarios).
- ✅ Dashboard (crear/renombrar/eliminar/abrir), autosave con `revision` y resolución de conflictos, historial con restauración.
- ✅ **Editores ilimitados con nombre propio** (multi-pestaña) persistidos en `documents.title`: en sesión, cada pestaña del editor es una fila.
- ✅ Migración de borradores locales (`mdviewer:*` y las pestañas previas) desde el dashboard.
- **Entregable:** documentos en Postgres con dueño, seguros por RLS, editables y versionados.

**Implementación real:**

| Módulo | Contenido |
|---|---|
| `src/lib/documents/repository.ts` | Capa de datos del servidor: `listDocuments`, `getDocument`, `createDocument`, `saveDocument`/`renameDocument` (con `revision`), `deleteDocument`, `listVersions`, `getVersion`, `restoreVersion`, `importDrafts`, `slugForTitle`. Siempre con el cliente del usuario; nunca con la secret key. |
| `src/lib/documents/cloudApi.ts` | Cliente de navegador: `openCloudDocuments()` (sonda que devuelve `null` si no hay sesión) y `CloudSession` (`create`/`save`/`fetch`/`remove`), con `keepalive` en el descargue final. |
| `src/lib/documents/access.ts`, `ids.ts` | Reglas de acceso (`owner`/`admin`/`editor`/`reader`) y validación de uuid, puras y testeables. |
| `src/lib/documents/drafts.ts`, `importDrafts.ts` | Lectura y límites de los borradores locales + importación sin duplicados (borra las copias locales al terminar). |
| `src/lib/documents/messages.ts`, `format.ts` | Catálogo de avisos por código y formateo determinista (UTC, tamaños, primera línea). |
| `src/lib/api/http.ts` | Respuestas JSON `private, no-store`, lectura de cuerpo y `apiSession` (401 si no hay sesión verificada). |
| `src/pages/api/documents/*` | `GET/POST` de la colección, `GET/PATCH/DELETE` de un documento (409 `conflict` con la revisión actual) y `POST .../import`. |
| `src/pages/documents/*` | Formularios de acción: crear (`POST /documents` → abre el editor), renombrar, eliminar, restaurar (303 en todos; el error viaja como código, nunca como texto de la base). |
| `src/pages/documents/[id]/history.astro` | Historial en server-side: revisión, autor, tamaño, texto y restaurar (solo si el rol puede escribir). |
| `src/pages/dashboard.astro` | Documentos propios y compartidos, con crear, renombrar, borrar, historial e importación de borradores. |
| `src/lib/app/editorApp.ts` | Modo nube: carga las pestañas del servidor, autosave con `revision` (debounce 1,2 s), conflicto preguntado al usuario, y descenso a modo local si no hay sesión o el proyecto no responde. |
| `src/lib/app/previewApp.ts` | El popout resuelve por API un `?doc=<uuid>` que no esté en `localStorage`. |
| `src/lib/supabase/{database.types,types}.ts` | Tipos de las seis tablas y de los enums, a mano hasta que se pueda ejecutar `pnpm db:types`. |

**Decisiones de la capa de aplicación:**

| Tema | Decisión |
|---|---|
| Modo nube | `GET /api/documents` responde 401 a un visitante anónimo: la sonda decide el modo. Así `/` es idéntico para todos (cacheable) y ninguna decisión de sesión vive en el HTML. |
| Sin sesión no hay degradación silenciosa | Si el proyecto deja de responder, el editor vuelve a `localStorage` y lo **dice**; nunca finge guardar en Postgres. |
| Conflicto | No se descarta texto nunca: se pregunta «conservar lo mío» o «cargar la versión del servidor», con la revisión nueva ya adoptada. |
| Renombrar | Una sola petición con `revision` + título + contenido: cambiar el nombre no pierde una edición pendiente, y el `slug` no se toca. |
| Borrar | `.delete().select('id')`: 0 filas significa «RLS lo filtró», y se distingue de «ya no existe» leyendo lo que ese mismo usuario puede ver. |
| Errores | Códigos cortos (`stale`, `forbidden`, `not_found`, …) en la URL y en el JSON; el detalle de Postgres se queda en el log del servidor. |

**Estado medido en el proyecto real (2026-10-06):** `pnpm db:rls` → **32/32** y `pnpm test:db` → documentos **9/9**, tras reaplicar `20261006130000_documents.sql` con la corrección de recursión de `documents_update_editor` (ver 6.4). El historial del hallazgo: antes de la corrección eran **23/31** y **3/9**, todos los fallos por el `42P17` de esa política, que dejaba todo `UPDATE` sobre `documents` sin efecto (`PATCH`/autosave respondía `500 save_failed`). La comprobación `owner_id cannot be reassigned` acepta ahora las dos respuestas correctas de Postgres —rechazo explícito `42501` o filtrado silencioso— y añade una lectura posterior que confirma que el documento sigue siendo del dueño.

**Lo que encontró la reconciliación (esquema creado a mano a partir del DDL del Bloque 6):** faltaban las políticas, `documents.slug` no tenía trigger (todo insert fallaba con `23502`), `document_versions` no tenía `title`, `document_collaborators` no tenía `updated_at` y el índice de búsqueda estaba configurado en `spanish`. Las migraciones del repo reconcilian todo eso de forma idempotente: **pegar los dos archivos de `supabase/migrations/` en orden y ejecutar `pnpm db:rls`**.

**Hallazgos de diseño que las migraciones resuelven (y que el DDL del plan no preveía):**

| Tema | Decisión |
|---|---|
| Recursión de políticas | Helpers `SECURITY DEFINER` en `private` con el `uid` por parámetro (ver 6.4). |
| Concurrencia | `update … eq('revision', n)` + trigger que incrementa; el escritor obsoleto actualiza 0 filas y se le ofrece recargar. |
| Historial | Snapshot del estado reemplazado, **como máximo cada 10 minutos** y solo si cambió el texto: el autosave cada pocos segundos haría la historia inmanejable. Los últimos minutos no son recuperables uno a uno (decisión consciente). |
| `owner_id` inmutable | `WITH CHECK` compara contra el valor almacenado: sin eso un colaborador `editor` podría reasignarse la propiedad del documento. |
| `slug` estable | Se asigna al crear y **no cambia al renombrar**: los enlaces públicos no deben romperse. Regla espejo de `slugifyHeading` (`src/lib/markdown/slug.ts`) con sufijos `-1`, `-2`… ante colisión. |
| Invitaciones | Segundo trigger en `auth.users` (`private.handle_new_user_invitations`) que convierte las invitaciones pendientes en colaboradores al registrarse; el trigger de perfiles sigue siendo responsabilidad de su migración. |
| Búsqueda | Columna generada `to_tsvector('english', …)`; el idioma se corrige en la reconciliación si el esquema se creó con otro. |

### Fase 4 — Colaboración Nivel 1 (3–5 días) ✅ *código completo; reaplicar `20261006130000_documents.sql`, que es donde vive el guard de publicación*
- ✅ **Compartir**: invitación por correo con rol editor/lector (con o sin cuenta), cambio de rol, revocación, enlace con token + caducidad + revocación, y visibilidad private/unlisted/public. Todo en `/documents/:id/share` con formularios POST normales.
- ✅ **Realtime Nivel 1**: presencia (iniciales + color estable), cambios en vivo vía `postgres_changes` sobre `documents`, cursores remotos por `broadcast` (dibujados sobre el textarea), estado de conexión con reconexión exponencial y reintento al volver la red.
- ✅ **Enlace que funciona**: `/s/:token` resuelve el token **dentro de Postgres** (`public.resolve_share_token`) y muestra el documento en solo lectura a un visitante anónimo; con sesión, `public.claim_share_link` convierte el enlace en acceso real y manda a editar a quien puede.
- ⏭️ **Aplazado a propósito** (ver 8.1 y 8.4): cola offline en IndexedDB, canales privados con políticas sobre `realtime.messages`, y la página pública indexable `d/[slug]` con SEO (Fase 5).
- **Entregable:** dos usuarios editan el mismo documento en vivo. ◐ Verificado con dos clientes reales (suite de integración): `20261006140000_sharing.sql` ya está aplicada y comprobada en vivo —el guard de invitación rechaza a un extraño con `42501`, y `postgres_changes` entrega el `UPDATE` de un documento **privado** al dueño y al editor, y nada a un extraño—. Falta reaplicar `20261006130000_documents.sql`, que es donde vive ahora el guard de publicación: sin él, `pnpm db:rls` da **33/36** y el escenario «el editor no publica» falla.

**Hallazgos de la primera corrida en vivo (2026-10-06)** — tres defectos reales, ninguno visible sin ejecutar:

| # | Síntoma | Causa | Arreglo |
|---|---|---|---|
| 1 | **Agujero de seguridad**: cualquier cuenta con sesión podía hacerse `editor` de un documento ajeno (`invite_collaborator` respondía `collaborator`) | `private.can_manage_document` devolvía **NULL** para quien no es dueño ni admin (`NULL = 'admin'` → NULL), y en PL/pgSQL `if not NULL then raise` **no** se ejecuta: la única puerta de una función `SECURITY DEFINER` (que salta RLS) se abría sola | Los tres ayudantes (`can_read`/`can_edit`/`can_manage`) envuelven su expresión en `coalesce(..., false)`, y el guard pasa a `is not true` |
| 2 | `public.claim_share_link` fallaba con **`42702: column reference "document_id" is ambiguous`**: abrir un enlace con sesión no daba acceso | La primera columna de salida (`document_id`) ensombrece la columna homónima, así que `on conflict (document_id, user_id)` es ambiguo | El conflicto se declara por constraint (`on conflict on constraint document_collaborators_pkey`) |
| 3 | La migración **abortaba en una base limpia**: `comment on column public.document_versions.title` antes de que la tabla existiera | `comment on column` es de las pocas sentencias que no se pueden guardar con `if exists`; con el esquema ya creado a mano, el fallo quedaba oculto | El comentario se movió debajo del `create table` |
| 4 | Dos pruebas de integración afirmaban lo contrario de la política: `removeCollaborator` de un colaborador sobre **su propia** fila (la política permite «irse del documento») y un handler `postgres_changes` registrado **después** de `subscribe()` (realtime lo rechaza) | Prueba mal escrita, no código | La suite apunta a la fila de otra persona y añade un escenario propio para «irse»; el test de Realtime abre su canal antes de suscribirse |

**Hallazgos de la segunda corrida en vivo (2026-10-06)** — dos formas de fallar que leer el SQL no delata:

| # | Síntoma | Causa | Arreglo |
|---|---|---|---|
| 5 | **La política endurecida se deshizo sin que nada avisara**: un editor volvía a publicar el borrador ajeno (`PATCH documents {visibility:'public'}` → `ok`) con las dos migraciones aplicadas | `20261006130000_documents.sql` **redefinía** `documents_update_editor` sin el guard de visibilidad, así que reaplicar los ficheros con `documents` al final devolvía la política vieja: el endurecimiento de la Fase 4 vivía en el fichero equivocado | El guard y `private.document_visibility` se mudaron al fichero de documentos, junto a las demás políticas de la tabla: ningún fichero redefine ya una política del otro, así que el orden de aplicación es indiferente. `pnpm db:rls` pasa a **36** checks (los dos nuevos lo detectan hoy) y el arnés PGlite reaplica ambos ficheros al revés y comprueba que el `42501` sigue ahí |
| 6 | La suite de Realtime esperaba 25 s un `postgres_changes` que no podía llegar, justo después de añadir `documents` a la publicación | Arranque en frío del *changer* de WAL: una suscripción que llega antes de que el servidor tenga *listener* para la tabla no dispara nunca. Los mismos eventos llegaban segundos después; el test pasa en solitario (1,5 s) | `tests/integration/realtime.test.ts` abre un test propio («streams a change at all») que reintenta con canal nuevo hasta 4 veces con 120 s de presupuesto y deja el resto de aserciones con un stream ya caliente |
| 7 | El arnés PGlite fallaba con `permission denied for schema auth` en el primer `UPDATE` de editor que dispara el snapshot | El arnés no concedía `usage on schema auth` a `authenticated`; Supabase real sí lo concede, y por eso el proyecto en vivo nunca lo vio | `grant usage on schema auth to anon, authenticated, service_role` en el arnés |

**Cómo se verificó sin Docker:** los tres `.sql` se cargaron en **Postgres 18 real** (PGlite/WASM) con `auth.users`, `auth.uid()`/`auth.jwt()` y los roles `anon`/`authenticated` simulados. Ahí se comprobó que las migraciones se aplican en una base limpia, que un extraño recibe `42501` al invitar, que el dueño sí invita, que un enlace nunca degrada un rol y que `claim_share_link` ya no revienta. Lo que solo el proyecto real puede probar (políticas con RLS, Realtime sobre la publicación) sigue comprobándose con `pnpm db:rls` y `pnpm test:db`.

**Implementación real:**

| Módulo | Contenido |
|---|---|
| `supabase/migrations/20261006130000_documents.sql` | Bloque 6 completo: seis tablas, enums, triggers, los ayudantes de autorización en `private` y las políticas RLS — incluida la que impide que un `editor` publique (`private.document_visibility`). Idempotente. |
| `supabase/migrations/20261006140000_sharing.sql` | `private.role_rank`, `public.invite_collaborator`, `public.resolve_share_token`, `public.claim_share_link` y `documents` en la publicación `supabase_realtime`. Idempotente, y sin redefinir ninguna política de la migración de documentos: el orden de aplicación es indiferente. |
| `src/lib/documents/sharing.ts` | Reglas puras: parseo de direcciones, roles que un humano puede dar, ranking (espejo de `private.role_rank`), caducidades, URL del enlace, orden y resumen de la lista. |
| `src/lib/documents/repository.ts` | `inviteCollaborator` (RPC), `listCollaborators`, `setCollaboratorRole`, `removeCollaborator`, `listInvitations`, `revokeInvitation`, `listShareLinks`, `createShareLink`, `revokeShareLink`, `setVisibility`, `resolveShareToken`, `claimShareLink`. |
| `src/pages/documents/[id]/share.astro` | Página de gestión: invitar, lista de personas, invitaciones pendientes, enlaces con copiar, y visibilidad. Un no-owner ve un aviso en vez de listas vacías. |
| `src/pages/documents/[id]/share/{invite,collaborator,invitation,link,visibility}.ts` | Una acción por endpoint, 303 con código corto (`invite_failed`, `email_invalid`, `role_failed`, `link=created`, …). |
| `src/pages/s/[token].astro` | Página del enlace: anónimo → solo lectura; con sesión → reclama el acceso; token desconocido o caducado → la misma 404. Render con el pipeline probado (marked + DOMPurify) en cliente. |
| `src/lib/collab/presence.ts` | Presencia pura: color estable por cuenta, plegado de pestañas repetidas, caducidad, «You and Ana». |
| `src/lib/collab/cursor.ts` | Geometría pura del cursor: línea/columna, columnas visuales con tabuladores, caja del cursor y de la selección, visibilidad. |
| `src/lib/collab/session.ts` | Cliente Realtime: un canal por documento (`presence` + `postgres_changes` filtrado por id + `broadcast`), throttle de cursores a ~16 Hz, heartbeat, TTL de cursores, backoff exponencial y reconexión al evento `online`. |
| `src/lib/collab/overlay.ts` | Pinta los cursores remotos sobre el textarea (capa `pointer-events: none`, ancho de carácter medido, se recoloca al hacer scroll). |
| `src/components/app/PresenceBar.astro`, `StatusBar.astro` | Iniciales de quién está conectado (oculto si estás solo) y el badge *Synced / Offline*. |
| `src/lib/app/editorApp.ts` | Modo nube: el canal sigue a la pestaña visible, guarda `lastSaved` para saber qué está sin guardar, adopta en silencio lo que llega si no has tocado nada y **nunca** pisa tu texto si lo has tocado (el conflicto ya pregunta). |

**Decisiones y hallazgos:**

| Tema | Decisión |
|---|---|
| Resolver un enlace | El token se resuelve en la base de datos (función `SECURITY DEFINER`), no con la secret key en la ruta: un solo camino auditable, y «caducado» y «no existe» responden lo mismo. |
| Enlace y escritura | Un enlace `editor` **no** escribe por sí solo: exige sesión y convierte el token en una fila de colaborador (`claim_share_link`), que nunca degrada un rol mayor (`role_rank`). |
| Publicar no es editar | `documents_update_editor` exige derechos de gestión para cambiar `visibility`: sin eso, un colaborador `editor` podía hacer público el borrador de otra persona. La política vive con las demás de la tabla, en `20261006130000_documents.sql`: tenerla en la migración de `sharing` hacía que reaplicar los ficheros en el orden contrario la debilitara otra vez (hallazgo 5). |
| Coste en el navegador | El cliente de Supabase (233 kB) se importa de forma dinámica **solo con sesión**: el script de la página del editor bajó de 265 kB a **32 kB** para un visitante anónimo (medido en el build). |
| Sin regresión local | Si Realtime no está disponible, `openCollab` devuelve `null` y el editor sigue guardando exactamente como en la Fase 3; nada finge estar sincronizado. |
| Presencia ≠ texto | El canal lleva overlays (nombre, color, cursores) y no texto: el guardado sigue siendo el `revision` de Postgres, que ya estaba probado. |

**Estado medido (2026-10-06):** `pnpm db:rls` → **33/36** a falta de reaplicar `20261006130000_documents.sql` (los tres fallos son la política de publicación y el check anónimo que arrastra; con ella → **36/36**); `pnpm test:db` → documentos **9/9**, compartir **12/13** y Realtime **5/5** en solitario; `pnpm test` → **182 tests**; `astro check` 0 errores / 0 warnings (5 hints conocidos); `astro build` en verde; bundle del servidor con **63 iconos** de `iconNames.ts`. La página de compartir y el panel de edición se verificaron sobre el **build** (`pnpm preview`, puerto 4322) con una cuenta desechable: `/dashboard` 200 con el enlace *Share*, `/documents/:id/share` 200 con las cuatro secciones (invitar, personas, enlaces, visibilidad), `POST …/share/link` → `?link=created` con token de 48 hex, `GET /api/documents` con `viewer`, y `/s/<token>` → 404 amable mientras la migración no esté aplicada.

**Aviso de entorno:** el servidor de desarrollo que quedó corriendo en el puerto 4321 (más de 45 minutos con HMR) empezó a responder HTML **vacío** (200, 0 bytes) en las páginas con sesión —`/dashboard`, `/documents/:id/history`, `/documents/:id/share`— mientras `/`, `/login` y los endpoints seguían bien. El mismo código compilado en `pnpm preview` renderiza todo, así que es un artefacto de ese proceso: `pnpm astro dev stop` y volver a arrancarlo lo resuelve. |

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
| DB/RLS | `tests/db/rls.mjs` (`pnpm db:rls`) | 36 escenarios contra el proyecto real con tres cuentas desechables: aislamiento entre usuarios, roles, concurrencia optimista, snapshots, invitaciones (incluido el alta posterior y el rol concedido), borrado, lectura anónima de documentos públicos, que un extraño no puede auto-invitarse por el RPC y que un editor no puede publicar. Es el único nivel que puede probar una política: la aplica Postgres, no el código. |
| Integración | Vitest + proyecto real (`pnpm test:db`) | `tests/integration/documents.test.ts`: 9 escenarios sobre la capa de datos (`create/list/save/conflict/rename/history/restore/forbidden/delete`) con sesiones reales, sin keys de servicio en el camino de la app. |
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
- [ ] Un usuario se registra con correo y contraseña, confirma la dirección, entra también con **GitHub/Google** y puede recuperar su contraseña desde el enlace de correo.
- [x] Dos usuarios editan el mismo documento y ven cambios/presencia en vivo. *(Fase 4: presencia, cambios en vivo y cursores; verificado con dos clientes reales sobre el proyecto. La suite de Realtime se ejecuta con `pnpm test:db` y requiere la publicación aplicada; su primer test calienta el *listener* de la tabla, con reintentos, para que una publicación recién activada no haga fallar a los demás.)*
- [x] Un documento puede compartirse por **enlace** (con rol, caducidad y revocación) y por **invitación a un correo** con rol editor/lector. ◐ Queda para la Fase 5 que un documento `public` tenga además página indexable (`d/[slug]`) con SEO.
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

**Tú (manual, Supabase):** crear proyecto ✅ → copiar URL + publishable + secret ✅ → activar email (**Confirm email**) + OAuth **GitHub/Google** ✅ → **pendiente:** Site/Redirect URLs, migraciones (`supabase link`/`db push`), SMTP propio, Data API grants, activar Realtime, bucket `doc-images`, `db advisors`, backups/alarmas, variables en el host.

**Yo (código, por fases):** Fase 0 fundaciones ✅ → Fase 1 componentización con paridad ✅ → Fase 2 auth con contraseña + verificación por correo + OAuth ✅ → Fase 3 documentos + RLS ✅ → Fase 4 colaboración Nivel 1 ✅ (código completo; reaplicar `20261006130000_documents.sql` y `20261006140000_sharing.sql`) → Fase 5 público/comentarios/export → Fase 6 hardening → Fase 7 backlog.

**Nunca:** `service_role` en el cliente · `auth.role()` en políticas · `user_metadata` para autorización · tablas sin RLS · versiones sin fijar · secretos en el repo.

---

*Fin del plan. Documento vivo: se actualiza al cerrar cada fase.*
