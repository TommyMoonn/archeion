import JSZip from "jszip";
import type { Document as XmlDocument } from "@xmldom/xmldom";

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const supportedTypes: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  css: "text/css",
  svg: "image/svg+xml",
  ncx: "application/x-dtbncx+xml",
};

/** Fixture-level verification, not a general EPUBCheck replacement. */
export async function validateReaderFixture(
  bytes: Uint8Array,
  spineCount: number,
  parse: (text: string) => XmlDocument,
): Promise<void> {
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  require(header.getUint32(0, true) === 0x04034b50, "Invalid ZIP header");
  const nameLength = header.getUint16(26, true);
  require(new TextDecoder().decode(bytes.subarray(30, 30 + nameLength)) ===
    "mimetype", "mimetype must be first");
  require(header.getUint16(8, true) === 0 &&
    header.getUint16(28, true) === 0, "mimetype must be stored without extra fields");
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const read = async (path: string) => {
    const entry = zip.file(path);
    require(entry, `Missing resource: ${path}`);
    return entry.async("string");
  };
  require((await read("mimetype")) === "application/epub+zip", "Invalid mimetype");
  const documents = new Map<string, XmlDocument>();
  const getDocument = async (path: string) => {
    let doc = documents.get(path);
    if (!doc) {
      doc = parse(await read(path));
      documents.set(path, doc);
    }
    return doc;
  };
  const resolve = (from: string, href: string) => {
    require(!/^[a-z]+:|^\/|\\/i.test(href), `Non-local reference: ${href}`);
    const url = new URL(href, `https://fixture.invalid/${from}`);
    return {
      path: decodeURIComponent(url.pathname.slice(1)),
      fragment: decodeURIComponent(url.hash.slice(1)),
    };
  };
  const container = await getDocument("META-INF/container.xml");
  const roots = container.getElementsByTagName("rootfile");
  require(roots.length === 1, "Expected one container rootfile");
  require(roots[0].getAttribute("media-type") ===
    "application/oebps-package+xml", "Invalid OPF content type");
  const opfPath = roots[0].getAttribute("full-path");
  require(opfPath && !opfPath.includes(".."), "Invalid OPF path");
  const opf = await getDocument(opfPath);
  const legacy = opf.documentElement?.getAttribute("version") === "2.0";
  require(opf.documentElement?.namespaceURI === "http://www.idpf.org/2007/opf" &&
    (legacy || opf.documentElement.getAttribute("version") === "3.0"), "Invalid EPUB package");
  const metadata = opf.getElementsByTagName("metadata")[0];
  require(metadata, "Missing metadata");
  for (const tag of ["dc:identifier", "dc:title", "dc:language"])
    require(metadata.getElementsByTagName(tag).length === 1, `Missing ${tag}`);
  require(metadata.getElementsByTagName("dc:identifier")[0].getAttribute("id") ===
    opf.documentElement.getAttribute("unique-identifier"), "Broken unique identifier");
  if (!legacy)
    require(Array.from(metadata.getElementsByTagName("meta")).some(
      (element) =>
        element.getAttribute("property") === "dcterms:modified" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(element.textContent ?? ""),
    ), "Missing modified timestamp");
  const items = Array.from(opf.getElementsByTagName("item"));
  const manifest = new Map<string, string>();
  const resources = new Set<string>();
  let navPath = "";
  for (const item of items) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    require(id && href && !manifest.has(id), "Invalid or duplicate manifest id");
    const { path, fragment } = resolve(opfPath, href);
    require(!fragment && !resources.has(path), "Duplicate or fragmented manifest resource");
    require(item.getAttribute("media-type") ===
      supportedTypes[path.split(".").pop()!], `Invalid media type: ${path}`);
    await read(path);
    manifest.set(id, path);
    resources.add(path);
    if (item.getAttribute("properties")?.split(/\s+/).includes("nav")) {
      require(!navPath, "Duplicate nav");
      navPath = path;
    }
  }
  if (legacy) {
    navPath = manifest.get(opf.getElementsByTagName("spine")[0]?.getAttribute("toc") ?? "") ?? "";
    require(navPath.endsWith(".ncx"), "Missing EPUB 2 NCX navigation");
  }
  require(navPath, "Missing EPUB navigation");
  const refs = Array.from(opf.getElementsByTagName("itemref"));
  require(refs.length === spineCount, "Unexpected spine count");
  const spinePaths = refs.map((ref) => {
    const path = manifest.get(ref.getAttribute("idref") ?? "");
    require(path && path.endsWith(".xhtml"), "Broken spine link");
    return path;
  });
  require(new Set(spinePaths).size === spineCount, "Duplicate spine item");
  const checkLink = async (from: string, href: string) => {
    const { path, fragment } = resolve(from, href);
    require(resources.has(path), `Unmanifested asset reference: ${from} -> ${href}`);
    await read(path);
    if (fragment) {
      const doc = await getDocument(path);
      require(Array.from(doc.getElementsByTagName("*")).some(
        (element) => element.getAttribute("id") === fragment,
      ), `Missing fragment: ${href}`);
    }
  };
  for (const path of resources) {
    if (path.endsWith(".css")) {
      const css = await read(path);
      for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))
        await checkLink(path, match[1]);
      require(!/@import/i.test(css), "Fixture CSS must not import external styles");
      continue;
    }
    const doc = await getDocument(path);
    const root = doc.documentElement;
    require(root?.namespaceURI ===
      (path.endsWith(".svg")
        ? "http://www.w3.org/2000/svg"
        : path.endsWith(".ncx")
          ? "http://www.daisy.org/z3986/2005/ncx/"
          : "http://www.w3.org/1999/xhtml"), `Invalid XML namespace: ${path}`);
    const ids = new Set<string>();
    for (const element of Array.from(doc.getElementsByTagName("*"))) {
      const id = element.getAttribute("id");
      if (id) {
        require(!ids.has(id), `Duplicate element id: ${path}#${id}`);
        ids.add(id);
      }
      require(element.tagName !== "script", "Fixture scripts are prohibited");
      for (const attr of ["src", "href", "xlink:href", "usemap"]) {
        const href = element.getAttribute(attr);
        if (href) await checkLink(path, href);
      }
    }
  }
  const nav = await getDocument(navPath);
  if (legacy) require(nav.getElementsByTagName("navMap").length === 1, "Missing NCX TOC");
  else
    require(Array.from(nav.getElementsByTagName("nav")).some(
      (element) => element.getAttribute("epub:type") === "toc",
    ), "Missing TOC");
  const navTargets = Array.from(nav.getElementsByTagName(legacy ? "content" : "a")).map(
    (link) => resolve(navPath, link.getAttribute(legacy ? "src" : "href")!).path,
  );
  require(spinePaths.every((path) => navTargets.includes(path)), "Navigation omits a spine item");
  for (const path of Object.keys(zip.files))
    require(path === "mimetype" ||
      path === "META-INF/container.xml" ||
      path === opfPath ||
      resources.has(path), `Unmanifested ZIP resource: ${path}`);
}
