// Article export and clipboard feedback share one owner, independent of navigation.
const excluded = [
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
]);
const escapeText = (text) => text.replace(/\\/g, "\\\\").replace(/[`*_[\]<>#]/g, "\\$&");
const longestTicks = (text) => Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
const decorateInline = (text, decorate) =>
  text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_match, before, value, after) =>
    value ? `${before}${decorate(value)}${after}` : text,
  );

function inline(node) {
  if (node.nodeType === 3) return escapeText(node.textContent.replace(/\s+/g, " "));
  if (node.nodeType !== 1 || node.matches(excluded)) return "";
  const content = () => [...node.childNodes].map(inline).join("");
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
      const text = node.textContent.replace(/\r?\n/g, " ");
      const fence = "`".repeat(longestTicks(text) + 1);
      const pad = /^`|`$/.test(text) || (/^ .* $/.test(text) && /\S/.test(text)) ? " " : "";
      return `${fence}${pad}${text}${pad}${fence}`;
    }
    case "A": {
      const label = content();
      const href = node.getAttribute("href");
      if (!href) return label;
      const url = new URL(href, node.ownerDocument.baseURI);
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

function children(node) {
  const parts = [];
  let text = "";
  function flush() {
    const paragraph = text.trim();
    if (paragraph)
      parts.push(paragraph.replace(/^(\d+)([.)]) /, "$1\\$2 ").replace(/^([-+]) /, "\\$1 "));
    text = "";
  }
  for (const child of node.childNodes) {
    if (child.nodeType === 1 && child.matches(excluded)) continue;
    if (child.nodeType === 1 && blockTags.has(child.tagName)) {
      flush();
      const rendered = block(child);
      if (rendered) parts.push(rendered);
    } else text += inline(child);
  }
  flush();
  return parts.join("\n\n");
}

function list(node) {
  let number = Number(node.getAttribute("start") || 1);
  return [...node.children]
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

function table(node) {
  const rows = [...node.rows]
    .filter((row) => !row.matches(excluded))
    .map((row) =>
      [...row.cells]
        .filter((cell) => !cell.matches(excluded))
        .map((cell) => children(cell).replace(/\|/g, "\\|").replace(/ *\n+/g, "<br>")),
    );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const render = (row) =>
    `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
  return [render(rows[0]), render(Array(width).fill("---")), ...rows.slice(1).map(render)].join(
    "\n",
  );
}

function block(node) {
  if (node.matches(excluded)) return "";
  if (/^H[1-6]$/.test(node.tagName))
    return `${"#".repeat(Number(node.tagName[1]))} ${inline(node).trim()}`;
  switch (node.tagName) {
    case "UL":
    case "OL":
      return list(node);
    case "PRE": {
      const code = node.querySelector("code");
      const text = (code || node).textContent.replace(/\r\n/g, "\n");
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

export function serializeArticle(article) {
  return `${children(article)}\n`;
}

export function installDocumentationCopy(document) {
  const article = document.querySelector("[data-doc-article]");
  const header = article?.querySelector(".article-header");
  const title = header?.querySelector("h1");
  if (!title || article.querySelector("[data-doc-copy-page]")) return;
  const window = document.defaultView;
  const controls = document.createElement("div");
  controls.className = "article-title-row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-page-button";
  button.dataset.docCopyPage = "";
  button.innerHTML =
    '<svg aria-hidden="true"><use href="#icon-copy"></use></svg><span>Copy page</span>';
  title.before(controls);
  controls.append(title, button);
  const status = document.createElement("div");
  status.dataset.docCopyStatus = "";
  status.className = "doc-copy-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  const feedback = document.createElement("div");
  feedback.className = "doc-copy-feedback";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "doc-copy-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss copy status");
  dismiss.textContent = "×";
  dismiss.hidden = true;
  feedback.append(status, dismiss);
  document.body.append(feedback);

  let operation = 0;
  let source = button;
  function report(message) {
    status.textContent = message;
    dismiss.hidden = !message;
  }
  dismiss.addEventListener("click", () => {
    const restoreFocus = document.activeElement === dismiss;
    operation++;
    report("");
    if (restoreFocus && source.isConnected) source.focus();
  });
  // Clipboard writes cannot be cancelled. Only the newest request may publish feedback.
  async function copy(kind, getText, trigger) {
    const request = ++operation;
    source = trigger;
    report(`Copying ${kind}…`);
    try {
      await window.navigator.clipboard.writeText(getText());
      if (request === operation && status.isConnected)
        report(kind === "page" ? "Page copied as Markdown." : "Code copied.");
    } catch {
      if (request === operation && status.isConnected)
        report(`Unable to copy ${kind}. Allow clipboard access and try again.`);
    }
  }
  button.addEventListener("click", () => copy("page", () => serializeArticle(article), button));
  article.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (!code) return;
    const codeButton = document.createElement("button");
    codeButton.type = "button";
    codeButton.className = "copy-button";
    codeButton.setAttribute("aria-label", "Copy code");
    codeButton.innerHTML = '<svg aria-hidden="true"><use href="#icon-copy"></use></svg>';
    codeButton.addEventListener("click", () =>
      copy("code", () => code.textContent || "", codeButton),
    );
    pre.append(codeButton);
  });
  window.addEventListener("pagehide", () => {
    operation++;
    report("");
  });
}

if (typeof document !== "undefined") installDocumentationCopy(document);
