import fs from "node:fs";
import { expect, it } from "vitest";

it("keeps one article-local page/code clipboard owner and excludes generated chrome", () => {
  const clipboard = fs.readFileSync("website/src/components/docs/DocsClipboard.tsx", "utf8");
  const article = fs.readFileSync("website/src/components/docs/DocsArticle.tsx", "utf8");
  const serializer = fs.readFileSync("website/src/components/docs/serializeArticle.ts", "utf8");
  expect(clipboard.match(/role="status"/g)).toHaveLength(1);
  expect(clipboard).toContain("serializeArticle(articleRef.current)");
  expect(article).toContain("key={metadata.permalink}");
  expect(article.indexOf("</DocsClipboard>")).toBeLessThan(article.indexOf("<DocsArticleFooter"));
  expect(serializer).toContain("[data-copy-exclude]");
  expect(serializer).not.toMatch(/innerHTML|innerText/);
  // Serializer vocabulary and actual MDX-rendered clipboard lifecycle run in website tests.
});
