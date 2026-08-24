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
    <nav aria-label="Themes" className="theme-catalog-list">
      <div className="theme-catalog-list__items">
        {entries.map((entry) => {
          const key = entryKey(entry);
          const active = key === activeThemeKey;
          const name = entry.name ?? entry.id;
          const status = !entry.applicable ? "Needs attention" : active ? "Selected" : null;
          return (
            <button
              aria-current={key === selectedKey ? "true" : undefined}
              className="theme-catalog-list__item"
              disabled={busy}
              key={key}
              onClick={() => onSelect(key)}
              type="button"
            >
              <span className="theme-catalog-list__item-name" title={name}>
                {entry.name ?? entry.id}
              </span>
              {status ? (
                <small data-invalid={!entry.applicable || undefined}>{status}</small>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
