import type { Book as EpubBook } from "epubjs";
import EpubNavigation from "epubjs/src/navigation.js";

export type ReaderPageReferenceSource = {
  href: string;
  id?: string;
  label: string;
};

export type ReaderNavigationSource = {
  navigation: unknown;
  pageReferences: readonly ReaderPageReferenceSource[];
};

type EpubNavigationSourceBook = EpubBook & {
  navigation?: unknown;
  packaging?: {
    navPath?: unknown;
    ncxPath?: unknown;
  };
};

export async function loadReaderNavigationSource(book: EpubBook): Promise<ReaderNavigationSource> {
  const adaptedBook = book as EpubNavigationSourceBook;
  const navigationPath = navigationSourcePath(adaptedBook);

  if (!navigationPath || typeof adaptedBook.load !== "function") {
    return {
      navigation: adaptedBook.navigation,
      pageReferences: [],
    };
  }

  try {
    const document = asDocument(await adaptedBook.load(navigationPath));
    if (!document) {
      return {
        navigation: adaptedBook.navigation,
        pageReferences: [],
      };
    }

    return {
      navigation: adaptedBook.navigation ?? parseEpubNavigation(document),
      pageReferences: parsePublicationPageReferences(document),
    };
  } catch {
    return {
      navigation: adaptedBook.navigation,
      pageReferences: [],
    };
  }
}

function navigationSourcePath(book: EpubNavigationSourceBook): string | undefined {
  return nonEmptyString(book.packaging?.navPath) ?? nonEmptyString(book.packaging?.ncxPath);
}

function parseEpubNavigation(document: Document): unknown {
  try {
    return new EpubNavigation(document as XMLDocument);
  } catch {
    return undefined;
  }
}

function parsePublicationPageReferences(document: Document): ReaderPageReferenceSource[] {
  if (hasElement(document, "html")) {
    return parseNavigationDocumentPageReferences(document);
  }

  if (hasElement(document, "ncx")) {
    return parseNcxPageReferences(document);
  }

  return [];
}

function parseNavigationDocumentPageReferences(document: Document): ReaderPageReferenceSource[] {
  const pageList = elementsByLocalName(document, "nav").find((element) =>
    epubTypeTokens(element).includes("page-list"),
  );

  if (!pageList) {
    return [];
  }

  const entries: ReaderPageReferenceSource[] = [];

  for (const item of elementsByLocalName(pageList, "li")) {
    const link = firstDirectChildByLocalName(item, "a");
    const href = nonEmptyString(link?.getAttribute("href"));
    const label = link?.textContent;

    if (!link || !href || typeof label !== "string") {
      continue;
    }

    const id = nonEmptyString(item.getAttribute("id"));
    entries.push({ href, label, ...(id ? { id } : {}) });
  }

  return entries;
}

function parseNcxPageReferences(document: Document): ReaderPageReferenceSource[] {
  const pageList = elementsByLocalName(document, "pageList")[0];
  if (!pageList) {
    return [];
  }

  const entries: ReaderPageReferenceSource[] = [];

  for (const pageTarget of elementsByLocalName(pageList, "pageTarget")) {
    const navLabel = firstDirectChildByLocalName(pageTarget, "navLabel");
    const labelElement = navLabel ? firstDirectChildByLocalName(navLabel, "text") : undefined;
    const content = firstDirectChildByLocalName(pageTarget, "content");
    const href = nonEmptyString(content?.getAttribute("src"));
    const label = labelElement?.textContent;

    if (!href || typeof label !== "string") {
      continue;
    }

    const id = nonEmptyString(pageTarget.getAttribute("id"));
    entries.push({ href, label, ...(id ? { id } : {}) });
  }

  return entries;
}

function epubTypeTokens(element: Element): string[] {
  const value =
    element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ??
    element.getAttribute("epub:type");
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function hasElement(document: Document, localName: string): boolean {
  const root = document.documentElement;
  return root?.localName === localName || elementsByLocalName(document, localName).length > 0;
}

function elementsByLocalName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => element.localName === localName,
  );
}

function firstDirectChildByLocalName(element: Element, localName: string): Element | undefined {
  return Array.from(element.children).find((child) => child.localName === localName);
}

function asDocument(value: unknown): Document | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("documentElement" in value) ||
    !("getElementsByTagName" in value)
  ) {
    return undefined;
  }

  return value as Document;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}
