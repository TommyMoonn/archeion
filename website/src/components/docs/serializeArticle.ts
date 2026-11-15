function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

// Article export and clipboard feedback share one owner, independent of navigation.
const excluded = [
  "[data-copy-exclude]",
  "[inert]",
  "[hidden]",
  '[aria-hidden="true"]',
  ".sr-only",
  "script",
  "style",
  "button",
  "svg",
  "nav",
  "footer",
  ".mobile-outline",
  ".heading-permalink",
  "[data-doc-copy-controls]",
  "[data-doc-copy-status]",
].join(",");
const blockTags = new Set([
  "ARTICLE",
  "HEADER",
  "SECTION",
  "DIV",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "PRE",
  "TABLE",
  "BLOCKQUOTE",
  "HR",
  "FIGURE",
  "FIGCAPTION",
  "ASIDE",
  "DETAILS",
  "SUMMARY",
]);
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/[`*_[\]<>#]/g, "\\$&");
const longestTicks = (text: string) =>
  Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
const decorateInline = (text: string, decorate: (value: string) => string) =>
  text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_match, before, value, after) =>
    value ? `${before}${decorate(value)}${after}` : text,
  );

function inline(node: Node): string {
  if (node.nodeType === 3) return escapeText((node.textContent ?? "").replace(/\s+/g, " "));
  if (!isElement(node) || node.matches(excluded)) return "";
  const content = () => Array.from(node.childNodes).map(inline).join("");
  switch (node.tagName) {
    case "BR":
      return "  \n";
    case "STRONG":
    case "B":
      return decorateInline(content(), (value) => `**${value}**`);
    case "EM":
    case "I":
      return decorateInline(content(), (value) => `*${value}*`);
    case "CODE": {
      const text = (node.textContent ?? "").replace(/\r?\n/g, " ");
      const fence = "`".repeat(longestTicks(text) + 1);
      const pad = /^`|`$/.test(text) || (/^ .* $/.test(text) && /\S/.test(text)) ? " " : "";
      return `${fence}${pad}${text}${pad}${fence}`;
    }
    case "A": {
      const label = content();
      const href = node.getAttribute("href");
      if (!href) return label;
      let url: URL;
      try {
        url = new URL(href, node.ownerDocument.baseURI);
      } catch {
        return label;
      }
      if (!["https:", "http:", "mailto:"].includes(url.protocol)) return label;
      const destination = url.href.replace(/</g, "%3C").replace(/>/g, "%3E");
      return decorateInline(label, (value) => `[${value}](<${destination}>)`);
    }
    case "IMG":
      return escapeText(node.getAttribute("alt") || "");
    default:
      return content();
  }
}

function children(node: Node): string {
  const parts: string[] = [];
  let text = "";
  function flush() {
    const paragraph = text.trim();
    if (paragraph)
      parts.push(paragraph.replace(/^(\d+)([.)]) /, "$1\\$2 ").replace(/^([-+]) /, "\\$1 "));
    text = "";
  }
  for (const child of Array.from(node.childNodes)) {
    if (isElement(child) && child.matches(excluded)) continue;
    if (isElement(child) && blockTags.has(child.tagName)) {
      flush();
      const rendered = block(child);
      if (rendered) parts.push(rendered);
    } else text += inline(child);
  }
  flush();
  return parts.join("\n\n");
}

function list(node: HTMLElement): string {
  let number = Number(node.getAttribute("start") || 1);
  return Array.from(node.children)
    .filter((item) => item.tagName === "LI" && !item.matches(excluded))
    .map((item) => {
      if (item.hasAttribute("value")) number = Number(item.getAttribute("value"));
      const prefix = node.tagName === "OL" ? `${number++}. ` : "- ";
      return children(item)
        .split("\n")
        .map((line, index) =>
          index === 0 ? prefix + line : line ? " ".repeat(prefix.length) + line : "",
        )
        .join("\n");
    })
    .join("\n");
}

function table(node: HTMLElement): string {
  const rows = Array.from(node.querySelectorAll("tr"))
    .filter((row) => !row.matches(excluded))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td"))
        .filter((cell) => !cell.matches(excluded))
        .map((cell) => children(cell).replace(/\|/g, "\\|").replace(/ *\n+/g, "<br>")),
    );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const render = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
  return [render(rows[0]), render(Array(width).fill("---")), ...rows.slice(1).map(render)].join(
    "\n",
  );
}

function block(node: HTMLElement): string {
  if (node.matches(excluded)) return "";
  if (/^H[1-6]$/.test(node.tagName))
    return `${"#".repeat(Number(node.tagName[1]))} ${inline(node).trim()}`;
  switch (node.tagName) {
    case "UL":
    case "OL":
      return list(node);
    case "PRE": {
      const code = node.querySelector("code");
      const text = ((code || node).textContent ?? "").replace(/\r\n/g, "\n");
      const fence = "`".repeat(Math.max(3, longestTicks(text) + 1));
      const language = code?.className.match(/(?:^|\s)language-([\w+-]+)(?:\s|$)/)?.[1] || "";
      return `${fence}${language}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
    }
    case "TABLE":
      return table(node);
    case "HR":
      return "---";
    default: {
      const content = children(node);
      return node.tagName === "BLOCKQUOTE" || node.getAttribute("role") === "note"
        ? content
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n")
        : content;
    }
  }
}

export function serializeArticle(article: HTMLElement): string {
  return `${children(article)}\n`;
}
