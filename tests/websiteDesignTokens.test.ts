import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const css = read("website/src/css/custom.css");

describe("website design foundation", () => {
  it.each(["dark", "light"])(
    "preserves the approved %s brand palette in semantic roles",
    (theme) => {
      const manifest: unknown = JSON.parse(read(`themes/built-in/archeion-${theme}/theme.json`));
      if (
        typeof manifest !== "object" ||
        manifest === null ||
        !("app" in manifest) ||
        typeof manifest.app !== "object" ||
        manifest.app === null
      ) {
        throw new Error("Expected the finalized application palette");
      }
      const block = css.match(
        theme === "dark" ? /:root \{([^}]+)\}/ : /:root\[data-theme="light"\] \{([^}]+)\}/,
      )?.[1];
      expect(block).toBeDefined();
      const declarations = new Map(
        [...String(block).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [
          match[1],
          match[2].toLowerCase(),
        ]),
      );
      for (const [role, source] of Object.entries({
        surface: "canvas",
        "surface-raised": "surface",
        "surface-sunken": "canvasDeep",
        "surface-overlay": "surfaceRaised",
        "surface-article": "main",
        "surface-article-raised": "mainRaised",
        content: "text",
        "content-strong": "textStrong",
        "content-muted": "muted",
        "content-subtle": "mutedSoft",
        border: "line",
        "border-strong": "lineStrong",
        "border-focus": "focus",
        accent: "accent",
        "accent-hover": "accentStrong",
        success: "success",
        warning: "warning",
        danger: "error",
        info: "info",
        control: "surface",
        "control-hover": "surfaceHover",
      })) {
        const expected = Reflect.get(manifest.app, source);
        expect(typeof expected).toBe("string");
        expect(declarations.get(role), role).toBe(String(expected).toLowerCase());
        expect(css).toContain(`--color-${role}: var(--${role});`);
      }
      // The approved website deliberately differs from the desktop light sidebar.
      expect(declarations.get("surface-sidebar")).toBe(theme === "light" ? "#f7f8f7" : "#0a0a0b");
    },
  );

  it("consumes unchanged approved artwork, fonts, and licenses", () => {
    for (const theme of ["dark", "light"]) {
      const name = `archeion-logo-${theme}.png`;
      expect(
        fs
          .readFileSync(path.join(root, `website/src/assets/brand/${name}`))
          .equals(fs.readFileSync(path.join(root, `src/assets/brand/${name}`))),
      ).toBe(true);
    }
    for (const name of ["inter-regular", "inter-semibold", "inter-bold", "literata-regular"]) {
      expect(
        fs
          .readFileSync(path.join(root, `website/src/assets/fonts/${name}.woff2`))
          .equals(fs.readFileSync(path.join(root, `docs/assets/fonts/${name}.woff2`))),
      ).toBe(true);
    }
    for (const family of ["Inter", "Literata"]) {
      const name = `${family}-OFL-1.1.txt`;
      expect(read(`website/static/licenses/fonts/${name}`)).toBe(
        read(`public/licenses/fonts/${name}`),
      );
    }
  });
});
