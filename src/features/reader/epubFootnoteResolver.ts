import type { Book as EpubBook } from "epubjs";

import {
  classifyEpubLink,
  epubSemanticsFromElement,
  findEpubFragmentTarget,
  isFootnoteTargetSemantics,
  resolveEpubLocalTarget,
  targetSemanticsForElement,
  type EpubContentAction,
  type EpubLocalTarget,
} from "./epubContentActions";
import { resolveEpubLocalDocument } from "./epubLocalDocumentResolver";

export type EpubFootnoteElementTag =
  | "b"
  | "blockquote"
  | "br"
  | "cite"
  | "code"
  | "em"
  | "i"
  | "li"
  | "ol"
  | "p"
  | "small"
  | "span"
  | "strong"
  | "sub"
  | "sup"
  | "ul";

export type EpubFootnoteNode =
  | Readonly<{ text: string; type: "text" }>
  | Readonly<{
      children: readonly EpubFootnoteNode[];
      tag: EpubFootnoteElementTag;
      type: "element";
    }>
  | Readonly<{
      action: Exclude<EpubContentAction, { kind: "unsupported" }>;
      children: readonly EpubFootnoteNode[];
      type: "link";
    }>
  | Readonly<{ alt: string; src: string; type: "image" }>;

export type ResolvedEpubFootnote = Readonly<{
  nodes: readonly EpubFootnoteNode[];
  release: () => void;
}>;

export type EpubFootnoteResolution =
  | Readonly<{ kind: "resolved"; value: ResolvedEpubFootnote }>
  | Readonly<{ kind: "not-footnote" }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "unsupported"; message: string }>;

export type ResolveEpubFootnoteInput = Readonly<{
  book: EpubBook;
  currentDocument: Readonly<{ document: Document; href: string }> | null;
  forceFootnote: boolean;
  signal?: AbortSignal;
  target: EpubLocalTarget;
}>;

const SAFE_ELEMENT_TAGS = new Set<EpubFootnoteElementTag>([
  "b",
  "blockquote",
  "br",
  "cite",
  "code",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "ul",
]);
const DROP_SUBTREE_TAGS = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "source",
  "style",
  "textarea",
  "track",
  "video",
]);
const SAFE_FOOTNOTE_IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "webp"]);
const MAX_FOOTNOTE_IMAGES = 4;
const MAX_FOOTNOTE_IMAGE_BYTES = 512 * 1024;
const MAX_FOOTNOTE_NODES = 600;
const MAX_FOOTNOTE_TEXT = 24_000;

export async function resolveEpubFootnote(
  input: ResolveEpubFootnoteInput,
): Promise<EpubFootnoteResolution> {
  if (!input.target.fragment) {
    return { kind: "unsupported", message: "This note has no usable destination." };
  }

  const documentResolution = await resolveEpubLocalDocument(
    input.book,
    input.target,
    input.currentDocument,
    input.signal,
  );
  if (documentResolution.kind !== "resolved") {
    return documentResolution.kind === "cancelled"
      ? documentResolution
      : { kind: "unsupported", message: "This note could not be loaded safely." };
  }

  const lease = documentResolution.value;
  const targetElement = lease.element;
  if (!targetElement) {
    lease.release();
    return { kind: "unsupported", message: "This note destination is missing." };
  }

  if (
    !input.forceFootnote &&
    !isFootnoteTargetSemantics(targetSemanticsForElement(targetElement))
  ) {
    lease.release();
    return { kind: "not-footnote" };
  }

  const sanitizer = new FootnoteSanitizer(input.book, input.target.documentHref, input.signal);
  try {
    const nodes = await sanitizer.sanitizeChildren(targetElement);
    if (input.signal?.aborted) {
      sanitizer.release();
      return { kind: "cancelled" };
    }
    if (nodes.length === 0) {
      sanitizer.release();
      return { kind: "unsupported", message: "This note has no supported content." };
    }
    return {
      kind: "resolved",
      value: {
        nodes,
        release: () => sanitizer.release(),
      },
    };
  } catch {
    sanitizer.release();
    return input.signal?.aborted
      ? { kind: "cancelled" }
      : { kind: "unsupported", message: "This note contains unsupported content." };
  } finally {
    lease.release();
  }
}

class FootnoteSanitizer {
  private imageCount = 0;
  private nodeCount = 0;
  private objectUrls: string[] = [];
  private released = false;
  private textLength = 0;

  constructor(
    private readonly book: EpubBook,
    private readonly documentHref: string,
    private readonly signal?: AbortSignal,
  ) {}

