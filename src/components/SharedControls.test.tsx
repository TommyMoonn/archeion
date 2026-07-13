// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
});

describe("AppSelect dismissal", () => {
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
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
