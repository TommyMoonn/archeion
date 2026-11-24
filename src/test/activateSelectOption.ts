/** Dispatch a complete selection gesture for a Base UI option in a DOM test. */
export function activateSelectOption(option: HTMLElement) {
  option.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      button: 0,
    }),
  );
  option.click();
}
