import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { entryKey } from "./useThemeManagerController";

type ThemeCatalogListProps = Readonly<{
  busy: boolean;
  entries: readonly ThemeCatalogEntry[];
  onSelect: (key: string) => void;
  selectedKey: string;
}>;

export function ThemeCatalogList({ busy, entries, onSelect, selectedKey }: ThemeCatalogListProps) {
  const builtIns = entries.filter((entry) => entry.origin === "builtin");
  const custom = entries.filter((entry) => entry.origin === "custom");

  return (
    <nav aria-label="Archive themes" className="theme-catalog-list">
      <ThemeCatalogGroup
        busy={busy}
        entries={builtIns}
        label="Built in"
        onSelect={onSelect}
        selectedKey={selectedKey}
      />
      <ThemeCatalogGroup
        busy={busy}
        empty="No custom themes"
        entries={custom}
        label="This archive"
        onSelect={onSelect}
        selectedKey={selectedKey}
      />
    </nav>
  );
}

function ThemeCatalogGroup({
  busy,
  empty,
  entries,
  label,
  onSelect,
  selectedKey,
}: ThemeCatalogListProps & Readonly<{ empty?: string; label: string }>) {
  return (
    <section className="theme-catalog-list__group">
      <h3>{label}</h3>
      {entries.length ? (
        <div className="theme-catalog-list__items">
          {entries.map((entry) => {
            const key = entryKey(entry);
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
                  {entry.origin === "builtin"
                    ? capabilityLabel(entry)
                    : entry.applicable
                      ? capabilityLabel(entry)
                      : "Needs attention"}
                </small>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="theme-catalog-list__empty">{empty}</p>
      )}
    </section>
  );
}

function capabilityLabel(entry: ThemeCatalogEntry): string {
  if (entry.capabilities.application && entry.capabilities.reader) return "App + reader";
  if (entry.capabilities.reader) return "Reader";
  return "Application";
}