  async sanitizeChildren(parent: Element): Promise<EpubFootnoteNode[]> {
    const nodes: EpubFootnoteNode[] = [];
    for (const child of parent.childNodes) {
      nodes.push(...(await this.sanitizeNode(child)));
      if (this.limitReached()) break;
    }
    return trimBoundaryWhitespace(nodes);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  private async sanitizeNode(node: Node): Promise<EpubFootnoteNode[]> {
    if (this.signal?.aborted || this.limitReached()) return [];
    if (node.nodeType === Node.TEXT_NODE) {
      const available = MAX_FOOTNOTE_TEXT - this.textLength;
      const text = normalizeText(node.textContent ?? "").slice(0, available);
      if (!text) return [];
      this.textLength += text.length;
      this.nodeCount += 1;
      return [{ text, type: "text" }];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP_SUBTREE_TAGS.has(tag)) return [];
    if (tag === "img") {
      const image = await this.sanitizeImage(element);
      return image ? [image] : [];
    }
    if (tag === "a" || tag === "area") {
      return this.sanitizeLink(element);
    }

    const children = await this.sanitizeChildren(element);
    if (SAFE_ELEMENT_TAGS.has(tag as EpubFootnoteElementTag)) {
      this.nodeCount += 1;
      return [
        {
          children,
          tag: tag as EpubFootnoteElementTag,
          type: "element",
        },
      ];
    }
    return children;
  }

  private async sanitizeLink(element: Element): Promise<EpubFootnoteNode[]> {
    const children = await this.sanitizeChildren(element);
    const href = element.getAttribute("href")?.trim();
    if (!href || children.length === 0) return children;

    let action = classifyEpubLink({
      currentDocumentHref: this.documentHref,
      href,
      sourceSemantics: epubSemanticsFromElement(element),
    });
    if (
      action.kind !== "external" &&
      action.kind !== "unsupported" &&
      action.target.fragment &&
      action.target.documentHref === this.documentHref
    ) {
      const target = findEpubFragmentTarget(element.ownerDocument, action.target.fragment);
      action = classifyEpubLink({
        currentDocumentHref: this.documentHref,
        href,
        sourceSemantics: epubSemanticsFromElement(element),
        targetSemantics: targetSemanticsForElement(target),
      });
    }
    if (action.kind === "unsupported") return children;

    this.nodeCount += 1;
    return [{ action, children, type: "link" }];
  }

  private async sanitizeImage(element: Element): Promise<EpubFootnoteNode | null> {
    if (this.imageCount >= MAX_FOOTNOTE_IMAGES || this.signal?.aborted) return null;
    const src = element.getAttribute("src")?.trim();
    if (!src) return null;
    const target = resolveEpubLocalTarget(this.documentHref, src);
    if ("kind" in target || target.resourceKind !== "illustration") return null;
    const extension = target.documentHref
      .slice(target.documentHref.lastIndexOf(".") + 1)
      .toLowerCase();
    if (!SAFE_FOOTNOTE_IMAGE_EXTENSIONS.has(extension)) return null;

    const blob = await loadLocalImageBlob(this.book, target.documentHref);
    if (!blob || blob.size > MAX_FOOTNOTE_IMAGE_BYTES || this.signal?.aborted) return null;
    const objectUrl = URL.createObjectURL(blob);
    this.objectUrls.push(objectUrl);
    this.imageCount += 1;
    this.nodeCount += 1;
    return {
      alt: element.getAttribute("alt")?.trim() ?? "",
      src: objectUrl,
      type: "image",
    };
  }

  private limitReached(): boolean {
    return this.nodeCount >= MAX_FOOTNOTE_NODES || this.textLength >= MAX_FOOTNOTE_TEXT;
  }
}

async function loadLocalImageBlob(book: EpubBook, path: string): Promise<Blob | null> {
  try {
    if (book.archive?.getBlob) {
      return (await book.archive.getBlob(`/${path}`)) ?? null;
    }
    const loaded = await book.load(path);
    return loaded instanceof Blob ? loaded : null;
  } catch {
    return null;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ");
}

function trimBoundaryWhitespace(nodes: EpubFootnoteNode[]): EpubFootnoteNode[] {
  const result = [...nodes];
  const first = result[0];
  if (first?.type === "text") {
    const text = first.text.trimStart();
    if (text) result[0] = { text, type: "text" };
    else result.shift();
  }
  const last = result.at(-1);
  if (last?.type === "text") {
    const text = last.text.trimEnd();
    if (text) result[result.length - 1] = { text, type: "text" };
    else result.pop();
  }
  return result;
}
