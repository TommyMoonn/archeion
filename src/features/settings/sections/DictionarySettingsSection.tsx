import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefCallback } from "react";

import { Button } from "../../../components/Button";
import { Dialog } from "../../../components/Dialog";
import { IconButton } from "../../../components/IconButton";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type { DictionaryCatalogEntry, InstalledDictionary } from "../../../types/dictionary";
import { formatDictionaryLanguagePair, formatFileSize } from "../../../utils/formatters";
import { focusElementIfUsable } from "../../../utils/focusRestoration";
import { useDictionarySettings, type DictionarySettingsController } from "../useDictionarySettings";

type DictionaryView = "available" | "installed";

const EMPTY_DICTIONARIES: InstalledDictionary[] = [];

function catalogActionLabel(
  entry: DictionaryCatalogEntry,
  controller: DictionarySettingsController,
) {
  const operation = controller.catalogOperation;
  if (operation?.catalogId !== entry.id) return "Download";
  if (operation.phase === "installing") return "Installing";
  if (operation.phase === "downloading") return "Downloading";
  return operation.stagingToken ? "Retry installation" : "Retry download";
}

function AvailableDictionaryRow({
  controller,
  entry,
  installed,
}: {
  controller: DictionarySettingsController;
  entry: DictionaryCatalogEntry;
  installed: boolean;
}) {
  const operation =
    controller.catalogOperation?.catalogId === entry.id ? controller.catalogOperation : null;
  const busy = operation?.phase === "downloading" || operation?.phase === "installing";
  const anotherOperationActive = Boolean(
    controller.catalogOperation && controller.catalogOperation.catalogId !== entry.id,
  );

  return (
    <article className="dictionary-settings-card" data-catalog-id={entry.id}>
      <div className="dictionary-settings-card__main">
        <div className="dictionary-settings-card__heading">
          <h4>{entry.name}</h4>
          {installed ? <span className="dictionary-settings-card__status">Installed</span> : null}
        </div>
        <p>{entry.description}</p>
        <dl className="dictionary-settings-card__facts">
          <div>
            <dt>Language</dt>
            <dd>{formatDictionaryLanguagePair(entry.sourceLanguage, entry.targetLanguage)}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{entry.sourceAttribution}</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>{entry.licenseName}</dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>{formatFileSize(entry.compressedSizeBytes)}</dd>
          </div>
        </dl>
        {operation ? (
          <div className="dictionary-settings-card__operation" aria-live="polite">
            {operation.phase === "downloading" ? (
              <>
                <progress
                  aria-label={`Downloading ${entry.name}`}
                  max={operation.totalBytes || entry.compressedSizeBytes}
                  value={operation.receivedBytes}
                />
                <span>
                  {formatFileSize(operation.receivedBytes)} of{" "}
                  {formatFileSize(operation.totalBytes || entry.compressedSizeBytes)}
                </span>
              </>
            ) : null}
            {operation.phase === "installing" ? <span>Installing verified package…</span> : null}
            {operation.error ? (
              <p className="dictionary-settings-card__error" role="alert">
                {operation.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="dictionary-settings-card__actions">
        {operation?.phase === "downloading" ? (
          <Button
            onClick={() => void controller.cancelDownload()}
            size="compact"
            variant="secondary"
          >
            Cancel
          </Button>
        ) : (
          <Button
            busy={busy}
            disabled={installed || busy || anotherOperationActive}
            disabledReason={installed ? "This dictionary is already installed" : undefined}
            icon={<Download aria-hidden="true" />}
            onClick={() => void controller.installCatalog(entry.id)}
            size="compact"
          >
            {catalogActionLabel(entry, controller)}
          </Button>
        )}
      </div>
    </article>
  );
}

function InstalledDictionaryRow({
  controller,
  dictionary,
  index,
  onRequestRemove,
  removeButtonRef,
  total,
}: {
  controller: DictionarySettingsController;
  dictionary: InstalledDictionary;
  index: number;
  onRequestRemove: (dictionary: InstalledDictionary, trigger: HTMLButtonElement) => void;
  removeButtonRef: RefCallback<HTMLButtonElement>;
  total: number;
}) {
  const unavailable = dictionary.indexState === "unavailable";
  const catalogAvailable = Boolean(
    dictionary.catalogId &&
    controller.catalog?.entries.some((entry) => entry.id === dictionary.catalogId),
  );
  const recoveryOperation =
    dictionary.catalogId && controller.catalogOperation?.catalogId === dictionary.catalogId
      ? controller.catalogOperation
      : null;
  const busy = Boolean(
    controller.managementOperation ||
    controller.recovering ||
    controller.importing ||
    recoveryOperation?.phase === "downloading" ||
    recoveryOperation?.phase === "installing",
  );
  const rowError =
    controller.managementError?.dictionaryId === dictionary.id
      ? controller.managementError.message
      : null;

  return (
    <article className="dictionary-settings-card" data-dictionary-id={dictionary.id}>
      <div className="dictionary-settings-card__main">
        <div className="dictionary-settings-card__heading">
          <h4>{dictionary.displayName}</h4>
          <span className="dictionary-settings-card__status">
            {dictionary.indexState === "ready"
              ? "Ready"
              : unavailable
                ? "Unavailable"
                : "Index required"}
          </span>
        </div>
        <p>{dictionary.sourceAttribution}</p>
        <dl className="dictionary-settings-card__facts">
          <div>
            <dt>Language</dt>
            <dd>
              {formatDictionaryLanguagePair(dictionary.sourceLanguage, dictionary.targetLanguage)}
            </dd>
          </div>
          <div>
            <dt>Entries</dt>
            <dd>{dictionary.entryCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Installed size</dt>
            <dd>{formatFileSize(dictionary.installedSizeBytes)}</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>{dictionary.licenseName}</dd>
          </div>
        </dl>
        {unavailable ? (
          <p className="dictionary-settings-card__error">
            {dictionary.sourceKind === "catalog"
              ? catalogAvailable
                ? "Installed files are missing or invalid. Download this dictionary again to restore it."
                : "Installed files are missing or invalid. Refresh the catalog to check for a replacement, or remove this dictionary."
              : "Installed files are missing or invalid. Import a replacement, then remove this unavailable copy."}
          </p>
        ) : null}
        {rowError ? (
          <p className="dictionary-settings-card__error" role="alert">
            {rowError}
          </p>
        ) : null}
      </div>
      <div className="dictionary-settings-card__actions dictionary-settings-card__actions--installed">
        <Toggle
          checked={dictionary.enabled}
          disabled={busy || unavailable}
          label={`${dictionary.enabled ? "Disable" : "Enable"} ${dictionary.displayName}`}
          onChange={(enabled) => void controller.setEnabled(dictionary.id, enabled)}
          size="standard"
        />
        <IconButton
          disabled={busy || index === 0}
          label={`Move ${dictionary.displayName} earlier`}
          onClick={() => void controller.move(dictionary.id, -1)}
          size="compact"
          tooltip="Move earlier"
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          disabled={busy || index === total - 1}
          label={`Move ${dictionary.displayName} later`}
          onClick={() => void controller.move(dictionary.id, 1)}
          size="compact"
          tooltip="Move later"
        >
          <ArrowDown />
        </IconButton>
        {dictionary.indexState === "rebuild-required" ? (
          <Button
            disabled={busy}
            icon={<RotateCcw aria-hidden="true" />}
            onClick={() => void controller.rebuildIndex(dictionary.id)}
            size="compact"
            variant="secondary"
          >
            Rebuild index
          </Button>
        ) : null}
        {unavailable && dictionary.sourceKind === "catalog" && catalogAvailable ? (
          <Button
            busy={Boolean(
              recoveryOperation?.phase === "downloading" ||
              recoveryOperation?.phase === "installing",
            )}
            disabled={busy}
            icon={<Download aria-hidden="true" />}
            onClick={() => {
              if (dictionary.catalogId) void controller.installCatalog(dictionary.catalogId);
            }}
            size="compact"
            variant="secondary"
          >
            Download again
          </Button>
        ) : null}
        {unavailable && dictionary.sourceKind === "manual-import" ? (
          <Button
            busy={controller.importing}
            disabled={busy}
            icon={<FilePlus2 aria-hidden="true" />}
            onClick={() => void controller.importDictionary()}
            size="compact"
            variant="secondary"
          >
            Import replacement
          </Button>
        ) : null}
        <IconButton
          disabled={busy}
          label={`Remove ${dictionary.displayName}`}
          onClick={(event) => onRequestRemove(dictionary, event.currentTarget)}
          ref={removeButtonRef}
          size="compact"
          tooltip="Remove"
        >
          <Trash2 />
        </IconButton>
      </div>
    </article>
  );
}

export function DictionarySettingsView({
  controller,
}: {
  controller: DictionarySettingsController;
}) {
  const [view, setView] = useState<DictionaryView>("available");
  const [removing, setRemoving] = useState<InstalledDictionary | null>(null);
  const [removeTrigger, setRemoveTrigger] = useState<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const successfulRemovalFocusRef = useRef<readonly string[] | null>(null);
  const installedCatalogIds = new Set(
    controller.registry?.dictionaries.flatMap((dictionary) =>
      dictionary.catalogId && dictionary.indexState !== "unavailable" ? [dictionary.catalogId] : [],
    ) ?? [],
  );
  const dictionaries = controller.registry?.dictionaries ?? EMPTY_DICTIONARIES;

  useLayoutEffect(() => {
    const neighboringDictionaryIds = successfulRemovalFocusRef.current;
    if (removing || !neighboringDictionaryIds) return;

    successfulRemovalFocusRef.current = null;
    const neighboringRemoveButton = neighboringDictionaryIds
      .map((dictionaryId) => removeButtonRefs.current.get(dictionaryId))
      .find((element) => element?.isConnected);
    const installedViewSelector = sectionRef.current?.querySelector<HTMLElement>(
      '.dictionary-settings__tabs [role="radio"][aria-checked="true"]',
    );
    focusElementIfUsable(neighboringRemoveButton ?? installedViewSelector);
  }, [dictionaries, removing]);

  async function confirmRemoval() {
    if (!removing) return;
    const removalIndex = dictionaries.findIndex((dictionary) => dictionary.id === removing.id);
    const neighboringDictionaryIds = [
      dictionaries[removalIndex + 1]?.id,
      dictionaries[removalIndex - 1]?.id,
    ].filter((dictionaryId): dictionaryId is string => Boolean(dictionaryId));
    const removed = await controller.removeDictionary(removing.id);
    if (removed) {
      successfulRemovalFocusRef.current = neighboringDictionaryIds;
      setRemoving(null);
    }
  }

  return (
    <section className="settings-section dictionary-settings" ref={sectionRef}>
      <header className="dictionary-settings__header">
        <div>
          <h2>Dictionaries</h2>
          <p>Install and manage dictionaries used for local lookup.</p>
        </div>
        <div className="dictionary-settings__header-actions">
          {controller.refreshing ? (
            <Button
              onClick={() => void controller.cancelCatalogRefresh()}
              size="compact"
              variant="secondary"
            >
              Cancel refresh
            </Button>
          ) : (
            <Button
              icon={<RefreshCw aria-hidden="true" />}
              onClick={() => void controller.refreshCatalog()}
              size="compact"
              variant="secondary"
            >
              Refresh
            </Button>
          )}
          <Button
            busy={controller.importing}
            disabled={controller.importing}
            icon={<FilePlus2 aria-hidden="true" />}
            onClick={() => void controller.importDictionary()}
            size="compact"
            variant="secondary"
          >
            Import dictionary
          </Button>
        </div>
      </header>

      <SegmentedControl<DictionaryView>
        className="dictionary-settings__tabs"
        label="Dictionary views"
        onChange={setView}
        options={[
          { label: "Available", value: "available" },
          { label: `Installed (${dictionaries.length})`, value: "installed" },
        ]}
        value={view}
      />

      {controller.importError ? (
        <p className="dictionary-settings__error" role="alert">
          {controller.importError}
        </p>
      ) : null}

      {view === "available" ? (
        <div
          aria-label="Available dictionaries"
          className="dictionary-settings__list"
          role="region"
        >
          {controller.catalogError ? (
            <div className="dictionary-settings__notice" role="alert">
              <p>{controller.catalogError}</p>
              <Button
                onClick={() => void controller.refreshCatalog()}
                size="compact"
                variant="secondary"
              >
                Try again
              </Button>
            </div>
          ) : null}
          {controller.catalogState === "loading" ? <p>Loading available dictionaries…</p> : null}
          {controller.catalogState === "ready" &&
          (controller.catalog?.entries.length ?? 0) === 0 ? (
            <div className="dictionary-settings__notice">
              <p>No catalog has been loaded yet.</p>
              <Button onClick={() => void controller.refreshCatalog()} size="compact">
                Refresh catalog
              </Button>
            </div>
          ) : null}
          {controller.catalog?.cacheWarning ? (
            <p className="dictionary-settings__warning">{controller.catalog.cacheWarning}</p>
          ) : null}
          {controller.catalog?.entries.map((entry) => (
            <AvailableDictionaryRow
              controller={controller}
              entry={entry}
              installed={installedCatalogIds.has(entry.id)}
              key={entry.id}
            />
          ))}
        </div>
      ) : (
        <div
          aria-label="Installed dictionaries"
          className="dictionary-settings__list"
          role="region"
        >
          {controller.registryState === "loading" ? <p>Loading installed dictionaries…</p> : null}
          {controller.registryError ? (
            <p className="dictionary-settings__error" role="alert">
              {controller.registryError}
            </p>
          ) : null}
          {controller.registry?.status === "recovery-required" ? (
            <div className="dictionary-settings__notice" role="alert">
              <p>
                {controller.registry.recovery?.message ?? "Dictionary storage requires recovery."}
              </p>
              <Button
                busy={controller.recovering}
                disabled={controller.recovering}
                onClick={() => void controller.recoverResources()}
                size="compact"
                variant="secondary"
              >
                Try recovery
              </Button>
            </div>
          ) : null}
          {controller.registryState === "ready" &&
          controller.registry?.status === "ready" &&
          dictionaries.length === 0 ? (
            <p className="dictionary-settings__empty">No dictionaries are installed.</p>
          ) : null}
          {dictionaries.map((dictionary, index) => (
            <InstalledDictionaryRow
              controller={controller}
              dictionary={dictionary}
              index={index}
              key={dictionary.id}
              onRequestRemove={(selected, trigger) => {
                successfulRemovalFocusRef.current = null;
                setRemoveTrigger(trigger);
                setRemoving(selected);
              }}
              removeButtonRef={(element) => {
                if (element) removeButtonRefs.current.set(dictionary.id, element);
                else removeButtonRefs.current.delete(dictionary.id);
              }}
              total={dictionaries.length}
            />
          ))}
        </div>
      )}

      {removing ? (
        <Dialog
          description="This permanently deletes Archeion’s installed copy. Your original import files are not changed."
          footer={
            <>
              <Button
                disabled={controller.managementOperation?.action === "remove"}
                onClick={() => setRemoving(null)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                busy={controller.managementOperation?.action === "remove"}
                disabled={controller.managementOperation?.action === "remove"}
                onClick={() => void confirmRemoval()}
                variant="danger"
              >
                Remove dictionary
              </Button>
            </>
          }
          onClose={() => setRemoving(null)}
          returnFocusTo={removeTrigger}
          title={`Remove “${removing.displayName}”?`}
        />
      ) : null}
    </section>
  );
}

export function DictionarySettingsSection() {
  const controller = useDictionarySettings();
  return <DictionarySettingsView controller={controller} />;
}
