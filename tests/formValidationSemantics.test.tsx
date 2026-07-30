// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Toggle } from "../src/components/Toggle";
import { ArchiveCreateView } from "../src/features/archive/ArchiveCreateView";
import { RenameFileDialog } from "../src/features/filesystem/RenameFileDialog";
import { FolderNameDialog } from "../src/features/folders/FolderNameDialog";
import { SettingsRow } from "../src/features/settings/SettingsRow";
import type { Book } from "../src/types/book";

let container: HTMLDivElement;
let root: Root;

const book: Book = {
  addedAt: "1",
  fileName: "Novel.epub",
  id: "book-1",
  isFavorite: false,
  originalTitle: "Novel",
  relativePath: "Novel.epub",
  updatedAt: "1",
};

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(form: HTMLFormElement): Promise<void> {
  await act(async () => {
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function ArchiveCreateOwner() {
  const [archiveName, setArchiveName] = useState("");
  const [locationPath, setLocationPath] = useState("");

  return (
    <ArchiveCreateView
      archiveName={archiveName}
      locationPath={locationPath}
      onArchiveNameChange={setArchiveName}
      onBack={vi.fn()}
      onCreated={vi.fn()}
      onLocationChange={setLocationPath}
    />
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("form validation semantics", () => {
  it("associates Settings helper text with its visible control group", () => {
    act(() => {
      root.render(
        <SettingsRow description="Controls automatic archive scans." label="Watch archive">
          <Toggle checked label="Watch archive" onChange={vi.fn()} />
        </SettingsRow>,
      );
    });

    const group = container.querySelector<HTMLElement>(".settings-row")!;
    const labelId = group.getAttribute("aria-labelledby");
    const descriptionId = group.getAttribute("aria-describedby");

    expect(group.getAttribute("role")).toBe("group");
    expect(document.getElementById(labelId!)?.textContent).toBe("Watch archive");
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "Controls automatic archive scans.",
    );
  });

  it("focuses and describes the first missing archive field without hiding submission", async () => {
    act(() => root.render(<ArchiveCreateOwner />));

    const form = container.querySelector<HTMLFormElement>(".archive-create-form")!;
    const input = container.querySelector<HTMLInputElement>("#archive-create-name")!;
    const submitButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    expect(submitButton.disabled).toBe(false);
    await submit(form);

    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(
      input
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    ).toContain("Archive name is required.");

    act(() => setInputValue(input, "Library"));
    await submit(form);

    const locationGroup = container.querySelector<HTMLElement>(
      '.archive-create-form__row[role="group"]',
    )!;
    const browse = container.querySelector<HTMLButtonElement>(".archive-create-form__browse")!;
    expect(locationGroup.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(browse);
    expect(
      locationGroup
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    ).toContain("Choose a location for the archive.");
  });

  it("keeps a required Folder name error attached to the focused field", async () => {
    const onSubmit = vi.fn(async () => undefined);
    act(() => {
      root.render(<FolderNameDialog mode="create" onClose={vi.fn()} onSubmit={onSubmit} />);
    });

    const form = container.querySelector<HTMLFormElement>(".dialog-form")!;
    const input = form.querySelector<HTMLInputElement>("input")!;
    await submit(form);

    const errorId = input.getAttribute("aria-describedby");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(errorId!)?.textContent).toBe("Enter a folder name.");
    expect(document.activeElement).toBe(input);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a rejected Folder operation separate from field validation", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("Storage rejected the folder.");
    });
    act(() => {
      root.render(
        <FolderNameDialog
          initialName="Kept Folder"
          mode="rename"
          onClose={vi.fn()}
          onSubmit={onSubmit}
        />,
      );
    });

    const form = container.querySelector<HTMLFormElement>(".dialog-form")!;
    const input = form.querySelector<HTMLInputElement>("input")!;
    await submit(form);

    const operationError = container.querySelector<HTMLElement>(".form-error")!;
    expect(onSubmit).toHaveBeenCalledWith("Kept Folder");
    expect(input.value).toBe("Kept Folder");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
    expect(operationError.textContent).toBe("The folder could not be saved. Please try again.");

    act(() => setInputValue(input, "Retry Folder"));
    expect(container.querySelector(".form-error")).toBeNull();
  });

  it("keeps filename suffix help and validation feedback associated independently", async () => {
    act(() => {
      root.render(
        <RenameFileDialog book={book} onClose={vi.fn()} onRename={vi.fn(async () => undefined)} />,
      );
    });

    const form = container.querySelector<HTMLFormElement>(".dialog-form")!;
    const input = form.querySelector<HTMLInputElement>("input")!;
    act(() => setInputValue(input, "  "));
    await submit(form);

    const descriptions = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(descriptions).toHaveLength(2);
    expect(document.getElementById(descriptions[0]!)?.textContent).toBe(".epub");
    expect(document.getElementById(descriptions[1]!)?.textContent).toBe("Enter a filename.");
    expect(document.activeElement).toBe(input);
  });

  it("keeps a rejected EPUB rename separate from filename validation and suffix help", async () => {
    const onRename = vi.fn(async () => {
      throw new Error("File is locked.");
    });
    act(() => {
      root.render(<RenameFileDialog book={book} onClose={vi.fn()} onRename={onRename} />);
    });

    const form = container.querySelector<HTMLFormElement>(".dialog-form")!;
    const input = form.querySelector<HTMLInputElement>("input")!;
    await submit(form);

    const operationError = container.querySelector<HTMLElement>(".form-error")!;
    const descriptions = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(onRename).toHaveBeenCalledWith("Novel.epub");
    expect(input.value).toBe("Novel");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(descriptions).toHaveLength(1);
    expect(document.getElementById(descriptions[0]!)?.textContent).toBe(".epub");
    expect(operationError.textContent).toBe("File is locked.");
    expect(operationError.id).toBe("");

    act(() => setInputValue(input, "Retry Novel"));
    expect(container.querySelector(".form-error")).toBeNull();
  });
});
