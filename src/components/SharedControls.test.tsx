// @vitest-environment happy-dom

import { act, type FormEvent, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../utils/transientSurfaceOwnership";
import { AppSelect } from "./AppSelect";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { MenuItem } from "./MenuItem";
import { SegmentedControl } from "./SegmentedControl";
import { Toggle } from "./Toggle";

let activeRoot: Root | null = null;

function pointerClick(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    target.click();
  });
}

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  resetTransientSurfaceOwnershipForTests();
  document.body.innerHTML = "";
});

describe("shared control geometry", () => {
  it("publishes semantic size and busy states without changing labels", () => {
    const markup = renderToStaticMarkup(
      <>
        <Button busy size="compact">
          Save changes
        </Button>
        <IconButton disabled disabledReason="Finish saving first" label="Close" size="prominent">
          <span>×</span>
        </IconButton>
        <Input label="Search" size="standard" />
        <SegmentedControl
          label="View"
          onChange={() => undefined}
          options={[{ label: "Grid", value: "grid" }]}
          size="standard"
          value="grid"
        />
        <Toggle checked label="Enabled" onChange={() => undefined} size="compact" />
      </>,
    );

    expect(markup).toContain("button--compact");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Save changes");
    expect(markup).toContain("icon-button--prominent");
    expect(markup).toContain('title="Finish saving first"');
    expect(markup).toContain("input-shell--standard");
    expect(markup).toContain("segmented-control--standard");
    expect(markup).toContain("toggle-control--compact");
  });

  it("generates unique IDs for repeated visible labels", () => {
    const markup = renderToStaticMarkup(
      <>
        <Input label="Search" />
        <Input label="Search" />
        <AppSelect
          label="Sort"
          onChange={() => undefined}
          options={[{ label: "Title", value: "title" }]}
          value="title"
        />
        <AppSelect
          label="Sort"
          onChange={() => undefined}
          options={[{ label: "Title", value: "title" }]}
          value="title"
        />
      </>,
    );
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a disabled icon-button reason keyboard and assistive-technology reachable", () => {
    const onClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <IconButton
          disabled
          disabledReason="Wait for the current action to finish"
          label="Move selected books"
          onClick={onClick}
        >
          <span>→</span>
        </IconButton>,
      );
    });

    const button = container.querySelector("button")!;
    const reasonId = button.getAttribute("aria-describedby")!;
    act(() => {
      button.focus();
      button.click();
    });

    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(document.getElementById(reasonId)?.textContent).toBe(
      "Wait for the current action to finish",
    );
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps an explained disabled button focusable while blocking click, parent, and form activation", () => {
    const onClick = vi.fn();
    const onParentClick = vi.fn();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <div onClick={onParentClick}>
          <form onSubmit={onSubmit}>
            <Button
              disabled
              disabledReason="Choose a destination first"
              onClick={onClick}
              type="submit"
            >
              Move file
            </Button>
          </form>
        </div>,
      );
    });

    const button = container.querySelector("button")!;
    const reasonId = button.getAttribute("aria-describedby")!;
    act(() => {
      button.focus();
      button.click();
      button.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
    });

    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button);
    expect(document.getElementById(reasonId)?.textContent).toBe("Choose a destination first");
    expect(onClick).not.toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps unexplained transient Button disabling native", () => {
    const markup = renderToStaticMarkup(<Button disabled>Saving</Button>);

    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("aria-describedby");
  });

  it("uses one icon-and-label contract for normal and destructive menu items", () => {
    const markup = renderToStaticMarkup(
      <MenuItem danger icon={<span>!</span>}>
        Delete EPUB
      </MenuItem>,
    );

    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain("menu-item--danger");
    expect(markup).toContain("menu-item__icon icon-slot");
    expect(markup).toContain("menu-item__label");
  });

  it("keeps text-only menu rows on the same shared contract without reserving an empty icon slot", () => {
    const markup = renderToStaticMarkup(<MenuItem>Open archive</MenuItem>);

    expect(markup).toContain("menu-item--no-icon");
    expect(markup).toContain("menu-item__label");
    expect(markup).not.toContain("menu-item__icon");
  });

  it("keeps an explained disabled menu item reachable while blocking activation", () => {
    const onClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    activeRoot = createRoot(container);

    act(() => {
      activeRoot?.render(
        <MenuItem disabled disabledReason="The EPUB file is missing." onClick={onClick}>
          Read
        </MenuItem>,
      );
    });

    const item = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    const reasonId = item.getAttribute("aria-describedby")!;
    act(() => {
      item.focus();
      item.click();
    });

    expect(item.disabled).toBe(false);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(item);
    expect(document.getElementById(reasonId)?.textContent).toBe("The EPUB file is missing.");
    expect(onClick).not.toHaveBeenCalled();
  });
});

function IconOnlySegmentedControlHarness() {
  const [value, setValue] = useState<"cards" | "grid" | "list">("grid");

  return (
    <SegmentedControl
      appearance="icon-only"
      label="Collection view"
      onChange={setValue}
      options={[
        { icon: <svg />, label: "Grid", value: "grid" },
        { disabled: true, icon: <svg />, label: "Cards", value: "cards" },
        { icon: <svg />, label: "List", value: "list" },
      ]}
      value={value}
    />
  );
}

