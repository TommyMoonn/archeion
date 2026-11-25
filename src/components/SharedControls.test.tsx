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
import { TooltipProvider } from "./Tooltip";
import { Toggle } from "./Toggle";
import { activateSelectOption } from "../test/activateSelectOption";

let activeRoot: Root | null = null;

function pointerClick(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    target.click();
  });
}

afterEach(() => {
  vi.useRealTimers();
  if (activeRoot) {
    act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  resetTransientSurfaceOwnershipForTests();
  document.body.innerHTML = "";
});

describe("shared control geometry", () => {
  it("publishes semantic size, busy, and checked states without changing labels", () => {
    const container = document.createElement("div");
    document.body.append(container);
    activeRoot = createRoot(container);
    act(() => {
      activeRoot?.render(
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
    });
    const markup = container.innerHTML;
    const toggle = container.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Enabled"]',
    );

    expect(markup).toContain("button--compact");
    expect(markup).toContain('aria-busy="true"');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(markup).toContain("Save changes");
    expect(markup).toContain("icon-button--prominent");
    expect(markup).not.toContain('title="Finish saving first"');
    expect(markup).toContain("input-shell--standard");
    expect(container.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Grid",
    );
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

  it("forwards an owned description to a composite control", () => {
    const markup = renderToStaticMarkup(
      <>
        <p id="view-help">Choose how books are displayed.</p>
        <SegmentedControl
          ariaDescribedBy="view-help"
          label="View"
          onChange={() => undefined}
          options={[{ label: "Grid", value: "grid" }]}
          value="grid"
        />
      </>,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-describedby="view-help"');
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

  it("uses the accessible label as the default tooltip for icon-only controls", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <TooltipProvider>
          <IconButton label="Open actions">
            <span>+</span>
          </IconButton>
        </TooltipProvider>,
      );
    });

    const button = container.querySelector("button")!;
    expect(button.title).toBe("");
    const descriptionId = button.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe("Open actions");
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
  });

  it("shows the default icon-button label through the styled tooltip on hover", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <TooltipProvider>
          <IconButton label="Open book actions">
            <span>⋯</span>
          </IconButton>
        </TooltipProvider>,
      );
    });

    const button = container.querySelector("button")!;
    act(() => {
      const pointerEnter = new Event("pointerover", { bubbles: true });
      Object.defineProperty(pointerEnter, "pointerType", { value: "mouse" });
      button.dispatchEvent(pointerEnter);
      vi.advanceTimersByTime(500);
    });

    expect(document.querySelector(".app-tooltip")?.textContent).toBe("Open book actions");
    vi.useRealTimers();
  });

  it("keeps an unavailable reason accessible without a native tooltip", () => {
    const onClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <IconButton
          disabled
          disabledReason="Choose an archive first"
          label="Reveal archive"
          onClick={onClick}
        >
          <span>↗</span>
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
    expect(button.title).toBe("");
    expect(document.getElementById(reasonId)?.textContent).toBe("Choose an archive first");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets an unavailable reason override an icon control's normal tooltip", () => {
    vi.useFakeTimers();
    const onEnabledClick = vi.fn();
    const onUnavailableClick = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <TooltipProvider>
          <IconButton label="Open archive" onClick={onEnabledClick} tooltip="Open archive">
            <span>↗</span>
          </IconButton>
          <IconButton
            disabled
            disabledReason="Choose an archive first"
            label="Reveal archive"
            onClick={onUnavailableClick}
            tooltip="Reveal archive"
          >
            <span>↗</span>
          </IconButton>
        </TooltipProvider>,
      );
    });

    const [enabled, unavailable] = container.querySelectorAll("button");
    const enabledDescriptionId = enabled?.getAttribute("aria-describedby") ?? "";
    const unavailableDescriptionId = unavailable?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(enabledDescriptionId)?.textContent).toBe("Open archive");
    expect(document.getElementById(unavailableDescriptionId)?.textContent).toBe(
      "Choose an archive first",
    );
    expect(unavailable?.disabled).toBe(false);
    expect(unavailable?.getAttribute("aria-disabled")).toBe("true");

    act(() => {
      enabled?.click();
      unavailable?.focus();
      unavailable?.click();
      const pointerEnter = new Event("pointerover", { bubbles: true });
      Object.defineProperty(pointerEnter, "pointerType", { value: "mouse" });
      unavailable?.dispatchEvent(pointerEnter);
      vi.advanceTimersByTime(500);
    });

    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Choose an archive first");
    expect(onEnabledClick).toHaveBeenCalledOnce();
    expect(onUnavailableClick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not add redundant tooltips to clear visible text controls", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <TooltipProvider>
          <Button>Save changes</Button>
          <MenuItem>Edit metadata</MenuItem>
        </TooltipProvider>,
      );
    });

    for (const control of container.querySelectorAll("button")) {
      expect(control.getAttribute("title")).toBeNull();
      expect(control.getAttribute("aria-describedby")).toBeNull();
    }
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
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

    expect(markup).toContain('aria-label="Collection view"');
    expect(markup).toContain('aria-label="Grid"');
    expect(markup).toContain('aria-label="Cards"');
    expect(markup).toContain('aria-label="List"');
    expect(markup).not.toContain(">Grid<");
    expect(markup).not.toContain(">Cards<");
    expect(markup).not.toContain(">List<");
  });
});

