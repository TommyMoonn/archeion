import useBrokenLinks from "@docusaurus/useBrokenLinks";

// Nonheading fragments share the framework's build-time anchor validation.
export function DocsAnchor({ id }: { id: string }) {
  useBrokenLinks().collectAnchor(id);
  return <span id={id} tabIndex={-1} className="scroll-mt-24" />;
}
