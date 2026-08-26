import {
  ArrowDown,
  ArrowUp,
  Download,
  FilePlus2,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefCallback } from "react";

import { Button } from "../../../components/Button";
import { Dialog } from "../../../components/Dialog";
import { IconButton } from "../../../components/IconButton";
import { Input } from "../../../components/Input";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type { DictionaryCatalogEntry, InstalledDictionary } from "../../../types/dictionary";
import { formatDictionaryLanguagePair, formatFileSize } from "../../../utils/formatters";
import { focusElementIfUsable } from "../../../utils/focusRestoration";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import { useDictionarySettings, type DictionarySettingsController } from "../useDictionarySettings";

type DictionaryView = "all" | "installed" | "not-installed";

const EMPTY_DICTIONARIES: InstalledDictionary[] = [];

function dictionaryMetadataMatchesQuery(query: string, metadata: readonly string[]) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  return metadata.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

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

function CatalogDictionaryRow({
  controller,
  entry,
}: {
  controller: DictionarySettingsController;
  entry: DictionaryCatalogEntry;
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
        </div>
        <p className="dictionary-settings-card__source">
          <span>Source</span>
          {entry.sourceUrl ? (
            <a href={entry.sourceUrl} rel="noreferrer" target="_blank">
              {entry.sourceAttribution}
            </a>
          ) : (
            <span>{entry.sourceAttribution}</span>
          )}
        </p>
        <dl className="dictionary-settings-card__facts">
          <div>
            <dt>Language</dt>
            <dd>{formatDictionaryLanguagePair(entry.sourceLanguage, entry.targetLanguage)}</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>
              <a href={entry.licenseUrl} rel="noreferrer" target="_blank">
                {entry.licenseName}
              </a>
            </dd>
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
            disabled={busy || anotherOperationActive}
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
  const catalogEntry = dictionary.catalogId
    ? controller.catalog?.entries.find((entry) => entry.id === dictionary.catalogId)
    : undefined;
  const catalogAvailable = Boolean(catalogEntry);
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
        <p className="dictionary-settings-card__source">
          <span>Source</span>
          {catalogEntry?.sourceUrl ? (
            <a href={catalogEntry.sourceUrl} rel="noreferrer" target="_blank">
              {dictionary.sourceAttribution}
            </a>
          ) : (
            <span>{dictionary.sourceAttribution}</span>
          )}
        </p>
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
            <dd>
              {dictionary.licenseUrl ? (
                <a href={dictionary.licenseUrl} rel="noreferrer" target="_blank">
                  {dictionary.licenseName}
                </a>
              ) : (
                dictionary.licenseName
              )}
            </dd>
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
  const [view, setView] = useState<DictionaryView>("all");
  const [dictionaryQuery, setDictionaryQuery] = useState("");
  const [removing, setRemoving] = useState<InstalledDictionary | null>(null);
  const [removeTrigger, setRemoveTrigger] = useState<HTMLButtonElement | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const successfulRemovalFocusRef = useRef<readonly string[] | null>(null);
  const dictionaries = controller.registry?.dictionaries ?? EMPTY_DICTIONARIES;
  const catalogEntries = controller.catalog?.entries ?? [];
  const registeredCatalogIds = new Set(
    dictionaries.flatMap((dictionary) => (dictionary.catalogId ? [dictionary.catalogId] : [])),
  );
  const notInstalledCatalogEntries = catalogEntries.filter(
    (entry) => !registeredCatalogIds.has(entry.id),
  );
  const filteredDictionaries =
    view === "not-installed"
      ? []
      : dictionaries
          .map((dictionary, index) => ({ dictionary, index }))
          .filter(({ dictionary }) =>
            dictionaryMetadataMatchesQuery(dictionaryQuery, [
              dictionary.displayName,
              dictionary.sourceAttribution,
              formatDictionaryLanguagePair(dictionary.sourceLanguage, dictionary.targetLanguage),
            ]),
          );
  const filteredCatalogEntries =
    view === "installed"
      ? []
      : notInstalledCatalogEntries.filter((entry) =>
          dictionaryMetadataMatchesQuery(dictionaryQuery, [
            entry.name,
            entry.sourceAttribution,
            formatDictionaryLanguagePair(entry.sourceLanguage, entry.targetLanguage),
          ]),
        );
  const selectedViewHasData =
    view === "installed"
      ? dictionaries.length > 0
      : view === "not-installed"
        ? notInstalledCatalogEntries.length > 0
        : dictionaries.length > 0 || notInstalledCatalogEntries.length > 0;
  const hasQuery = dictionaryQuery.trim().length > 0;
  const queryHasNoMatches =
    hasQuery &&
    selectedViewHasData &&
    filteredDictionaries.length === 0 &&
    filteredCatalogEntries.length === 0;

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
      <SettingsSectionHeader
        actions={
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
              Import
            </Button>
          </div>
        }
        className="dictionary-settings__header"
        title="Dictionaries"
      />

      <div className="dictionary-settings__toolbar">
        <Input
          autoComplete="off"
          className="dictionary-settings__search"
          icon={<Search aria-hidden="true" />}
          label="Search dictionaries"
          onChange={(event) => setDictionaryQuery(event.currentTarget.value)}
          placeholder="Search dictionaries"
          size="standard"
          type="search"
          value={dictionaryQuery}
        />

        <SegmentedControl<DictionaryView>
          className="dictionary-settings__tabs"
          label="Dictionary views"
          onChange={setView}
          options={[
            { label: "All", value: "all" },
            {
              label: controller.registry ? `Installed (${dictionaries.length})` : "Installed",
              value: "installed",
            },
            { label: "Not installed", value: "not-installed" },
          ]}
          value={view}
        />
      </div>

      {controller.importError ? (
        <p className="dictionary-settings__error" role="alert">
          {controller.importError}
        </p>
      ) : null}

      <div
        aria-label={
          view === "all"
            ? "All dictionaries"
            : view === "installed"
              ? "Installed dictionaries"
              : "Not installed dictionaries"
        }
        className="dictionary-settings__list"
        role="region"
      >
        {view !== "installed" && controller.catalogError ? (
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
        {view !== "installed" && controller.catalogState === "loading" ? (
          <p>Loading available dictionaries…</p>
        ) : null}
        {view !== "installed" &&
        controller.catalogState === "ready" &&
        catalogEntries.length === 0 ? (
          <div className="dictionary-settings__notice">
            <p>No catalog has been loaded yet.</p>
            <Button onClick={() => void controller.refreshCatalog()} size="compact">
              Refresh catalog
            </Button>
          </div>
        ) : null}
        {view !== "installed" && controller.catalog?.cacheWarning ? (
          <p className="dictionary-settings__warning">{controller.catalog.cacheWarning}</p>
        ) : null}
        {view !== "not-installed" && controller.registryState === "loading" ? (
          <p>Loading installed dictionaries…</p>
        ) : null}
        {view !== "not-installed" && controller.registryError ? (
          <p className="dictionary-settings__error" role="alert">
            {controller.registryError}
          </p>
        ) : null}
        {view !== "not-installed" && controller.registry?.status === "recovery-required" ? (
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
        {view === "installed" &&
        controller.registryState === "ready" &&
        controller.registry?.status === "ready" &&
        dictionaries.length === 0 ? (
          <p className="dictionary-settings__empty">No dictionaries are installed.</p>
        ) : null}
        {view === "not-installed" &&
        controller.catalogState === "ready" &&
        catalogEntries.length > 0 &&
        notInstalledCatalogEntries.length === 0 ? (
          <p className="dictionary-settings__empty">All catalog dictionaries are installed.</p>
        ) : null}
        {queryHasNoMatches ? (
          <p className="dictionary-settings__empty">No dictionaries match this search.</p>
        ) : null}
        {filteredDictionaries.map(({ dictionary, index }) => (
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
        {filteredCatalogEntries.map((entry) => (
          <CatalogDictionaryRow controller={controller} entry={entry} key={entry.id} />
        ))}
      </div>

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
