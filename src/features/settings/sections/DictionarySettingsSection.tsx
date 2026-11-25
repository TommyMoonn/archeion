import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { SettingsSection } from "../components/SettingsSection";
import { SurfacePresence } from "../../../components/SurfacePresence";
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
import {
  useDictionarySettings,
  type DictionaryCatalogOperation,
  type DictionarySettingsController,
} from "../useDictionarySettings";

type DictionaryView = "all" | "installed" | "not-installed";

const cardClass =
  "grid settings-row-columns min-w-0 items-center gap-dialog-gap p-overlay-viewport-inset rounded-card border-standard border-solid border-line bg-surface @max-dictionary-wide/settings-section:grid-cols-1 @max-dictionary-wide/settings-section:items-stretch";

const factsClass =
  "m-0 flex flex-wrap gap-x-overlay-viewport-inset gap-y-dictionary-fact-gap text-caption [&>div]:grid [&>div]:dictionary-fact-columns [&>div]:min-w-0 [&>div]:max-w-full [&>div]:gap-dictionary-fact-gap [&_dt]:text-muted [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:text-text [&_dd]:wrap-anywhere";

const sourceClass =
  "m-0 grid dictionary-fact-columns gap-dictionary-fact-gap text-text text-body-supporting";

const linkClass =
  "min-w-0 wrap-anywhere decoration-line-strong underline-offset-2 hover:text-text-strong! focus-visible:text-text-strong! hover:decoration-current focus-visible:decoration-current";

const noticeClass =
  "flex min-w-0 items-center justify-between gap-overlay-viewport-inset rounded-control border-standard border-dashed border-line-strong bg-surface p-button-standard text-muted text-meta @max-dictionary-narrow/settings-section:flex-col @max-dictionary-narrow/settings-section:items-stretch @max-dictionary-narrow/settings-section:[&>button]:w-full [&>p]:m-0 [&>p]:min-w-0 [&>p]:wrap-anywhere";

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

