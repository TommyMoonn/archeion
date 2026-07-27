export type InputModality = "keyboard" | "pointer";

const MODALITY_ATTRIBUTE = "data-input-modality";
const DIRECTIONAL_NAVIGATION_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);
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

export class InputModalityRuntime {
  private applicationDocument: Document | null = null;
  private modality: InputModality = "pointer";
  private subscriberCount = 0;

  start(applicationDocument: Document): () => void {
    if (this.applicationDocument && this.applicationDocument !== applicationDocument) {
      throw new Error("Input modality already belongs to another application document.");
    }

    if (!this.applicationDocument) {
      this.applicationDocument = applicationDocument;
      this.modality = "pointer";
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
      applicationDocument.documentElement.removeAttribute(MODALITY_ATTRIBUTE);
      this.applicationDocument = null;
    };
  }

  getModality(): InputModality {
    return this.modality;
  }

  markKeyboard(): void {
    this.setModality("keyboard");
  }

  markPointer(): void {
    this.setModality("pointer");
  }

  reportKeyDown(event: KeyboardEvent): void {
    if (event.key === "Tab") {
      this.markKeyboard();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && isApplicationControl(event.target)) {
      this.markKeyboard();
      return;
    }

    if (event.defaultPrevented && DIRECTIONAL_NAVIGATION_KEYS.has(event.key)) {
      this.markKeyboard();
    }
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    this.reportKeyDown(event);
  };

  private handlePointerDown = () => {
    this.markPointer();
  };

  private publish(): void {
    this.applicationDocument?.documentElement.setAttribute(MODALITY_ATTRIBUTE, this.modality);
  }

  private setModality(modality: InputModality): void {
    if (!this.applicationDocument || this.modality === modality) return;
    this.modality = modality;
    this.publish();
  }
}

export const inputModalityRuntime = new InputModalityRuntime();
