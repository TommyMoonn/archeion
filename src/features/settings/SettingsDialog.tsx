import { invoke, isTauri } from "@tauri-apps/api/core";
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
import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { appPreferencesStore, useAppPreferences } from "../../stores/appPreferencesStore";
import { vaultStore } from "../../stores/vaultStore";
import {
  defaultReaderSettings,
  type ReaderSettings,
} from "../../types/reader";
import { useVault } from "../vault/useVault";

type CoverCacheStatus = {
  fileCount: number;
  totalBytes: number;
};

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
    if (!isTauri()) return;
    void invoke<CoverCacheStatus>("cover_cache_status")
      .then(setCache)
      .catch(() => setCache(null));
  }, []);

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
    if (changed) setStatus("Library folder changed.");
  }

  async function revealMetadata() {
    try {
      await invoke("reveal_archeion_folder");
    } catch {
      setStatus("The metadata folder could not be opened.");
    }
  }

  async function clearCache() {
    try {
      setCache(await invoke<CoverCacheStatus>("clear_cover_cache"));
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
          <div className="settings-row">
            <div>
              <strong>Library folder</strong>
              <code>{vault.status === "ready" ? vault.path : "Browser storage"}</code>
            </div>
            {storage.source === "vault" ? (
              <Button
                icon={<FolderOpen aria-hidden="true" size={17} />}
                onClick={() => setChangeLibraryOpen(true)}
                variant="secondary"
              >
                Change
              </Button>
            ) : null}
          </div>
        </section>

        <section
          hidden={activeSection !== "Library"}
          id="settings-library"
          className="settings-section"
        >
          <header>
            <h2>Library management</h2>
          </header>
          {storage.source === "vault" ? (
            <>
              <div className="settings-row">
                <div>
                  <strong>Library scan</strong>
                  <span>Find new, moved, or missing EPUB files.</span>
                </div>
                <Button
                  icon={<ArrowsClockwise aria-hidden="true" size={17} />}
                  onClick={() => setRescanOpen(true)}
                  variant="secondary"
                >
                  Rescan
                </Button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Archeion metadata</strong>
                  <span>Open the sidecar metadata folder.</span>
                </div>
                <Button onClick={() => void revealMetadata()} variant="secondary">
                  Reveal in folder
                </Button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>Cover cache</strong>
                  <span>
                    {cache
                      ? `${cache.fileCount} covers, ${formatBytes(cache.totalBytes)}`
                      : "Cache status unavailable"}
                  </span>
                </div>
                <Button
                  icon={<Broom aria-hidden="true" size={17} />}
                  onClick={() => setClearCacheOpen(true)}
                  variant="secondary"
                >
                  Clear
                </Button>
              </div>
            </>
          ) : null}
        </section>

        <section
          hidden={activeSection !== "Reader"}
          id="settings-reader"
          className="settings-section"
        >
          <header><h2>Reader</h2></header>
          <label className="settings-row">
            <span><strong>Typeface</strong></span>
            <select
              value={reader.fontFamily}
              onChange={(event) => updateReader({ fontFamily: event.currentTarget.value })}
            >
              <option value="serif">Book serif</option>
              <option value="sans">Clean sans</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="settings-row">
            <span><strong>Text size</strong><small>{reader.fontSize}px</small></span>
            <input
              type="range"
              min="14"
              max="28"
              value={reader.fontSize}
              onChange={(event) => updateReader({ fontSize: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="settings-row">
            <span><strong>Line height</strong><small>{reader.lineHeight.toFixed(1)}</small></span>
            <input
              type="range"
              min="1.4"
              max="2"
              step="0.1"
              value={reader.lineHeight}
              onChange={(event) => updateReader({ lineHeight: Number(event.currentTarget.value) })}
            />
          </label>
          <label className="settings-row">
            <span><strong>Page margin</strong><small>{reader.margin}px</small></span>
            <input
              type="range"
              min="24"
              max="72"
              step="8"
              value={reader.margin}
              onChange={(event) => updateReader({ margin: Number(event.currentTarget.value) })}
            />
          </label>
          <fieldset className="settings-row">
            <legend>Reader theme</legend>
            <div className="settings-segments">
              {(["light", "sepia", "dark"] as const).map((theme) => (
                <button
                  aria-pressed={reader.theme === theme}
                  key={theme}
                  onClick={() => updateReader({ theme })}
                  type="button"
                >
                  {theme}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="settings-row">
            <legend>Flow</legend>
            <div className="settings-segments">
              <button
                aria-pressed={reader.flowMode === "paginated"}
                onClick={() => updateReader({ flowMode: "paginated" })}
                type="button"
              >
                Paginated
              </button>
              <button
                aria-pressed={reader.flowMode === "scrolled"}
                onClick={() => updateReader({ flowMode: "scrolled" })}
                type="button"
              >
                Scroll
              </button>
            </div>
          </fieldset>
        </section>

        <section
          hidden={activeSection !== "Appearance"}
          id="settings-appearance"
          className="settings-section"
        >
          <header><h2>Appearance</h2></header>
          <fieldset className="settings-row">
            <legend>Density</legend>
            <div className="settings-segments">
              {(["comfortable", "compact"] as const).map((density) => (
                <button
                  aria-pressed={preferences.density === density}
                  key={density}
                  onClick={() => appPreferencesStore.update({ density })}
                  type="button"
                >
                  {density}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="settings-row">
            <legend>Book card size</legend>
            <div className="settings-segments">
              {(["small", "medium", "large"] as const).map((bookCardSize) => (
                <button
                  aria-pressed={preferences.bookCardSize === bookCardSize}
                  key={bookCardSize}
                  onClick={() => appPreferencesStore.update({ bookCardSize })}
                  type="button"
                >
                  {bookCardSize}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="settings-row">
            <span><strong>Continue Reading</strong><small>Show on the Library page</small></span>
            <input
              checked={preferences.showContinueReading}
              onChange={(event) =>
                appPreferencesStore.update({ showContinueReading: event.currentTarget.checked })
              }
              type="checkbox"
            />
          </label>
        </section>

        <section
          hidden={activeSection !== "Window"}
          id="settings-window"
          className="settings-section"
        >
          <header><h2>Window</h2></header>
          <fieldset className="settings-row">
            <legend>Frame style</legend>
            <div className="settings-segments">
              {(["hidden", "archeion", "native"] as const).map((windowFrameStyle) => (
                <button
                  aria-pressed={preferences.windowFrameStyle === windowFrameStyle}
                  key={windowFrameStyle}
                  onClick={() => appPreferencesStore.update({ windowFrameStyle })}
                  type="button"
                >
                  {windowFrameStyle}
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        {status ? <p className="settings-status" role="status">{status}</p> : null}
        </main>

        {clearCacheOpen ? (
          <Dialog
            title="Clear cover cache?"
            description="Covers will be extracted again when needed."
            onClose={() => setClearCacheOpen(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setClearCacheOpen(false)}>Cancel</Button>
                <Button variant="danger" onClick={() => void clearCache()}>Clear cache</Button>
              </>
            }
          />
        ) : null}
        {changeLibraryOpen ? (
          <Dialog
            title="Change library folder?"
            description="You’ll switch to another local folder. The current folder and its metadata will remain unchanged."
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
                  Choose folder
                </Button>
              </>
            }
          />
        ) : null}
        {rescanOpen ? (
          <Dialog
            title="Rescan library?"
            description="This refreshes book and missing-file records. EPUB files are not changed."
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
