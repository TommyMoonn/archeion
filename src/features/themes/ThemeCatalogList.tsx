import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { entryKey } from "./useThemeManagerController";
import { ThemeShellGraphic } from "./ThemeShellGraphic";
import { useThemePreview } from "./useThemePreview";

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
          return (
            <ThemeCatalogRow
              active={key === activeThemeKey}
              busy={busy}
              entry={entry}
              key={key}
              onSelect={onSelect}
              selected={key === selectedKey}
            />
          );
        })}
      </div>
    </nav>
  );
}

function ThemeCatalogRow({
  active,
  busy,
  entry,
  onSelect,
  selected,
}: Readonly<{
  active: boolean;
  busy: boolean;
  entry: ThemeCatalogEntry;
  onSelect: (key: string) => void;
  selected: boolean;
}>) {
  const theme = useThemePreview(entry);
  const name = entry.name ?? entry.id;
  const status = !entry.applicable ? "Needs attention" : active ? "Selected" : null;
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className="theme-catalog-list__item"
      disabled={busy}
      onClick={() => onSelect(entryKey(entry))}
      type="button"
    >
      <span className="theme-catalog-list__item-name" title={name}>
        {name}
      </span>
      {status ? <small data-invalid={!entry.applicable || undefined}>{status}</small> : null}
      {theme ? <ThemeShellGraphic compact theme={theme} /> : null}
    </button>
  );
}
