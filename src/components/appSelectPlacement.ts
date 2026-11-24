export const APP_SELECT_VIEWPORT_MARGIN = 8;
export const APP_SELECT_TRIGGER_GAP = 6;
function nonDefaultContainingBlockValue(value: string | undefined): boolean {
  return Boolean(value && value !== "none" && value !== "normal");
}

function isActiveModalDialog(element: HTMLElement): boolean {
  if (element.tagName !== "DIALOG") return false;

  try {
    return element.matches(":modal");
  } catch {
    return false;
  }
}

function establishesFixedContainingBlock(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (
    nonDefaultContainingBlockValue(style.transform) ||
    nonDefaultContainingBlockValue(style.translate) ||
    nonDefaultContainingBlockValue(style.rotate) ||
    nonDefaultContainingBlockValue(style.scale) ||
    nonDefaultContainingBlockValue(style.perspective) ||
    nonDefaultContainingBlockValue(style.filter) ||
    nonDefaultContainingBlockValue(style.backdropFilter)
  ) {
    return true;
  }

  const containment = style.contain.split(/\s+/);
  if (containment.some((value) => ["layout", "paint", "strict", "content"].includes(value))) {
    return true;
  }
  if (style.contentVisibility === "auto") {
    return true;
  }

  const willChange = style.willChange.split(",").map((value) => value.trim());
  return willChange.some((value) =>
    [
      "transform",
      "translate",
      "rotate",
      "scale",
      "perspective",
      "filter",
      "backdrop-filter",
    ].includes(value),
  );
}

export function getAppSelectFixedScaleY(menu: HTMLElement): number {
  let containingBlock = menu.parentElement;
  while (containingBlock && !establishesFixedContainingBlock(containingBlock)) {
    if (isActiveModalDialog(containingBlock)) {
      containingBlock = null;
      break;
    }
    containingBlock = containingBlock.parentElement;
  }

  if (!containingBlock) {
    return 1;
  }

  const bounds = containingBlock.getBoundingClientRect();
  const scaleY =
    containingBlock.offsetHeight > 0 ? bounds.height / containingBlock.offsetHeight : 1;
  return Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1;
}

export function scrollAppSelectOptionIntoView(menu: HTMLElement, option: HTMLElement): void {
  const menuRect = menu.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  // Rects are viewport pixels; scrollTop and border widths are unscaled CSS pixels.
  const scaleY =
    menu.offsetHeight > 0 && menuRect.height > 0 ? menuRect.height / menu.offsetHeight : 1;
  const visibleTop = menuRect.top + menu.clientTop * scaleY;
  const visibleBottom = menuRect.bottom - menu.clientTop * scaleY;

  if (optionRect.top < visibleTop) {
    menu.scrollTop += (optionRect.top - visibleTop) / scaleY;
  } else if (optionRect.bottom > visibleBottom) {
    menu.scrollTop += (optionRect.bottom - visibleBottom) / scaleY;
  }
}
