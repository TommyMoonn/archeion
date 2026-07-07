import {
  Archive,
  ArrowsClockwise,
  BookOpenText,
  Browsers,
  Broom,
  FolderOpen,
  Palette,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Toggle } from "../../components/Toggle";
import type { CoverCacheStatus } from "../../storage/LibraryStorage";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
} from "../../stores/appPreferencesStore";
import { vaultStore } from "../../stores/vaultStore";
import type {
  BookCardSize,
  InterfaceDensity,
  WindowFrameStyle,
} from "../../types/appSettings";
import {
  defaultReaderSettings,
  type ReaderProgressPlacement,
  type ReaderSettings,
  type ReaderTheme,
} from "../../types/reader";
import { useVault } from "../vault/useVault";

const sections = [
  "General",
  "Library",
  "Reader",
  "Appearance",
  "Window",
] as const;
type SettingsSection = (typeof sections)[number];

type SettingsDialogProps = {
  onClose: () => void;
};

type SettingsRowProps = {
  children: ReactNode;
  label: string;
  note?: ReactNode;
};

const typefaceOptions = [
  { label: "Book serif", value: "serif" },
  { label: "Clean sans", value: "sans" },
  { label: "System", value: "system" },
];

const themeOptions: Array<{ label: string; value: ReaderTheme }> = [
  { label: "Light", value: "light" },
  { label: "Sepia", value: "sepia" },
  { label: "Dark", value: "dark" },
];

const progressPlacementOptions: Array<{
  label: string;
  value: ReaderProgressPlacement;
}> = [
  { label: "Top", value: "top" },
  { label: "Side", value: "side" },
];

const densityOptions: Array<{ label: string; value: InterfaceDensity }> = [
  { label: "Comfortable", value: "comfortable" },
  { label: "Compact", value: "compact" },
];

const cardSizeOptions: Array<{ label: string; value: BookCardSize }> = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
];

