type MermaidModule = typeof import('mermaid');

const THEME_VARIABLES = {
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  background: '#000',
  primaryColor: '#171717',
  primaryTextColor: '#ededed',
  primaryBorderColor: '#525252',
  secondaryColor: '#1f1f1f',
  tertiaryColor: '#0a0a0a',
  lineColor: '#a3a3a3',
  textColor: '#ededed',
  mainBkg: '#171717',
  nodeBorder: '#525252',
  clusterBkg: '#0a0a0a',
  clusterBorder: '#333',
  edgeLabelBackground: '#0a0a0a',
  titleColor: '#ededed',
  taskBkgColor: '#2563eb',
  taskTextColor: '#fff',
  gridColor: '#262626',
  sectionBkgColor: '#0f0f0f',
  altSectionBkgColor: '#050505',
};

let loader: Promise<MermaidModule> | null = null;
let initialised = false;

/**
 * Mermaid is heavy, so it is imported lazily: the chunk only loads the first
 * time a document actually contains a diagram (see block 13 of the plan).
 */
async function loadMermaid(): Promise<MermaidModule> {
  loader ??= import('mermaid');
  const module = await loader;
  if (!initialised) {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      suppressErrorRendering: true,
      themeVariables: THEME_VARIABLES,
    });
    initialised = true;
  }
  return module;
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 100;
let counter = 0;

/** Render a Mermaid definition to an SVG string, with a small cache. */
export async function renderDiagram(source: string): Promise<string> {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;

  const module = await loadMermaid();
  const id = `mermaid-${++counter}`;
  try {
    const { svg } = await module.default.render(id, source);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(source, svg);
    return svg;
  } catch (error) {
    // Mermaid leaves helper nodes behind when it fails.
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    throw error;
  }
}
