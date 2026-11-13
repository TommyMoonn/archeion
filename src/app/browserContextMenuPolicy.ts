const NATIVE_TEXT_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

function preservesNativeEditingMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const element = target;
  if (element.closest("textarea, [data-native-context-menu]")) return true;

  const editable = element.closest("[contenteditable]");
  if (editable) return editable.getAttribute("contenteditable") !== "false";

  const input = element.closest("input");
  return Boolean(input && NATIVE_TEXT_INPUT_TYPES.has(input.type.toLowerCase()));
}

export function installBrowserContextMenuPolicy(targetDocument: Document): () => void {
  function handleContextMenu(event: MouseEvent): void {
    if (preservesNativeEditingMenu(event.target)) return;
    event.preventDefault();
  }

  targetDocument.addEventListener("contextmenu", handleContextMenu, true);
  return () => targetDocument.removeEventListener("contextmenu", handleContextMenu, true);
}
