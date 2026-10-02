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

test("production command vocabulary matches Rust exactly", () => {
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

test("unclaimed backend registration fails parity", () => {
  const registered = extractRegisteredCommands(rust);
  registered.add("unclaimed_fixture");
  assert.ok(
    compareCommands(extractFrontendCommands(files), registered).includes(
      "Registration has no frontend command: unclaimed_fixture",
    ),
  );
});

test("retired settings commands cannot return on only one side of the contract", () => {
  const frontend = extractFrontendCommands(files);
  const registered = extractRegisteredCommands(rust);
  for (const name of ["load_app_settings", "save_app_settings"]) {
    assert.ok(!frontend.has(name));
    assert.ok(!registered.has(name));
    assert.ok(
      compareCommands(frontend, new Set([...registered, name])).includes(
        `Registration has no frontend command: ${name}`,
      ),
    );
    assert.ok(
      compareCommands(new Set([...frontend, name]), registered).includes(
        `Frontend command is not registered: ${name}`,
      ),
    );
  }
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
