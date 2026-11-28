import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { cn } from "../../utils/cn";
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
    <nav
      aria-busy={busy || undefined}
      aria-label="Themes"
      className="grid h-full min-h-0 min-w-0 grid-rows-1 overflow-hidden border-0 border-e border-solid border-line-subtle bg-canvas theme-manager-stacked:border-e-0 theme-manager-stacked:border-b"
    >
      <div
        className="grid auto-rows-max content-start gap-theme-catalog-gap overflow-y-auto overscroll-contain px-control-gap py-theme-catalog-block scrollbar-gutter-stable"
        data-theme-catalog-scroll
      >
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
    <Button
      aria-current={selected ? "true" : undefined}
      className="grid min-h-theme-catalog-row w-full cursor-pointer grid-cols-theme-catalog-row items-center gap-control-gap rounded-control border-0 bg-transparent px-control-gap py-theme-catalog-block text-start text-text control-hover:bg-surface focus-visible:bg-surface aria-[current=true]:bg-surface-raised disabled:cursor-default disabled:opacity-theme-catalog-disabled"
      disabled={busy}
      onClick={() => onSelect(entryKey(entry))}
      size={null}
      type="button"
      variant={null}
    >
      <span
        className="truncate text-body-only leading-theme-copy font-medium text-text-strong"
        title={name}
      >
        {name}
      </span>
      {status ? (
        <Badge
          className={cn("leading-theme-catalog-status", !entry.applicable && "text-error-strong")}
          data-invalid={!entry.applicable || undefined}
          variant="plain"
        >
          {status}
        </Badge>
      ) : null}
      {theme ? <ThemeShellGraphic compact theme={theme} /> : null}
    </Button>
  );
}
