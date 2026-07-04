import type { Folder } from "../../types/folder";

export type FolderTreeNode = Folder & {
  children: FolderTreeNode[];
};

export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
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
