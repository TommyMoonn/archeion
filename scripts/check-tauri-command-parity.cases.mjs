import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareCommands,
  extractFrontendCommands,
  extractRegisteredCommands,
  readProductionFiles,
} from "./check-tauri-command-parity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = readProductionFiles(root);
const rust = fs.readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");

test("production command vocabulary matches Rust except scheduled legacy commands", () => {
  const frontend = extractFrontendCommands(files);
  const registered = extractRegisteredCommands(rust);
  assert.deepEqual(compareCommands(frontend, registered), []);
});

test("a new frontend command must have a Rust registration", () => {
  const changed = {
    ...files,
    "src/stores/archiveStore.ts": `${files["src/stores/archiveStore.ts"]}\nvoid invoke("unregistered_fixture");\n`,
  };
  const errors = compareCommands(extractFrontendCommands(changed), extractRegisteredCommands(rust));
  assert.ok(errors.includes("Frontend command is not registered: unregistered_fixture"));
});

test("aliased Tauri invoke imports participate in the parity check", () => {
  const file = "src/stores/archiveStore.ts";
  const changed = {
    ...files,
    [file]: `${files[file]}\nimport { invoke as callNative } from "@tauri-apps/api/core";\nvoid callNative("unregistered_fixture");\n`,
  };
  const errors = compareCommands(extractFrontendCommands(changed), extractRegisteredCommands(rust));
  assert.ok(errors.includes("Frontend command is not registered: unregistered_fixture"));
});

test("typed command map keys participate in the parity check", () => {
  const file = "src/storage/tauri/archiveCommandClient.ts";
  const changed = {
    ...files,
    [file]: files[file].replace("  scan_archive:", "  unregistered_fixture:"),
  };
  const errors = compareCommands(extractFrontendCommands(changed), extractRegisteredCommands(rust));
  assert.ok(errors.includes("Frontend command is not registered: unregistered_fixture"));
});

test("archive registry's dynamic commands participate through the typed union", () => {
  const file = "src/stores/archiveStore.ts";
  const changed = {
    ...files,
    [file]: files[file].replace(
      'command: "create_empty_archive"',
      'command: "unregistered_fixture"',
    ),
  };
  const errors = compareCommands(extractFrontendCommands(changed), extractRegisteredCommands(rust));
  assert.ok(errors.includes("Frontend command is not registered: unregistered_fixture"));
});

test("an unclassified dynamic invoke cannot evade extraction", () => {
  const file = "src/stores/archiveStore.ts";
  const changed = { ...files, [file]: `${files[file]}\nvoid invoke(variableCommand);\n` };
  assert.throws(() => extractFrontendCommands(changed), /Unclassified dynamic invoke/);
});

test("backend-only registration needs an explicit exception", () => {
  const registered = extractRegisteredCommands(rust);
  registered.add("unclaimed_fixture");
  assert.ok(
    compareCommands(extractFrontendCommands(files), registered).includes(
      "Registration has no frontend command: unclaimed_fixture",
    ),
  );
});

test("legacy exceptions fail if removed or used by the frontend", () => {
  const frontend = extractFrontendCommands(files);
  const registered = extractRegisteredCommands(rust);
  registered.delete("load_app_settings");
  assert.ok(
    compareCommands(frontend, registered).includes(
      "Stale backend-only exception: load_app_settings",
    ),
  );
  frontend.add("save_app_settings");
  assert.ok(
    compareCommands(frontend, registered).includes(
      "Backend-only exception now has a frontend caller: save_app_settings",
    ),
  );
});

test("malformed or duplicated Rust registrations fail extraction", () => {
  assert.throws(
    () =>
      extractRegisteredCommands(
        "tauri::generate_handler![commands::archive::open_archive, unexpected]",
      ),
    /Unrecognized Tauri registration/,
  );
  assert.throws(
    () =>
      extractRegisteredCommands(
        "tauri::generate_handler![commands::archive::open_archive, commands::archive::open_archive]",
      ),
    /Duplicate Tauri registration/,
  );
});
