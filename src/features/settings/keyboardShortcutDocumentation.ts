import type { KeyboardBinding } from "../../types/keyboard";
import { commandDefinitions } from "../quick-actions/commandBindings";

const key = (value: string, shift = false): KeyboardBinding => ({
  alt: false,
  key: value,
  primary: false,
  shift,
});

export const keyboardFixedDocumentation = [
  {
    bindings: [commandDefinitions.closeTopmostSurface.defaultBinding],
    description: "Close the topmost dialog, menu, panel, or transient surface.",
    label: "Close topmost surface",
  },
  {
    bindings: [key("enter")],
    label: "Activate",
  },
  {
    bindings: [key("space")],
    description: "Activate or toggle when the focused control owns Space.",
    label: "Control-owned Space",
  },
  {
    bindings: [key("arrowleft"), key("arrowright"), key("arrowup"), key("arrowdown")],
    label: "Directional navigation",
  },
  {
    bindings: [key("home"), key("end")],
    label: "Start and end navigation",
  },
  {
    bindings: [key("pageup"), key("pagedown")],
    label: "Paged navigation",
  },
  {
    bindings: [key("f2")],
    label: "Rename",
  },
  {
    bindings: [key("delete")],
    label: "Delete",
  },
  {
    bindings: [key("f10", true), key("contextmenu")],
    label: "Context menu",
  },
] as const;
