import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runWindowsCommand } from "./windows-smoke-support.mjs";

export async function ensureTauriDriver(root, version, run = runWindowsCommand) {
  assert.match(version, /^\d+\.\d+\.\d+$/, "Expected an exact tauri-driver version");
  const executable = path.join(root, "bin/tauri-driver.exe");
  const receiptPath = path.join(root, "verified-driver.json");
  const digest = async () =>
    createHash("sha256")
      .update(await readFile(executable))
      .digest("hex");
  const verifyInstalled = async () => {
    // tauri-driver 2.0.6 has no --version flag. Cargo owns the installed version
    // metadata; the receipt binds that verified installation to these exact bytes.
    const output = await run("cargo", ["install", "--list", "--root", root]);
    assert.ok(
      output.split(/\r?\n/).includes(`tauri-driver v${version}:`),
      "Unexpected tauri-driver version",
    );
    const help = await run(executable, ["--help"]);
    assert.ok(help.includes("USAGE: tauri-driver"), "Unexpected tauri-driver executable");
  };
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(receipt.version, version, "Unexpected cached tauri-driver version");
    assert.equal(receipt.sha256, await digest(), "Cached tauri-driver hash mismatch");
    await verifyInstalled();
    return;
  } catch {
    // Missing, damaged, or mismatched cache entries must go through a fresh install.
  }
  await run(
    "cargo",
    ["install", "tauri-driver", "--version", `=${version}`, "--locked", "--force", "--root", root],
    { timeout: 15 * 60_000 },
  );
  await verifyInstalled();
  await writeFile(receiptPath, JSON.stringify({ version, sha256: await digest() }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ensureTauriDriver(
    path.resolve(import.meta.dirname, "../.scratch/runtime-smoke-tools"),
    process.env.TAURI_DRIVER_VERSION,
  );
}
