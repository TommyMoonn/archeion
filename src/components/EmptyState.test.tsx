// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Heart } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { SeriesOverview } from "../features/series/SeriesOverview";

afterEach(() => {
  document.body.innerHTML = "";
});

it("keeps contextual artwork decorative and preserves the empty destination action", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const activate = vi.fn();
  act(() =>
    root.render(
      <EmptyState
        title="No favorites yet"
        description="Mark books as favorites."
        icon={<Heart />}
        action={<button onClick={activate}>Browse Library</button>}
      />,
    ),
  );
  expect(host.querySelector("h2")?.textContent).toBe("No favorites yet");
  expect(host.querySelector(".empty-state__icon")?.getAttribute("aria-hidden")).toBe("true");
  expect(host.querySelector(".empty-state__glow")).toBeNull();
  act(() => host.querySelector("button")!.click());
  expect(activate).toHaveBeenCalledOnce();
  act(() => root.unmount());
});

it("renders unmatched Series as text-only and preserves Clear search", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const clear = vi.fn();
  act(() =>
    root.render(
      <SeriesOverview
        cardSize="medium"
        entries={[
          {
            key: "fixture",
            displayName: "Synthetic series",
            books: [],
            completedCount: 0,
            startedCount: 0,
            missingVolumeHints: [],
            duplicateVolumeHints: [],
          },
        ]}
        isLoading={false}
        onClearSearch={clear}
        onOpen={() => {}}
        onQueryChange={() => {}}
        onSortChange={() => {}}
        onViewChange={() => {}}
        query="unmatched"
        sort="title"
        view="grid"
      />,
    ),
  );
  const empty = host.querySelector(".empty-state")!;
  expect(empty.querySelector("h2")?.textContent).toBe("No matching series");
  expect(empty.querySelector("svg")).toBeNull();
  act(() => empty.querySelector<HTMLButtonElement>("button")!.click());
  expect(clear).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
