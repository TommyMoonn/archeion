import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { expect } from "vitest";

export function resolveLocalPage(
  sourceFile: string,
  href: string,
): { file: string; fragment?: string } | null {
  if (/^(?:[a-z]+:)?\/\//i.test(href) || /^(?:mailto|javascript):/i.test(href)) return null;
  const [withoutQuery] = href.split("?");
  const [pathname, fragment] = withoutQuery.split("#");
  let target = pathname ? path.resolve(path.dirname(sourceFile), pathname) : sourceFile;
  if (pathname.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory()))
    target = path.join(target, "index.html");
  return { file: target, ...(fragment ? { fragment } : {}) };
}

export async function verifyDocumentationLinks(pages: string[]) {
  const corpus = new Map<string, { hrefs: string[]; ids: Set<string> }>();
  async function readPage(file: string) {
    file = path.resolve(file);
    const cached = corpus.get(file);
    if (cached) return cached;
    const window = new Window({
      settings: {
        disableJavaScriptEvaluation: true,
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
      },
    });
    try {
      window.document.write(fs.readFileSync(file, "utf8"));
      const page = {
        hrefs: [...window.document.querySelectorAll("a[href]")].map((link) =>
          link.getAttribute("href")!,
        ),
        ids: new Set([...window.document.querySelectorAll("[id]")].map((element) => element.id)),
      };
      corpus.set(file, page);
      return page;
    } finally {
      await window.happyDOM.abort();
    }
  }
  for (const sourceFile of pages) {
    const source = await readPage(sourceFile);
    for (const href of source.hrefs) {
      const target = resolveLocalPage(sourceFile, href);
      if (!target) continue;
      const context = `${path.relative(process.cwd(), sourceFile)} -> ${href}`;
      expect(fs.existsSync(target.file), `${context} should resolve`).toBe(true);
      if (target.fragment) {
        const destination = await readPage(target.file);
        expect(
          destination.ids.has(decodeURIComponent(target.fragment)),
          `${context} fragment should exist`,
        ).toBe(true);
      }
    }
  }
}
