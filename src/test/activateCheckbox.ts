/** Happy DOM does not perform native checkbox activation for Base UI's constructed pointer event.
 * Activate the associated native input here; browser tests exercise the public checkbox itself.
 */
export function activateCheckbox(checkbox: HTMLElement) {
  const input = checkbox.closest("label")?.control;
  if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") {
    throw new Error("Checkbox has no associated form input");
  }
  input.click();
}
