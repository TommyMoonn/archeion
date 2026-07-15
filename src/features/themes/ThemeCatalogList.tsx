import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { entryKey } from "./useThemeManagerController";

type ThemeCatalogListProps = Readonly<{
  activeThemeKey: string | null;
  busy: boolean;
  entries: readonly ThemeCatalogEntry[];
  onSelect: (key: string) => void;
  selectedKey: string;
}>;

export function ThemeCatalogList({
  activeThemeKey,
  busy,
  entries,
  onSelect,
  selectedKey,
}: ThemeCatalogListProps) {
  return (
    <nav aria-label="Application themes" className="theme-catalog-list">
      <div className="theme-catalog-list__items">
        {entries.map((entry) => {
          const key = entryKey(entry);
          const active = key === activeThemeKey;
          return (
            <button
              aria-current={key === selectedKey ? "true" : undefined}
              className="theme-catalog-list__item"
              disabled={busy}
              key={key}
              onClick={() => onSelect(key)}
              type="button"
            >
              <span>{entry.name ?? entry.id}</span>
              <small data-invalid={!entry.applicable || undefined}>
                {!entry.applicable ? "Needs attention" : active ? "Selected" : ""}
              </small>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
