# Local icons

`astro-icon` scans this folder for extra local SVG icons and warns on every build
when it is missing:

```
[WARN] [astro-icon] Failed to load icons from "src/icons": ENOENT ...
```

The app takes its icons from the Iconify collections installed as npm packages
(`@iconify-json/lucide`, `@iconify-json/simple-icons`), and the ones that ship are
listed in `src/lib/ui/iconNames.ts`. Nothing is loaded from here today.

Drop `.svg` files in this folder only if a one-off icon is ever needed; keep them
out of the collections so the list in `iconNames.ts` stays the single source of
truth for what ends up in the bundle.