describe("icon-only composite control tooltips", () => {
  it("uses option labels and the select accessible name as styled tooltip descriptions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;

    act(() => {
      root.render(
        <TooltipProvider>
          <SegmentedControl
            appearance="icon-only"
            label="Collection view"
            onChange={() => undefined}
            options={[
              { icon: <span>▦</span>, label: "Grid view", value: "grid" },
              { icon: <span>☷</span>, label: "List view", value: "list" },
            ]}
            value="grid"
          />
          <AppSelect
            appearance="icon-only"
            ariaLabel="Choose reading appearance"
            onChange={() => undefined}
            options={[{ label: "Dark", value: "dark" }]}
            triggerIcon={<span>◐</span>}
            value="dark"
          />
        </TooltipProvider>,
      );
    });

    const grid = container.querySelector<HTMLButtonElement>('button[aria-label="Grid view"]')!;
    const list = container.querySelector<HTMLButtonElement>('button[aria-label="List view"]')!;
    const select = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose reading appearance"]',
    )!;

    for (const [button, expected] of [
      [grid, "Grid view"],
      [list, "List view"],
      [select, "Choose reading appearance"],
    ] as const) {
      const descriptionId = button.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId!)?.textContent).toBe(expected);
    }
  });
});

describe("AppSelect open notifications", () => {
  function renderSelect(onOpen: () => void) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    act(() => {
      root.render(
        <AppSelect
          ariaLabel="Sort books"
          onChange={vi.fn()}
          onOpen={onOpen}
          options={[
            { label: "Title", value: "title" },
            { label: "Author", value: "author" },
          ]}
          value="title"
        />,
      );
    });
    return container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
  }

  it("reports each pointer closed-to-open transition once without reporting close", async () => {
    const onOpen = vi.fn();
    const trigger = renderSelect(onOpen);

    await act(async () => pointerClick(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(onOpen).toHaveBeenCalledOnce();

    await act(async () => pointerClick(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(onOpen).toHaveBeenCalledOnce();

    await act(async () => pointerClick(trigger));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  // Real keyboard activation and roving focus are exercised by app-select.pw.ts.
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

  it("closes and stays closed when it becomes disabled", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    activeRoot = root;
    const renderSelect = (disabled: boolean) => {
      act(() => {
        root.render(
          <AppSelect
            ariaLabel="Sort books"
            disabled={disabled}
            onChange={vi.fn()}
            options={[
              { label: "Title", value: "title" },
              { label: "Author", value: "author" },
            ]}
            value="title"
          />,
        );
      });
    };

    renderSelect(false);
    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    renderSelect(true);
    expect(trigger.disabled).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    renderSelect(false);
    expect(trigger.disabled).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
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

    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
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

  it("keeps option selection working with capture-phase outside observation", async () => {
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

    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
    pointerClick(trigger);
    const author = Array.from(container.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (candidate) => candidate.textContent?.trim() === "Author",
    )!;
    await act(async () => activateSelectOption(author));

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

    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
    act(() => {
      trigger.focus();
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the listbox open when focus moves between AppSelect descendants", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
    act(() => trigger.focus());
    pointerClick(trigger);
    const option = container.querySelector<HTMLElement>('[role="option"]')!;

    act(() => option.focus());

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(option);
  });

  it("respects a newer surface that already owns Escape", () => {
    const { container } = renderSelectWithNeighbors();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="combobox"][aria-label="Sort books"]',
    )!;
    act(() => trigger.focus());
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
