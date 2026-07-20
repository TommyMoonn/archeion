import {
  KeyboardShortcutDocumentationRow,
  KeyboardShortcutRow,
  ResetKeyboardShortcutsRow,
} from "../KeyboardShortcutSettings";
import { keyboardFixedDocumentation } from "../keyboardShortcutDocumentation";
import { configurableCommandDefinitions } from "../../quick-actions/commandBindings";
import type { SettingsItem } from "../settingsItemTypes";
import type { SettingsDialogController } from "../useSettingsDialogController";

const configurableItems = configurableCommandDefinitions.map((command): SettingsItem => ({
  description: `Configure ${command.label.toLocaleLowerCase()}.`,
  groupLabel: command.group,
  id: `keyboard.${command.id}`,
  label: command.label,
  render: (context: SettingsDialogController) => (
    <KeyboardShortcutRow command={command} context={context} />
  ),
  searchTerms: [command.label, command.id, "shortcut", "hotkey", "key binding"],
  sectionId: "keyboard",
}));

export const keyboardSettingsItems: readonly SettingsItem[] = [
  ...configurableItems,
  ...keyboardFixedDocumentation.map((entry): SettingsItem => {
    const description = "description" in entry ? entry.description : undefined;
    return {
      description,
      groupLabel: "Fixed Interaction Keys",
      id: `keyboard.documentation.fixed-${entry.label.toLocaleLowerCase().replaceAll(" ", "-")}`,
      label: entry.label,
      render: () => <KeyboardShortcutDocumentationRow {...entry} />,
      searchTerms: [entry.label, description ?? "", "fixed interaction key"],
      sectionId: "keyboard",
    };
  }),
  {
    groupLabel: "Reset shortcuts",
    groupStyle: "actions",
    id: "keyboard.reset-all",
    label: "Reset all keyboard shortcuts",
    render: (context) => <ResetKeyboardShortcutsRow context={context} />,
    searchTerms: ["reset keyboard shortcuts", "restore default shortcuts"],
    sectionId: "keyboard",
  },
];
