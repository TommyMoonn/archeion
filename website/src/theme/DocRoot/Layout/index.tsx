import type { Props } from "@theme/DocRoot/Layout";
import { DocsShell } from "@/components/docs/DocsShell";

export default function DocRootLayout({ children }: Props) {
  return <DocsShell>{children}</DocsShell>;
}
