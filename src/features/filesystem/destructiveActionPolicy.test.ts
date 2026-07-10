import { describe, expect, it } from "vitest";

import {
  shouldConfirmBookDeletion,
  shouldConfirmFolderDeletion,
  shouldConfirmImportReplace,
} from "./destructiveActionPolicy";

describe("destructive file action policy", () => {
  it("follows the preference for EPUB and folder deletion", () => {
    expect(shouldConfirmBookDeletion(true, false)).toBe(true);
    expect(shouldConfirmBookDeletion(false, false)).toBe(false);
    expect(shouldConfirmFolderDeletion(true)).toBe(true);
    expect(shouldConfirmFolderDeletion(false)).toBe(false);
  });

  it("keeps missing-file metadata removal confirmed", () => {
    expect(shouldConfirmBookDeletion(false, true)).toBe(true);
  });

  it("confirms only replacement imports when enabled", () => {
    expect(shouldConfirmImportReplace(true, "replace")).toBe(true);
    expect(shouldConfirmImportReplace(false, "replace")).toBe(false);
    expect(shouldConfirmImportReplace(true, "keepBoth")).toBe(false);
  });
});