const frameOptions: Array<{ label: string; value: WindowFrameStyle }> = [
  { label: "Hidden", value: "hidden" },
  { label: "Archeion", value: "archeion" },
  { label: "Native", value: "native" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SectionIcon({ section }: { section: SettingsSection }) {
  switch (section) {
    case "General":
      return <SlidersHorizontal aria-hidden="true" size={16} />;
    case "Library":
      return <Archive aria-hidden="true" size={16} />;
    case "Reader":
      return <BookOpenText aria-hidden="true" size={16} />;
    case "Appearance":
      return <Palette aria-hidden="true" size={16} />;
    case "Window":
      return <Browsers aria-hidden="true" size={16} />;
  }
}

function SettingsRow({ children, label, note }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__meta">
        <strong>{label}</strong>
        {note ? <span>{note}</span> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function SliderRow({
  label,
  max,
  min,
  onChange,
  step,
  suffix = "",
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <SettingsRow label={label} note={`${value}${suffix}`}>
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </SettingsRow>
  );
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const storage = useLibraryStorage();
  const vault = useVault();
  const preferences = useAppPreferences();
  const [reader, setReader] = useState<ReaderSettings>({
    ...defaultReaderSettings,
  });
  const [cache, setCache] = useState<CoverCacheStatus | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [changeLibraryOpen, setChangeLibraryOpen] = useState(false);
  const [rescanOpen, setRescanOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("General");

  function showSection(section: SettingsSection) {
    setActiveSection(section);
    contentRef.current?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  useEffect(() => {
    void storage
      .getReaderSettings()
      .then(setReader)
      .catch(() => setStatus("Reader settings could not be loaded."));
  }, [storage]);

  useEffect(() => {
    void storage
      .getCoverCacheStatus()
      .then(setCache)
      .catch(() => setCache(null));
  }, [storage]);

  function updateReader(changes: Partial<ReaderSettings>) {
    const next = { ...reader, ...changes };
    setReader(next);
    setStatus(null);
    void storage
      .saveReaderSettings(next)
      .catch(() => setStatus("Reader settings could not be saved."));
  }

  async function rescan() {
    setRescanOpen(false);
    setStatus("Rescanning library");
    try {
      await storage.rescan();
      setStatus("Library scan complete.");
    } catch {
      setStatus("The library could not be scanned.");
    }
  }

  async function changeLibrary() {
    setChangeLibraryOpen(false);
    const changed = await vaultStore.chooseVault();
    if (changed) setStatus("Archive changed.");
  }

  async function revealMetadata() {
    try {
      await storage.revealMetadataFolder();
    } catch {
      setStatus("The metadata folder could not be opened.");
    }
  }

  async function clearCache() {
    try {
      setCache(await storage.clearCoverCache());
      setStatus("Cover cache cleared.");
    } catch {
      setStatus("The cover cache could not be cleared.");
    } finally {
      setClearCacheOpen(false);
    }
  }

  return (
    <dialog
      aria-labelledby="settings-title"
      aria-modal="true"
      className="settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <div className="settings-window">
        <aside className="settings-sidebar">
          <div>
            <p>Archeion</p>
            <h1 id="settings-title">Settings</h1>
          </div>
          <nav aria-label="Settings sections">
            {sections.map((section) => (
              <button
                aria-current={activeSection === section ? "page" : undefined}
                key={section}
                onClick={() => showSection(section)}
                type="button"
              >
                <SectionIcon section={section} />
                {section}
              </button>
            ))}
          </nav>
        </aside>

        <IconButton
          autoFocus
          className="settings-close"
          label="Close settings"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </IconButton>

        <main className="settings-content" ref={contentRef}>
          <section
            hidden={activeSection !== "General"}
            id="settings-general"
            className="settings-section"
          >
            <header>
              <h2>General</h2>
            </header>
            <SettingsRow
              label="Archive folder"
              note={
                vault.status === "ready" ? (
                  <code>{vault.path}</code>
                ) : (
                  "No archive selected"
                )
              }
            >
              <Button
                icon={<FolderOpen aria-hidden="true" size={17} />}
                onClick={() => setChangeLibraryOpen(true)}
                variant="secondary"
              >
                Change
              </Button>
            </SettingsRow>
          </section>

          <section
            hidden={activeSection !== "Library"}
            id="settings-library"
            className="settings-section"
          >
            <header>
              <h2>Library</h2>
            </header>
            <SettingsRow
              label="Library scan"
              note="Find new, moved, or missing EPUB files."
            >
              <Button
                icon={<ArrowsClockwise aria-hidden="true" size={17} />}
                onClick={() => setRescanOpen(true)}
                variant="secondary"
              >
                Rescan
              </Button>
            </SettingsRow>
            <SettingsRow
              label="Archeion metadata"
              note="Open the sidecar metadata folder."
            >
              <Button onClick={() => void revealMetadata()} variant="secondary">
                Reveal
              </Button>
            </SettingsRow>
            <SettingsRow
              label="Cover cache"
              note={
                cache
                  ? `${cache.fileCount} covers, ${formatBytes(cache.totalBytes)}`
                  : "Cache status unavailable"
              }
            >
              <Button
                icon={<Broom aria-hidden="true" size={17} />}
                onClick={() => setClearCacheOpen(true)}
                variant="secondary"
              >
                Clear
              </Button>
            </SettingsRow>
          </section>

          <section
            hidden={activeSection !== "Reader"}
            id="settings-reader"
            className="settings-section"
          >
            <header>
              <h2>Reader</h2>
            </header>
            <SettingsRow label="Typeface">
              <AppSelect
                ariaLabel="Reader typeface"
                onChange={(fontFamily) => updateReader({ fontFamily })}
                options={typefaceOptions}
                value={reader.fontFamily}
              />
            </SettingsRow>
            <SliderRow
              label="Text size"
              max={28}
              min={14}
              onChange={(fontSize) => updateReader({ fontSize })}
              suffix="px"
              value={reader.fontSize}
            />
            <SliderRow
              label="Line height"
              max={2}
              min={1.4}
              onChange={(lineHeight) => updateReader({ lineHeight })}
              step={0.1}
              value={Number(reader.lineHeight.toFixed(1))}
            />
            <SliderRow
              label="Page margin"
              max={72}
              min={24}
              onChange={(margin) => updateReader({ margin })}
              step={8}
              suffix="px"
              value={reader.margin}
            />
            <SettingsRow label="Reader theme">
              <SegmentedControl
                label="Reader theme"
                onChange={(theme) => updateReader({ theme })}
                options={themeOptions}
                value={reader.theme}
              />
            </SettingsRow>
            <SettingsRow label="Progress bar">
              <SegmentedControl
                label="Reader progress bar placement"
                onChange={(progressPlacement) =>
                  updateReader({ progressPlacement })
                }
                options={progressPlacementOptions}
                value={reader.progressPlacement}
              />
            </SettingsRow>
          </section>

          <section
            hidden={activeSection !== "Appearance"}
            id="settings-appearance"
            className="settings-section"
          >
            <header>
              <h2>Appearance</h2>
            </header>
            <SettingsRow label="Density">
              <SegmentedControl
                label="Interface density"
                onChange={(density) => appPreferencesStore.update({ density })}
                options={densityOptions}
                value={preferences.density}
              />
            </SettingsRow>
            <SettingsRow label="Book card size">
              <AppSelect
                ariaLabel="Book card size"
                onChange={(bookCardSize) =>
                  appPreferencesStore.update({ bookCardSize })
                }
                options={cardSizeOptions}
                value={preferences.bookCardSize}
              />
            </SettingsRow>
            <SettingsRow
              label="Continue Reading"
              note="Show on the Library page."
            >
              <Toggle
                checked={preferences.showContinueReading}
                label="Show Continue Reading"
                onChange={(showContinueReading) =>
                  appPreferencesStore.update({ showContinueReading })
                }
              />
            </SettingsRow>
          </section>

          <section
            hidden={activeSection !== "Window"}
            id="settings-window"
            className="settings-section"
          >
            <header>
              <h2>Window</h2>
            </header>
            <SettingsRow label="Frame style">
              <AppSelect
                ariaLabel="Window frame style"
                onChange={(windowFrameStyle) =>
                  appPreferencesStore.update({ windowFrameStyle })
                }
                options={frameOptions}
                value={preferences.windowFrameStyle}
              />
            </SettingsRow>
          </section>

          {status ? (
            <p className="settings-status" role="status">
              {status}
            </p>
          ) : null}
        </main>

        {clearCacheOpen ? (
          <Dialog
            title="Clear cover cache?"
            description="Covers will be extracted again when needed."
            onClose={() => setClearCacheOpen(false)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setClearCacheOpen(false)}
                >
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void clearCache()}>
                  Clear cache
                </Button>
              </>
            }
          />
        ) : null}
        {changeLibraryOpen ? (
          <Dialog
            title="Open another archive?"
            description="The current archive and its metadata will remain unchanged."
            onClose={() => setChangeLibraryOpen(false)}
            footer={
              <>
                <Button
                  onClick={() => setChangeLibraryOpen(false)}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button autoFocus onClick={() => void changeLibrary()}>
                  Choose archive
                </Button>
              </>
            }
          />
        ) : null}
        {rescanOpen ? (
          <Dialog
            title="Rescan library?"
            description="EPUB files are not changed."
            onClose={() => setRescanOpen(false)}
            footer={
              <>
                <Button
                  onClick={() => setRescanOpen(false)}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button autoFocus onClick={() => void rescan()}>
                  Rescan library
                </Button>
              </>
            }
          />
        ) : null}
      </div>
    </dialog>
  );
}
