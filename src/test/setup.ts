(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, expect } from "vitest";

const originalConsole = { warn: console.warn, error: console.error };
let unexpectedMessages: string[] = [];
beforeEach(() => {
  unexpectedMessages = [];
  for (const level of ["warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      unexpectedMessages.push(`${level}: ${args.map(String).join(" ")}`);
    };
  }
});
afterEach(() => {
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  expect(
    unexpectedMessages,
    "Unexpected console output; assert expected diagnostics in the owning test",
  ).toEqual([]);
});
