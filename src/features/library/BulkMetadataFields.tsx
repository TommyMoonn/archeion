import { Check } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { BulkMetadataTagMode } from "../../types/book";
import { initialBulkMetadata, type BulkMetadataField } from "./bulkMetadataDialogModel";
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
    <div className="bulk-metadata-editor">
      {scalarFields.map(({ field, label, placeholder }) => {
        const helpId = `bulk-metadata-${field}-help`;

        return (
          <section className="bulk-metadata-field" data-enabled={enabled[field]} key={field}>
            <label className="bulk-metadata-field__toggle">
              <input checked={enabled[field]} onChange={() => toggleField(field)} type="checkbox" />
              <span>{label}</span>
              <small>
                {common[field].mixed ? "Mixed values" : common[field].value || "Not set"}
              </small>
            </label>
            <input
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
            {enabled[field] ? <p id={helpId}>Leave blank to clear this field.</p> : null}
          </section>
        );
      })}

      <section
        className="bulk-metadata-field bulk-metadata-field--tags"
        data-enabled={enabled.subjects}
      >
        <label className="bulk-metadata-field__toggle">
          <input
            checked={enabled.subjects}
            onChange={() => toggleField("subjects")}
            type="checkbox"
          />
          <span>Tags</span>
          <small>
            {common.subjects.mixed ? "Mixed values" : common.subjects.value.join(", ") || "No tags"}
          </small>
        </label>
        <SegmentedControl
          ariaDescribedBy="bulk-metadata-subjects-help"
          className="bulk-metadata-field__tag-mode"
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
        <textarea
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
        <p id="bulk-metadata-subjects-help">
          Use one tag per line. Commas remain part of the tag. Replace with an empty list to clear
          all tags.
        </p>
      </section>

      {hasEnabledField && changedBookCount === 0 ? (
        <p className="bulk-metadata-editor__notice">
          <Check aria-hidden="true" size={15} /> These values already match every selected book.
        </p>
      ) : null}
    </div>
  );
}
