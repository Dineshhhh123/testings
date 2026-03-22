export type ParsedDocument = {
  title: string;
  content: string;
  metadata?: Record<string, string>;
};

export async function parsePlainText(title: string, content: string): Promise<ParsedDocument> {
  return {
    title,
    content,
    metadata: {}
  };
}
