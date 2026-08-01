export type FocusPresentationIntent =
  "keyboard-command" | "keyboard-navigation" | "pointer" | "programmatic";

const PRESENTATION_ATTRIBUTE = "data-focus-presentation";
const TEXT_ENTRY_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

function targetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<Element>;
  return candidate.nodeType === 1 && typeof candidate.closest === "function"
    ? (target as Element)
    : null;
}

function isTextEntryTarget(target: Element): boolean {
  if (target.closest("[contenteditable]:not([contenteditable='false'])")) return true;
  if (target.closest("textarea")) return true;
  const input = target.closest<HTMLInputElement>("input");
  return input ? TEXT_ENTRY_INPUT_TYPES.has(input.type) : false;
}

function isApplicationControl(target: EventTarget | null): boolean {
  const element = targetElement(target);
  if (!element || isTextEntryTarget(element)) return false;
  return Boolean(
    element.closest(
      "button, a[href], summary, select, input, [role='button'], [role='checkbox'], [role='combobox'], [role='link'], [role='menuitem'], [role='option'], [role='radio'], [role='switch'], [role='tab'], [tabindex]:not([tabindex='-1'])",
    ),
  );
}

export class FocusPresentationRuntime {
  private applicationDocument: Document | null = null;
  private intent: FocusPresentationIntent = "pointer";
  private subscriberCount = 0;

  start(applicationDocument: Document): () => void {
    if (this.applicationDocument && this.applicationDocument !== applicationDocument) {
      throw new Error("Focus presentation already belongs to another application document.");
    }

    if (!this.applicationDocument) {
      this.applicationDocument = applicationDocument;
      this.intent = "pointer";
      this.publish();
      applicationDocument.addEventListener("pointerdown", this.handlePointerDown, true);
      applicationDocument.addEventListener("keydown", this.handleKeyDown);
    }
    this.subscriberCount += 1;

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subscriberCount -= 1;
      if (this.subscriberCount !== 0 || this.applicationDocument !== applicationDocument) return;

      applicationDocument.removeEventListener("pointerdown", this.handlePointerDown, true);
      applicationDocument.removeEventListener("keydown", this.handleKeyDown);
      applicationDocument.documentElement.removeAttribute(PRESENTATION_ATTRIBUTE);
      this.applicationDocument = null;
    };
  }

  getIntent(): FocusPresentationIntent {
    return this.intent;
  }

  markKeyboardCommand(): void {
    this.setIntent("keyboard-command");
  }

  markKeyboardNavigation(): void {
    this.setIntent("keyboard-navigation");
  }

  markPointer(): void {
    this.setIntent("pointer");
  }

  markProgrammatic(): void {
    this.setIntent("programmatic");
  }

  reportKeyDown(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      this.markKeyboardNavigation();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isApplicationControl(event.target)) {
      this.markKeyboardNavigation();
    }
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    this.reportKeyDown(event);
  };

  private handlePointerDown = () => {
    this.markPointer();
  };

  private publish(): void {
    this.applicationDocument?.documentElement.setAttribute(PRESENTATION_ATTRIBUTE, this.intent);
  }

  private setIntent(intent: FocusPresentationIntent): void {
    if (!this.applicationDocument || this.intent === intent) return;
    this.intent = intent;
    this.publish();
  }
}

export const focusPresentationRuntime = new FocusPresentationRuntime();