function DictionaryOperation({
  operation,
  entry,
}: {
  operation: DictionaryCatalogOperation;
  entry: DictionaryCatalogEntry;
}) {
  const total = operation.totalBytes || entry.compressedSizeBytes;
  const bytes = `${formatFileSize(operation.receivedBytes)}${total > 0 ? ` of ${formatFileSize(total)}` : " received"}`;
  return (
    <div
      className="grid min-w-0 gap-control-gap-compact text-muted text-caption"
      aria-live="polite"
    >
      {operation.phase === "downloading" ? (
        <div className="flex min-w-0 max-w-dictionary-progress items-center gap-dialog-copy @max-dictionary-narrow/settings-section:flex-col @max-dictionary-narrow/settings-section:items-stretch">
          <Progress
            aria-label={`Downloading ${entry.name}`}
            aria-valuetext={bytes}
            className="flex-1 min-w-dictionary-progress-min @max-dictionary-narrow/settings-section:flex-none @max-dictionary-narrow/settings-section:min-w-0"
            max={total > 0 ? total : 100}
            value={total > 0 ? operation.receivedBytes : null}
          />
          <span className="shrink-0 tabular-nums wrap-anywhere">{bytes}</span>
        </div>
      ) : null}
      {operation.phase === "installing" ? (
        <span className="flex items-center gap-control-gap-compact">
          <Spinner aria-hidden="true" data-visible="true" />
          Installing verified package…
        </span>
      ) : null}
      {operation.error ? (
        <Alert className="text-danger text-meta" data-tone="error">
          {operation.error}
        </Alert>
      ) : null}
    </div>
  );
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
    <article className={cardClass} data-catalog-id={entry.id}>
      <div className="grid min-w-0 gap-control-gap">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-input-gap">
          <h4 className="m-0 min-w-0 text-text-strong text-body-large font-semibold leading-dictionary-title wrap-anywhere">
            {entry.name}
          </h4>
        </div>
        <p className={sourceClass}>
          <span className="text-muted">Source</span>
          {entry.sourceUrl ? (
            <a className={linkClass} href={entry.sourceUrl} rel="noreferrer" target="_blank">
              {entry.sourceAttribution}
            </a>
          ) : (
            <span className="min-w-0 text-text wrap-anywhere">{entry.sourceAttribution}</span>
          )}
        </p>
        <dl className={factsClass}>
          <div>
            <dt>Language</dt>
            <dd>{formatDictionaryLanguagePair(entry.sourceLanguage, entry.targetLanguage)}</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>
              <a className={linkClass} href={entry.licenseUrl} rel="noreferrer" target="_blank">
                {entry.licenseName}
              </a>
            </dd>
          </div>
          <div>
            <dt>Download</dt>
            <dd>{formatFileSize(entry.compressedSizeBytes)}</dd>
          </div>
        </dl>
        {operation ? <DictionaryOperation operation={operation} entry={entry} /> : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-control-gap @max-dictionary-wide/settings-section:flex-wrap @max-dictionary-wide/settings-section:justify-start">
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
    <article className={cardClass} data-dictionary-id={dictionary.id}>
      <div className="grid min-w-0 gap-control-gap">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-input-gap">
          <h4 className="m-0 min-w-0 text-text-strong text-body-large font-semibold leading-dictionary-title wrap-anywhere">
            {dictionary.displayName}
          </h4>
          <Badge>
            {dictionary.indexState === "ready"
              ? "Ready"
              : unavailable
                ? "Unavailable"
                : "Index required"}
          </Badge>
        </div>
        <p className={sourceClass}>
          <span className="text-muted">Source</span>
          {catalogEntry?.sourceUrl ? (
            <a className={linkClass} href={catalogEntry.sourceUrl} rel="noreferrer" target="_blank">
              {dictionary.sourceAttribution}
            </a>
          ) : (
            <span className="min-w-0 text-text wrap-anywhere">{dictionary.sourceAttribution}</span>
          )}
        </p>
        <dl className={factsClass}>
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
                <a
                  className={linkClass}
                  href={dictionary.licenseUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {dictionary.licenseName}
                </a>
              ) : (
                dictionary.licenseName
              )}
            </dd>
          </div>
        </dl>
        {unavailable ? (
          <p className="m-0 text-danger text-meta wrap-anywhere">
            {dictionary.sourceKind === "catalog"
              ? catalogAvailable
                ? "Installed files are missing or invalid. Download this dictionary again to restore it."
                : "Installed files are missing or invalid. Refresh the catalog to check for a replacement, or remove this dictionary."
              : "Installed files are missing or invalid. Import a replacement, then remove this unavailable copy."}
          </p>
        ) : null}
        {recoveryOperation && catalogEntry ? (
          <DictionaryOperation operation={recoveryOperation} entry={catalogEntry} />
        ) : null}
        {rowError ? (
          <p className="m-0 text-danger text-meta wrap-anywhere" role="alert" data-tone="error">
            {rowError}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-control-gap max-w-dictionary-actions @max-dictionary-wide/settings-section:max-w-none @max-dictionary-wide/settings-section:justify-start">
        <Toggle
          checked={dictionary.enabled}
          disabled={busy || unavailable}
          label={`Enable ${dictionary.displayName}`}
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
        {recoveryOperation?.phase === "downloading" ? (
          <Button
            onClick={() => void controller.cancelDownload()}
            size="compact"
            variant="secondary"
          >
            Cancel
          </Button>
        ) : unavailable && dictionary.sourceKind === "catalog" && catalogAvailable ? (
          <Button
            busy={recoveryOperation?.phase === "installing"}
            disabled={busy || Boolean(controller.catalogOperation && !recoveryOperation)}
            icon={<Download aria-hidden="true" />}
            onClick={() => {
              if (dictionary.catalogId) void controller.installCatalog(dictionary.catalogId);
            }}
            size="compact"
            variant="secondary"
          >
            {recoveryOperation?.phase === "failed" && catalogEntry
              ? catalogActionLabel(catalogEntry, controller)
              : recoveryOperation?.phase === "installing"
                ? "Installing"
                : "Download again"}
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
      '[role="radiogroup"][aria-label="Dictionary views"] [role="radio"][aria-checked="true"]',
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
    <SettingsSection className="grid gap-dialog-gap" ref={sectionRef}>
      <SettingsSectionHeader
        actions={
          <div className="flex shrink-0 items-center justify-end gap-control-gap @max-dictionary-wide/settings-section:justify-start @max-dictionary-wide/settings-section:flex-wrap @max-dictionary-narrow/settings-section:flex-col @max-dictionary-narrow/settings-section:items-stretch @max-dictionary-narrow/settings-section:[&>button]:w-full">
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
        className="mb-0 flex items-start justify-between gap-dialog-gap @max-dictionary-wide/settings-section:flex-col @max-dictionary-wide/settings-section:items-stretch"
        title="Dictionaries"
      />

      <div className="flex min-w-0 items-center justify-between gap-3 @max-dictionary-toolbar/settings-section:flex-col @max-dictionary-toolbar/settings-section:items-stretch">
        <Input
          autoComplete="off"
          className="w-full flex-1 basis-dictionary-search-basis min-w-dictionary-search-min max-w-dictionary-search @max-dictionary-toolbar/settings-section:flex-none @max-dictionary-toolbar/settings-section:min-w-0 @max-dictionary-toolbar/settings-section:max-w-none"
          icon={<Search aria-hidden="true" />}
          label="Search dictionaries"
          onChange={(event) => setDictionaryQuery(event.currentTarget.value)}
          placeholder="Search dictionaries"
          size="standard"
          type="search"
          value={dictionaryQuery}
        />

        <SegmentedControl<DictionaryView>
          className="shrink-0 @max-dictionary-toolbar/settings-section:w-full"
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
        <p className="m-0 text-danger text-meta wrap-anywhere" role="alert" data-tone="error">
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
        className="grid min-w-0 gap-dialog-copy"
        role="region"
      >
        {view !== "installed" && controller.catalogError ? (
          <Alert className={noticeClass} data-tone="error">
            <p>{controller.catalogError}</p>
            <Button
              onClick={() => void controller.refreshCatalog()}
              size="compact"
              variant="secondary"
            >
              Try again
            </Button>
          </Alert>
        ) : null}
        {view !== "installed" && controller.catalogState === "loading" ? (
          <p className="m-0 flex items-center gap-control-gap text-muted text-meta" role="status">
            <Spinner aria-hidden="true" data-visible="true" />
            Loading available dictionaries…
          </p>
        ) : null}
        {view !== "installed" &&
        controller.catalogState === "ready" &&
        catalogEntries.length === 0 ? (
          <Empty className={`${noticeClass} flex-row`}>
            <p>No catalog has been loaded yet.</p>
            <Button onClick={() => void controller.refreshCatalog()} size="compact">
              Refresh catalog
            </Button>
          </Empty>
        ) : null}
        {view !== "installed" && controller.catalog?.cacheWarning ? (
          <p className="m-0 text-muted text-meta wrap-anywhere">
            {controller.catalog.cacheWarning}
          </p>
        ) : null}
        {view !== "not-installed" && controller.registryState === "loading" ? (
          <p className="m-0 flex items-center gap-control-gap text-muted text-meta" role="status">
            <Spinner aria-hidden="true" data-visible="true" />
            Loading installed dictionaries…
          </p>
        ) : null}
        {view !== "not-installed" && controller.registryError ? (
          <p className="m-0 text-danger text-meta wrap-anywhere" role="alert" data-tone="error">
            {controller.registryError}
          </p>
        ) : null}
        {view !== "not-installed" && controller.registry?.status === "recovery-required" ? (
          <Alert className={noticeClass} data-tone="error">
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
          </Alert>
        ) : null}
        {view === "installed" &&
        controller.registryState === "ready" &&
        controller.registry?.status === "ready" &&
        dictionaries.length === 0 ? (
          <EmptyDescription role="status">No dictionaries are installed.</EmptyDescription>
        ) : null}
        {view === "not-installed" &&
        controller.catalogState === "ready" &&
        catalogEntries.length > 0 &&
        notInstalledCatalogEntries.length === 0 ? (
          <EmptyDescription role="status">All catalog dictionaries are installed.</EmptyDescription>
        ) : null}
        {queryHasNoMatches ? (
          <EmptyDescription role="status">No dictionaries match this search.</EmptyDescription>
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

      <SurfacePresence>
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
      </SurfacePresence>
    </SettingsSection>
  );
}

export function DictionarySettingsSection() {
  const controller = useDictionarySettings();
  return <DictionarySettingsView controller={controller} />;
}
