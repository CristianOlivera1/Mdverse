import type { PdfDocumentDefinition, PdfMeta } from './pdfDefinition';
import type { PdfMakeClient } from 'pdfmake/build/pdfmake';

let engine: Promise<PdfMakeClient> | null = null;

function loadEngine(): Promise<PdfMakeClient> {
  engine ??= (async () => {
    const [module, fonts] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
    ]);

    const pdfMake = (module.default ?? module) as PdfMakeClient;
    const vfs = fonts.default as Record<string, string>;

    if (vfs) {
      if (typeof pdfMake.addVirtualFileSystem === 'function') pdfMake.addVirtualFileSystem(vfs);
      else pdfMake.vfs = vfs;
    }

    return pdfMake;
  })();

  return engine;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'function') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('unreadable image'));
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await blobToDataUrl(await response.blob());
  } catch {
    return null;
  }
}

export async function embedPdfImages(definition: PdfDocumentDefinition): Promise<void> {
  const { collectImageNodes } = await import('./pdfDefinition');
  const nodes = collectImageNodes(definition.content);
  if (nodes.length === 0) return;

  const images: Record<string, string> = {};
  await Promise.all(
    nodes.map(async (node, index) => {
      const dataUrl = await fetchAsDataUrl(node.image as string);
      if (!dataUrl) {
        delete node.image;
        node.text = 'Image could not be embedded';
        node.italics = true;
        node.color = '#6b7280';
        return;
      }
      const key = `image_${index}`;
      images[key] = dataUrl;
      node.image = key;
    }),
  );

  if (Object.keys(images).length > 0) definition.images = images;
}

export async function renderPdf(markdown: string, meta: PdfMeta): Promise<Blob> {
  const [{ buildPdfDefinition }, pdfMake] = await Promise.all([import('./pdfDefinition'), loadEngine()]);
  const definition = buildPdfDefinition(markdown, meta);
  await embedPdfImages(definition);

  return new Promise<Blob>((resolve, reject) => {
    try {
      pdfMake.createPdf(definition).getBlob((blob) => resolve(blob));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