describe("icon-only SegmentedControl", () => {
  it("uses option labels as accessible names without rendering duplicate visible text", () => {
    const markup = renderToStaticMarkup(<IconOnlySegmentedControlHarness />);

    expect(markup).toContain("segmented-control--icon-only");
    expect(markup).toContain('aria-label="Collection view"');
    expect(markup).toContain('aria-label="Grid"');
    expect(markup).toContain('aria-label="Cards"');
    expect(markup).toContain('aria-label="List"');
    expect(markup).not.toContain(">Grid<");
    expect(markup).not.toContain(">Cards<");
    expect(markup).not.toContain(">List<");
  });

  it("preserves roving focus, disabled skipping, arrows, Home, End, and click behavior", () => {
    const container = document.createElement("div");
    document.body.append(container);
    activeRoot = createRoot(container);

    act(() => activeRoot?.render(<IconOnlySegmentedControlHarness />));

    const grid = container.querySelector<HTMLButtonElement>('button[aria-label="Grid"]')!;
    const cards = container.querySelector<HTMLButtonElement>('button[aria-label="Cards"]')!;
    const list = container.querySelector<HTMLButtonElement>('button[aria-label="List"]')!;

    expect(grid.tabIndex).toBe(0);
    expect(cards.disabled).toBe(true);
    expect(list.tabIndex).toBe(-1);

    act(() => {
      grid.focus();
      grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(list.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(list);

    act(() => {
      list.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(grid.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(grid);

    act(() => {
      grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(list.getAttribute("aria-checked")).toBe("true");

    act(() => grid.click());
    expect(grid.getAttribute("aria-checked")).toBe("true");
    expect(grid.tabIndex).toBe(0);
    expect(list.tabIndex).toBe(-1);
  });
});

describe("AppSelect dismissal", () => {
  function renderSelectWithNeighbors() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    act(() => {
      root.render(
        <>
          <button type="button">Before</button>
          <AppSelect
            ariaLabel="Sort books"
            onChange={vi.fn()}
            options={[
              { label: "Title", value: "title" },
              { label: "Author", value: "author" },
            ]}
            value="title"
          />
          <button type="button">After</button>
        </>,
      );
    });
    return { container };
  }

  it("exposes and updates one active option through the keyboard model", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <AppSelect
          label="Sort books"
          onChange={onChange}
          options={[
            { label: "Title", value: "title" },
            { disabled: true, label: "Author", value: "author" },
            { label: "Last opened", value: "last-opened" },
          ]}
          value="title"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });

    const activeId = trigger.getAttribute("aria-activedescendant")!;
    const activeOption = document.getElementById(activeId)!;
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(activeOption.textContent).toContain("Last opened");
    expect(activeOption.dataset.active).toBe("true");
    expect(activeOption.tabIndex).toBe(-1);

    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    const firstActiveId = trigger.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(firstActiveId)?.textContent).toContain("Title");

    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    expect(onChange).toHaveBeenCalledWith("last-opened");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("observes outside pointer presses before stopped propagation without blocking the target", () => {
    const onOutsideClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <div onPointerDown={(event) => event.stopPropagation()}>
          <AppSelect
            ariaLabel="Sort books"
            onChange={vi.fn()}
            options={[
              { label: "Title", value: "title" },
              { label: "Author", value: "author" },
            ]}
            value="title"
          />
          <button onClick={onOutsideClick} type="button">
            Outside target
          </button>
        </div>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    pointerClick(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    pointerClick(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === "Outside target",
      )!,
    );

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(onOutsideClick).toHaveBeenCalledTimes(1);
  });

  it("keeps option selection working with capture-phase outside observation", () => {
    const onChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <AppSelect
          ariaLabel="Sort books"
          onChange={onChange}
          options={[
            { label: "Title", value: "title" },
            { label: "Author", value: "author" },
          ]}
          value="title"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    pointerClick(trigger);
    const author = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === "Author",
    )!;
    pointerClick(author);

    expect(onChange).toHaveBeenCalledWith("author");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape and returns focus to its trigger", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <AppSelect
          ariaLabel="Sort books"
          onChange={vi.fn()}
          options={[
            { label: "Title", value: "title" },
            { label: "Author", value: "author" },
          ]}
          value="title"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => {
      trigger.focus();
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Tab focus departure without restoring trigger focus", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    const after = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "After",
    )!;
    act(() => trigger.focus());
    pointerClick(trigger);

    act(() => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
      after.focus();
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(after);
  });

  it("closes on Shift+Tab focus departure without restoring trigger focus", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    const before = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Before",
    )!;
    act(() => trigger.focus());
    pointerClick(trigger);

    act(() => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
      );
      before.focus();
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(before);
  });

  it("keeps the listbox open when focus moves between AppSelect descendants", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => trigger.focus());
    pointerClick(trigger);
    const option = container.querySelector<HTMLButtonElement>('[role="option"]')!;

    act(() => option.focus());

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(option);
  });

  it("closes when another focus-owning surface receives focus", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    act(() => trigger.focus());
    pointerClick(trigger);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.tabIndex = -1;
    document.body.append(dialog);

    act(() => dialog.focus());

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(dialog);
    dialog.remove();
  });

  it("respects a newer surface that already owns Escape", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
    trigger.focus();
    pointerClick(trigger);
    const newerSurface = document.body.appendChild(document.createElement("div"));
    let unregisterNewer: () => void = () => undefined;
    unregisterNewer = registerTransientSurface({
      element: newerSurface,
      kind: "popover",
      onDismiss: () => unregisterNewer(),
    });

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      ),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      ),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    newerSurface.remove();
  });
});
