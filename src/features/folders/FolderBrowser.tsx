import { Folder as FolderIcon, MagnifyingGlass } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { EmptyState } from "../../components/EmptyState";
import { Input } from "../../components/Input";
import type { Folder } from "../../types/folder";

type FolderBrowserProps = {
  bookCounts: Map<string, number>;
  folders: Folder[];
  onOpen: (folder: Folder) => void;
};

export function FolderBrowser({
  bookCounts,
  folders,
  onOpen,
}: FolderBrowserProps) {
  const [query, setQuery] = useState("");
  const visibleFolders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return folders;
    }
    return folders.filter((folder) =>
      [folder.name, folder.relativePath].some((value) =>
        value?.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [folders, query]);

  return (
    <section className="folder-browser">
      <div className="folder-browser__toolbar">
        <div>
          <p className="eyebrow">Library folder</p>
          <h2>Folders</h2>
        </div>
        <Input
          icon={<MagnifyingGlass aria-hidden="true" size={17} />}
          label="Search folders"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search folders"
          type="search"
          value={query}
        />
      </div>
      {visibleFolders.length === 0 ? (
        <EmptyState
          description={
            query ? "Try another folder name." : "No folders found."
          }
          icon={<FolderIcon size={40} weight="thin" />}
          title={query ? "No folders found" : "No folders"}
        />
      ) : (
        <div className="folder-browser__list">
          {visibleFolders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => onOpen(folder)}
              type="button"
            >
              <FolderIcon aria-hidden="true" size={19} />
              <span>
                <strong>{folder.name}</strong>
                <small>{folder.relativePath ?? folder.name}</small>
              </span>
              <span>{bookCounts.get(folder.id) ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
