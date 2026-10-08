declare module 'pdfmake/build/pdfmake' {
  export interface PdfMakeClient {
    createPdf(definition: unknown): {
      getBlob(callback: (blob: Blob) => void): void;
      download(fileName?: string): void;
    };
    addVirtualFileSystem?: (files: Record<string, string>) => void;
    vfs?: Record<string, string>;
  }

  const pdfMake: PdfMakeClient;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const vfs: Record<string, string>;
  export default vfs;
}
