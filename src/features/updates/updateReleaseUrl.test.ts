import { describe, expect, it } from "vitest";
import { updateReleaseUrl } from "./updateReleaseUrl";
describe("Updater release links", () => {
  it.each(["1.6.0", "1.6.1", "12.34.56"])(
    "uses the deterministic documentation anchor for %s",
    (version) => {
      expect(updateReleaseUrl(version)).toBe(
        `https://tommymoonn.github.io/archeion/documentation/changelog/#release-${version.replaceAll(".", "-")}`,
      );
    },
  );
  it.each(["javascript:alert(1)", "https://untrusted.test", "1.6.1#anything", "", "../"])(
    "never uses metadata as an arbitrary URL: %s",
    (version) => {
      expect(updateReleaseUrl(version)).toBe(
        "https://tommymoonn.github.io/archeion/documentation/changelog/",
      );
    },
  );
});
