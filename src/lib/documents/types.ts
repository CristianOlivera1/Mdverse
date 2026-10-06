/** A locally open document (one editor tab). */
export interface OpenDocument {
  readonly id: string;
  title: string;
  content: string;
}
