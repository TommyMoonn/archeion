import { describe, expect, it, vi } from "vitest";

import { createArchiveContextActions } from "./archiveContextActions";

describe("createArchiveContextActions", () => {
  it("preserves archive wording, danger state, callbacks, and disabled conditions", () => {
    const onForget = vi.fn();
    const onReveal = vi.fn();
    const onRename = vi.fn();
    const actions = createArchiveContextActions({
      disabled: true,
      onForget,
      onReveal,
      onRename,
    });

    expect(actions.map((action) => action.label)).toEqual(["Rename", "Reveal in folder", "Forget"]);
    expect(actions.every((action) => action.disabled)).toBe(true);
    expect(actions.at(-1)?.danger).toBe(true);

    for (const action of actions) action.onSelect();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onForget).toHaveBeenCalledTimes(1);
  });
});
