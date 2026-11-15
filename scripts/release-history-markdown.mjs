// A deliberately small, shared vocabulary for the Node projection and React timeline.
export function parseReleaseInline(text) {
  const nodes = [];
  let plain = "";
  const flush = () => {
    if (plain) nodes.push({ type: "text", value: plain });
    plain = "";
  };
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    const code = /^`([^`\n]+)`(?!`)/.exec(rest);
    const strong = /^\*\*([^*\n]+)\*\*/.exec(rest);
    const link = /^\[([^\]\n]+)\]\(([^\s)]+)\)/.exec(rest);
    if (code && !rest.startsWith("``")) {
      flush();
      nodes.push({ type: "code", value: code[1] });
      index += code[0].length;
    } else if (strong) {
      flush();
      nodes.push({ type: "strong", children: parseReleaseInline(strong[1]) });
      index += strong[0].length;
    } else if (link) {
      let url;
      try {
        url = new URL(link[2]);
      } catch {
        throw new Error(`Release-note links must use an absolute HTTP(S) URL: ${link[2]}`);
      }
      if (!/^https?:\/\//i.test(link[2]) || !["https:", "http:"].includes(url.protocol))
        throw new Error(`Unsafe release-note link: ${link[2]}`);
      flush();
      nodes.push({ type: "link", href: link[2], children: parseReleaseInline(link[1]) });
      index += link[0].length;
    } else {
      if (/^[`*\[\]]/.test(rest) || /^!\[/.test(rest))
        throw new Error(`Unsupported release-note inline Markdown: ${rest}`);
      plain += text[index++];
    }
  }
  flush();
  return nodes;
}

export function parseReleaseChanges(markdown) {
  const items = [];
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const bullet = /^[-*] (\S.*)$/.exec(line);
    const prose = line.trim();
    if (bullet) items.push(bullet[1]);
    else if (
      /^ {2,}\S/.test(line) &&
      !/^(?:[-*+]\s|\d+[.)]\s|#{1,6}(?:\s|$)|>|`{3}|~{3}|\||<|[-*_]{3,}$)/.test(prose) &&
      items.length
    )
      items[items.length - 1] += ` ${prose}`;
    else throw new Error(`Unsupported release-note Changes block: ${line}`);
  }
  if (!items.length) throw new Error("Release timeline requires a non-empty Changes list.");
  return items.map(parseReleaseInline);
}

export function releaseInlineText(nodes) {
  return nodes
    .map((node) => ("value" in node ? node.value : releaseInlineText(node.children)))
    .join("");
}
