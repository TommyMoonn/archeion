import type { ReadonlyFolder } from "../../types/folder";

export type FolderTreeNode = ReadonlyFolder & {
  children: FolderTreeNode[];
};

const pathSeparatorPattern = /[/\\]+/;

export function buildFolderTree(folders: readonly ReadonlyFolder[]): FolderTreeNode[] {
  const collator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const nodes = new Map<string, FolderTreeNode>(
    folders.map((folder) => [folder.id, { ...folder, children: [] }]),
  );
  const roots: FolderTreeNode[] = [];

  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;

    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function sortNodes(items: FolderTreeNode[]) {
    items.sort((left, right) => collator.compare(left.name, right.name));
    items.forEach((item) => sortNodes(item.children));
  }

  sortNodes(roots);
  return roots;
}

export function getFolderDisplayPath(folder: ReadonlyFolder): string | undefined {
  const relativePath = folder.relativePath?.trim();
  if (!relativePath) {
    return undefined;
  }

  const normalizedName = folder.name.trim().toLocaleLowerCase();
  const normalizedPath = relativePath.toLocaleLowerCase();
  const pathParts = relativePath.split(pathSeparatorPattern).filter(Boolean);

  if (pathParts.length <= 1 && normalizedPath === normalizedName) {
    return undefined;
  }

  return relativePath;
}

export function formatFolderBookCount(count: number): string {
  return count === 1 ? "1 book" : `${count} books`;
}
