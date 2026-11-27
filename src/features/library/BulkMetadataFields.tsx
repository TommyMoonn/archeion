import { Checkbox } from "../../components/ui/checkbox";
import { Field, FieldLabel } from "../../components/ui/field";
import { Textarea } from "../../components/ui/textarea";
import { Input as FieldInput } from "../../components/ui/input";
import { Check } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { BulkMetadataTagMode } from "../../types/book";
import { initialBulkMetadata, type BulkMetadataField } from "./bulkMetadataDialogModel";

const fieldGroupClass =
  "grid min-w-0 content-start gap-metadata-section rounded-menu border-standard border-solid border-line bg-bulk-metadata-field p-bulk-metadata-inset opacity-72 data-[enabled=true]:border-bulk-metadata-enabled-border data-[enabled=true]:bg-bulk-metadata-enabled data-[enabled=true]:opacity-100";
const toggleClass =
  "cursor-pointer bulk-metadata-toggle-columns items-center gap-x-control-gap gap-y-bulk-metadata-label";
const currentValueClass = "col-start-2 truncate text-caption-size text-muted";
const helpClass = "m-0 text-caption text-muted";
const controlFocusClass =
  "keyboard-navigation:focus-visible:border-accent keyboard-navigation:focus-visible:ring-2 keyboard-navigation:focus-visible:ring-accent-soft keyboard-navigation:focus-visible:outline-offset-2!";

const scalarFields = [
  { field: "series", label: "Series", placeholder: "Series name" },
  { field: "publisher", label: "Publisher", placeholder: "Publisher" },
  { field: "language", label: "Language", placeholder: "Language code" },
] as const;

const tagModeOptions = [
  { label: "Replace", value: "replace" },
  { label: "Add", value: "add" },
  { label: "Remove", value: "remove" },
] satisfies Array<{ label: string; value: BulkMetadataTagMode }>;

export function BulkMetadataFields({
  common,
  enabled,
  values,
  tagMode,
  hasEnabledField,
  changedBookCount,
  toggleField,
  setValues,
  setTagMode,
}: {
  common: ReturnType<typeof initialBulkMetadata>["common"];
  enabled: Record<BulkMetadataField, boolean>;
  values: Record<BulkMetadataField, string>;
  tagMode: BulkMetadataTagMode;
  hasEnabledField: boolean;
  changedBookCount: number;
  toggleField: (field: BulkMetadataField) => void;
  setValues: Dispatch<SetStateAction<Record<BulkMetadataField, string>>>;
  setTagMode: (mode: BulkMetadataTagMode) => void;
}) {
  return (
    <div className="grid min-h-0 min-w-0 max-w-full grid-cols-2 gap-metadata-row bulk-metadata-stacked:grid-cols-1">
      {scalarFields.map(({ field, label, placeholder }) => {
        const helpId = `bulk-metadata-${field}-help`;

        return (
          <section className={fieldGroupClass} data-enabled={enabled[field]} key={field}>
            <Field className={toggleClass}>
              <Checkbox
                aria-label={label}
                aria-describedby={`${helpId}-common`}
                className="size-checkbox-large"
                checked={enabled[field]}
                onCheckedChange={() => toggleField(field)}
              />
              <FieldLabel className="text-meta-only tracking-normal text-text-strong">
                {label}
              </FieldLabel>
              <small className={currentValueClass} id={`${helpId}-common`}>
                {common[field].mixed ? "Mixed values" : common[field].value || "Not set"}
              </small>
            </Field>
            <FieldInput
              standalone
              className={`min-h-field-standard rounded-control border-standard border-solid border-line bg-surface-raised px-field-compact-inline py-0 text-meta leading-inherit disabled:cursor-not-allowed ${controlFocusClass}`}
              aria-describedby={enabled[field] ? helpId : undefined}
              aria-label={`New ${label.toLocaleLowerCase()}`}
              disabled={!enabled[field]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field]: event.target.value }))
              }
              placeholder={
                common[field].mixed
                  ? `Mixed — enter a new ${label.toLocaleLowerCase()}`
                  : placeholder
              }
              value={values[field]}
            />
            {enabled[field] ? (
              <p className={helpClass} id={helpId}>
                Leave blank to clear this field.
              </p>
            ) : null}
          </section>
        );
      })}

      <section
        className={`${fieldGroupClass} col-span-full`}
        data-enabled={enabled.subjects}
        data-slot="bulk-metadata-tags"
      >
        <Field className={toggleClass}>
          <Checkbox
            aria-label="Tags"
            aria-describedby="bulk-metadata-subjects-common"
            className="size-checkbox-large"
            checked={enabled.subjects}
            onCheckedChange={() => toggleField("subjects")}
          />
          <FieldLabel className="text-meta-only tracking-normal text-text-strong">Tags</FieldLabel>
          <small className={currentValueClass} id="bulk-metadata-subjects-common">
            {common.subjects.mixed ? "Mixed values" : common.subjects.value.join(", ") || "No tags"}
          </small>
        </Field>
        <SegmentedControl
          ariaDescribedBy="bulk-metadata-subjects-help"
          className="justify-self-start"
          label="Tag operation"
          onChange={(mode) => {
            setTagMode(mode);
            setValues((current) => ({
              ...current,
              subjects: mode === "replace" ? common.subjects.value.join("\n") : "",
            }));
          }}
          options={tagModeOptions.map((option) => ({
            ...option,
            disabled: !enabled.subjects,
          }))}
          value={tagMode}
        />
        <Textarea
          className={`min-h-field-textarea-compact bg-surface-raised px-field-compact-inline py-field-compact-block text-meta leading-field-compact ${controlFocusClass}`}
          aria-describedby="bulk-metadata-subjects-help"
          aria-label="Tags to apply"
          disabled={!enabled.subjects}
          onChange={(event) =>
            setValues((current) => ({ ...current, subjects: event.target.value }))
          }
          placeholder={tagMode === "replace" ? "One tag per line" : `Tags to ${tagMode}`}
          rows={3}
          value={values.subjects}
        />
        <p className={helpClass} id="bulk-metadata-subjects-help">
          Use one tag per line. Commas remain part of the tag. Replace with an empty list to clear
          all tags.
        </p>
      </section>

      {hasEnabledField && changedBookCount === 0 ? (
        <p
          className={`${helpClass} col-span-full flex items-center gap-field-label rounded-control border-standard border-solid border-line px-bulk-metadata-review py-bulk-metadata-block`}
        >
          <Check aria-hidden="true" className="size-icon-glyph-small" /> These values already match
          every selected book.
        </p>
      ) : null}
    </div>
  );
}
