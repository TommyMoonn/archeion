import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTauriDriver } from "../scripts/ensure-tauri-driver.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "archeion-driver-"));
  roots.push(root);
  await mkdir(path.join(root, "bin"));
  const executable = path.join(root, "bin/tauri-driver.exe");
  const receipt = path.join(root, "verified-driver.json");
  await writeFile(executable, "verified executable bytes");
  const sha256 = createHash("sha256")
    .update(await readFile(executable))
    .digest("hex");
  await writeFile(receipt, JSON.stringify({ version: "2.0.6", sha256 }));
  const run = vi.fn(async (command: string, args: string[]) => {
    if (command === "cargo") {
      if (args.includes("--list")) return "tauri-driver v2.0.6:\n    tauri-driver.exe\n";
      await writeFile(executable, "fresh installed bytes");
      return "";
    }
    return "USAGE: tauri-driver [FLAGS] [OPTIONS]\n";
  });
  return { root, executable, receipt, sha256, run };
}

describe("version-verified tauri-driver setup", () => {
  it("reuses matching bytes only after checking Cargo version and launching help", async () => {
    const { root, executable, run } = await fixture();
    await ensureTauriDriver(root, "2.0.6", run);
    expect(run.mock.calls).toEqual([
      ["cargo", ["install", "--list", "--root", root]],
      [executable, ["--help"]],
    ]);
  });

  it.each([
    "missing",
    "wrong version",
    "damaged",
    "invalid receipt",
    "wrong metadata",
    "cannot launch",
  ])("repairs a %s cache entry and verifies the fresh installation", async (state) => {
    const { root, executable, receipt, sha256, run } = await fixture();
    if (state === "missing") await rm(executable);
    if (state === "wrong version")
      await writeFile(receipt, JSON.stringify({ version: "2.0.60", sha256 }));
    if (state === "damaged") await writeFile(executable, "corrupted");
    if (state === "invalid receipt") await writeFile(receipt, "{");
    if (state === "wrong metadata") run.mockResolvedValueOnce("tauri-driver v2.0.60:\n");
    if (state === "cannot launch")
      run
        .mockResolvedValueOnce("tauri-driver v2.0.6:\n")
        .mockRejectedValueOnce(new Error("launch failed"));
    await ensureTauriDriver(root, "2.0.6", run);
    expect(run).toHaveBeenCalledWith(
      "cargo",
      ["install", "tauri-driver", "--version", "=2.0.6", "--locked", "--force", "--root", root],
      { timeout: 900_000 },
    );
    expect(JSON.parse(await readFile(receipt, "utf8"))).toEqual({
      version: "2.0.6",
      sha256: createHash("sha256")
        .update(await readFile(executable))
        .digest("hex"),
    });
    expect(run.mock.calls.slice(-2)).toEqual([
      ["cargo", ["install", "--list", "--root", root]],
      [executable, ["--help"]],
    ]);
  });

  it("fails closed on install failure and wrong installed version", async () => {
    const { root, receipt } = await fixture();
    await rm(receipt);
    const failed = vi.fn().mockRejectedValue(new Error("install failed"));
    await expect(ensureTauriDriver(root, "2.0.6", failed)).rejects.toThrow("install failed");
    const wrong = vi.fn().mockResolvedValue("tauri-driver v2.0.7:\n");
    await expect(ensureTauriDriver(root, "2.0.6", wrong)).rejects.toThrow(
      "Unexpected tauri-driver version",
    );
    await expect(readFile(receipt)).rejects.toThrow();
  });

  it.each(["2", "^2.0.6", "2.0.6-beta", undefined])(
    "rejects non-exact version %s",
    async (version) => {
      const run = vi.fn();
      await expect(ensureTauriDriver("unused", version, run)).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    },
  );
});
