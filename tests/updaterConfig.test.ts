import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
const config = readJson("src-tauri/tauri.conf.json");

describe("updater trust and build configuration", () => {
  it("uses the stable HTTPS endpoint, version binding, and passive installation", () => {
    expect(config.plugins?.updater).toMatchObject({
      endpoints: ["https://github.com/TommyMoonn/archeion/releases/latest/download/latest.json"],
      allowDowngrades: false,
      requireSignedVersion: true,
      windows: { installMode: "passive" },
    });
    expect(config.bundle.windows.allowDowngrades).toBe(false);
    for (const option of [
      "dangerousInsecureTransportProtocol",
      "dangerousAcceptInvalidCerts",
      "dangerousAcceptInvalidHostnames",
    ]) {
      expect(config.plugins.updater[option] ?? false).toBe(false);
    }
  });

  it("tracks a Tauri public key containing only an Ed25519 public key record", () => {
    const publicKey = config.plugins?.updater?.pubkey;
    expect(publicKey).toBeTypeOf("string");
    const decoded = Buffer.from(publicKey, "base64").toString("utf8").trim().split(/\r?\n/);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toMatch(/^untrusted comment: .*public key/i);
    const keyRecord = Buffer.from(decoded[1], "base64");
    expect(keyRecord).toHaveLength(42);
    expect(keyRecord.subarray(0, 2).toString("ascii")).toBe("Ed");
  });

  it("enables signatures only in the explicit release overlay", () => {
    const overlay = readJson("src-tauri/tauri.release.conf.json");
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(overlay).toEqual({
      $schema: "../node_modules/@tauri-apps/cli/config.schema.json",
      bundle: { createUpdaterArtifacts: true },
    });

    const schema = readJson("node_modules/@tauri-apps/cli/config.schema.json");
    const validate = new Ajv({ strict: false, allErrors: true, unicodeRegExp: false }).compile(
      schema,
    );
    expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
    const releaseConfig = { ...config, bundle: { ...config.bundle, ...overlay.bundle } };
    expect(validate(releaseConfig), JSON.stringify(validate.errors)).toBe(true);

    const scripts = readJson("package.json").scripts;
    for (const name of [
      "tauri:build",
      "tauri:build:windows",
      "tauri:build:nsis",
      "tauri:build:msi",
    ]) {
      expect(scripts[name]).not.toMatch(/tauri\.release|TAURI_SIGNING/);
    }
  });

  it("keeps raw updater operations outside WebView capabilities", () => {
    const capabilities = path.join(projectRoot, "src-tauri/capabilities");
    for (const file of fs.readdirSync(capabilities).filter((name) => name.endsWith(".json"))) {
      const capability = JSON.parse(fs.readFileSync(path.join(capabilities, file), "utf8"));
      for (const permission of capability.permissions) {
        const identifier = typeof permission === "string" ? permission : permission.identifier;
        expect(identifier).not.toMatch(/^updater:/);
      }
    }
    expect(readJson("package.json").dependencies).not.toHaveProperty("@tauri-apps/plugin-updater");
  });
});
