import { describe, expect, it } from "vitest";
import {
  defaultReaderSettings,
  normalizeReaderFontSelection,
  normalizeReaderSettings,
  readerFontSelectionsEqual,
} from "./reader";

describe("Reader font selection contract", () => {
  it.each(["serif", "sans", "system", "literata", "atkinson"])(
    "migrates legacy %s without changing the preset",
    (id) => {
      expect(normalizeReaderFontSelection(id)).toEqual({ kind: "builtin", id });
      expect(normalizeReaderFontSelection({ kind: "builtin", id })).toEqual({
        kind: "builtin",
        id,
      });
    },
  );

  it.each([
    "obsolete",
    null,
    [],
    {},
    { kind: "builtin", id: "obsolete" },
    { kind: "system", family: 42 },
    { kind: "system", family: "\tArial" },
    { kind: "system", family: "bad\ud800" },
    { kind: "system", family: "𐐀".repeat(257) },
  ])("defaults malformed selection %j", (value) => {
    expect(normalizeReaderFontSelection(value)).toEqual(defaultReaderSettings.fontFamily);
  });

  it("retains valid unavailable families and emits no legacy string on round trip", () => {
    const settings = normalizeReaderSettings({
      fontFamily: { kind: "system", family: '  Missing 日本語, Book "One" \\ Serif  ' },
    });
    expect(settings.fontFamily).toEqual({
      kind: "system",
      family: 'Missing 日本語, Book "One" \\ Serif',
    });
    expect(normalizeReaderSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    expect(readerFontSelectionsEqual(settings.fontFamily, { ...settings.fontFamily })).toBe(true);
    expect(readerFontSelectionsEqual(settings.fontFamily, { kind: "builtin", id: "system" })).toBe(
      false,
    );
  });
});
