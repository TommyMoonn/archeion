export type ReleaseInline =
  | { type: "text" | "code"; value: string }
  | { type: "strong"; children: ReleaseInline[] }
  | { type: "link"; href: string; children: ReleaseInline[] };
export function parseReleaseInline(text: string): ReleaseInline[];
export function parseReleaseChanges(markdown: string): ReleaseInline[][];
export function releaseInlineText(nodes: ReleaseInline[]): string;
