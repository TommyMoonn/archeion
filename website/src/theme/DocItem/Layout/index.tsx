import type { Props } from "@theme/DocItem/Layout";
import { DocsArticle } from "@/components/docs/DocsArticle";

export default function DocItemLayout({ children }: Props) {
  return <DocsArticle>{children}</DocsArticle>;
}
