import { Button } from "../../../components/Button";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { readerReadingWidthOptions } from "../../../types/reader";
import { ReaderFontPicker } from "../../reader/ReaderFontPicker";
import { ReaderThemeSelect } from "../../themes/ReaderThemeSelect";
import {
  SettingsActionRow,
  SettingsSliderRow,
  StandardSettingsRow,
} from "../components/SettingsRows";
import type { SettingsItem } from "../settingsItemTypes";
import { progressPlacementOptions } from "../settingsOptions";

export const readerSettingsItems = [
  {
    description: "Sets the default reader typeface.",
    deferredData: ["installedFonts"],
    id: "reader.font-family",
    label: "Font family",
    render: (context) => (
      <StandardSettingsRow description="Sets the default reader typeface." label="Font family">
        <ReaderFontPicker
          ariaLabel="Reader font family"
          catalogLoading={context.installedFontsLoading}
          installedFamilies={context.installedFontFamilies}
          onChange={(fontFamily) => context.updateReader({ fontFamily })}
          selection={context.reader.fontFamily}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["font", "typeface", "serif", "sans", "literata", "atkinson", "hyperlegible"],
    sectionId: "reader",
  },
  {
    description: "Sets the default text size in the reader.",
    id: "reader.font-size",
    label: "Font size",
    render: (context) => (
      <SettingsSliderRow
        description="Sets the default text size in the reader."
        label="Font size"
        max={28}
        min={14}
        step={1}
        onChange={(fontSize) => context.updateReader({ fontSize })}
        suffix="px"
        value={context.reader.fontSize}
      />
    ),
    searchTerms: ["font", "text size"],
    sectionId: "reader",
  },
  {
    description: "Adjusts spacing between lines in the reader.",
    id: "reader.line-height",
    label: "Line height",
    render: (context) => (
      <SettingsSliderRow
        description="Adjusts spacing between lines in the reader."
        label="Line height"
        max={2}
        min={1.4}
        onChange={(lineHeight) => context.updateReader({ lineHeight })}
        step={0.1}
        value={Number(context.reader.lineHeight.toFixed(1))}
      />
    ),
    searchTerms: ["spacing", "lines"],
    sectionId: "reader",
  },
  {
    description: "Sets the maximum readable line length for reflowable books.",
    id: "reader.page-width",
    label: "Page width",
    render: (context) => (
      <StandardSettingsRow
        description="Sets the maximum readable line length for reflowable books."
        label="Page width"
      >
        <SegmentedControl
          label="Default reader page width"
          onChange={(readingWidth) => context.updateReader({ readingWidth })}
          options={[...readerReadingWidthOptions]}
          value={context.reader.readingWidth}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["width", "measure", "line length"],
    sectionId: "reader",
  },
  {
    deferredData: ["themeCatalog"],
    description: "Choose the colors used while reading.",
    id: "reader.theme",
    label: "Reader theme",
    render: (context) => (
      <StandardSettingsRow description="Choose the colors used while reading." label="Reader theme">
        <ReaderThemeSelect
          entries={context.themeCatalogEntries}
          onChange={(readerTheme) => void context.updateAppearance({ readerTheme })}
          onOpen={() => void context.refreshThemeCatalog()}
          selection={context.preferences.readerTheme}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["theme", "light", "sepia", "dark", "epub reader", "custom reader theme"],
    sectionId: "reader",
  },
  {
    description: "Chooses where reading progress appears.",
    id: "reader.progress-placement",
    label: "Progress placement",
    render: (context) => (
      <StandardSettingsRow
        description="Chooses where reading progress appears."
        label="Progress placement"
      >
        <SegmentedControl
          label="Reader progress placement"
          onChange={(progressPlacement) => context.updateReader({ progressPlacement })}
          options={progressPlacementOptions}
          value={context.reader.progressPlacement}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["progress", "reading position", "top", "side"],
    sectionId: "reader",
  },
  {
    id: "reader.reset",
    label: "Reset reader settings",
    render: (context) => (
      <SettingsActionRow label="Reset reader settings">
        <Button onClick={() => void context.resetReader()} variant="secondary">
          Reset Reader
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["reset"],
    sectionId: "reader",
  },
] as const satisfies readonly SettingsItem[];
