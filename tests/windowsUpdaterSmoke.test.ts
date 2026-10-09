import { afterEach, describe, expect, it, vi } from "vitest";
import { listOwnedApplications, stopOwnedApplications } from "../scripts/runtime-smoke-cleanup.mjs";
import {
  assertBundlePrivileges,
  createSmokeOverlay,
  selectSmokeBundleFiles,
  startUpdateFixture,
} from "../scripts/windows-updater-fixture.mjs";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const options = {
  nonce: "0123456789abcdef",
  publicKey: "ephemeral public key",
  endpoint: "http://127.0.0.1:4567/manifest/{{bundle_type}}",
  version: "1.6.0",
  installDirectory: "C:/isolated/run-0123456789abcdef/installed",
  upgradeCode: "e7a59e34-a6b1-443a-bc87-c9cb4be05cc5",
  windows: [{ title: "Archeion", width: 1280, height: 800, visible: false }],
};

describe("isolated Windows updater fixtures", () => {
  it("collects exact owned partial-build bundles without matching ordinary or prior-run files", () => {
    const owned = [
      "Archeion Updater Smoke 0123456789abcdef_1.6.0_x64-setup.exe",
      "Archeion Updater Smoke 0123456789abcdef_1.6.0_x64-setup.exe.sig",
      "Archeion Updater Smoke 0123456789abcdef_1.6.1_x64_en-US.msi",
    ];
    const unrelated = [
      "Archeion_1.6.0_x64-setup.exe",
      "Archeion Updater Smoke fedcba9876543210_1.6.0_x64-setup.exe",
      "Archeion Updater Smoke 0123456789abcdef_1.6.0_x64-setup.exe.backup",
      "Archeion Updater Smoke 0123456789abcdef_1.6.2_x64_en-US.msi",
      "../Archeion Updater Smoke 0123456789abcdef_1.6.0_x64-setup.exe",
    ];
    expect(selectSmokeBundleFiles([...owned, ...unrelated], options.nonce)).toEqual(owned);
    expect(() => selectSmokeBundleFiles(owned, "../ordinary")).toThrow(/identity/);
  });
  it("stops only an exact installed path and process creation identity", async () => {
    const application = "C:/isolated/run-0123456789abcdef/installed/ArcheionUpdaterSmoke.exe";
    const owned = { ProcessId: 42, ExecutablePath: application, StartedAt: "2030-01-01T00:00:01Z" };
    const normal = {
      ProcessId: 99,
      ExecutablePath: "C:/normal/Archeion.exe",
      StartedAt: owned.StartedAt,
    };
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce([owned, normal])
      .mockResolvedValueOnce([owned, normal])
      .mockResolvedValue([normal]);
    const terminate = vi.fn().mockResolvedValue(undefined);
    await stopOwnedApplications(application, Date.parse("2030-01-01T00:00:00Z"), {
      snapshot,
      terminate,
    });
    expect(terminate.mock.calls).toEqual([[42]]);
  });
  it("does not terminate a PID reused by a process with a different creation time", async () => {
    const application = "C:/isolated/ArcheionUpdaterSmoke.exe";
    const old = { ProcessId: 42, ExecutablePath: application, StartedAt: "2030-01-01T00:00:01Z" };
    const reused = { ...old, StartedAt: "2030-01-01T00:00:02Z" };
    const snapshot = vi.fn().mockResolvedValueOnce([old]).mockResolvedValue([reused]);
    const terminate = vi.fn();
    let time = 0;
    await expect(
      stopOwnedApplications(application, 0, {
        snapshot,
        terminate,
        wait: async () => {},
        now: () => (time += 6000),
      }),
    ).rejects.toThrow(/did not exit/);
    expect(terminate).not.toHaveBeenCalled();
    await expect(
      listOwnedApplications(application, 0, async () => [{ ...old, StartedAt: null }]),
    ).rejects.toThrow(/creation time/);
  });
  it("keeps test identity, loopback allowance and version binding in an explicit overlay", () => {
    expect(() => assertBundlePrivileges(["nsis"], false)).not.toThrow();
    expect(() => assertBundlePrivileges(["nsis", "msi"], true)).not.toThrow();
    expect(() => assertBundlePrivileges(["msi"], false)).toThrow(/elevated/);
    const overlay = createSmokeOverlay(options);
    expect(overlay.identifier).toBe("com.archeion.desktop.updatersmoke.r0123456789abcdef");
    expect(overlay.version).toBe("1.6.0");
    expect(overlay.bundle.windows.wix.upgradeCode).toBe(options.upgradeCode);
    expect(overlay.plugins.updater).toMatchObject({
      endpoints: [options.endpoint],
      pubkey: options.publicKey,
      requireSignedVersion: true,
      allowDowngrades: false,
      dangerousInsecureTransportProtocol: true,
      windows: { installMode: "passive" },
    });
    expect(overlay.plugins.updater.windows).not.toHaveProperty("installerArgs");
    expect(overlay.bundle.createUpdaterArtifacts).toBe(true);
  });
  it("configures elevated automation through the test WebView API without mutating source windows", () => {
    const original = structuredClone(options.windows);
    const overlay = createSmokeOverlay(options);
    expect(options.windows).toEqual(original);
    expect(overlay.app.windows).toEqual([
      {
        ...original[0],
        additionalBrowserArgs: "--remote-debugging-address=127.0.0.1 --remote-debugging-port=0",
      },
    ]);
    expect(() => createSmokeOverlay({ ...options, windows: [] })).toThrow(/main window/);
  });
  it.each([
    "http://localhost:4567/manifest/{{bundle_type}}",
    "http://example.com/manifest/{{bundle_type}}",
    "https://github.com/TommyMoonn/archeion/releases/latest/download/latest.json",
    "http://127.0.0.1:4567/manifest/{{bundle_type}}?extra",
  ])("rejects an endpoint outside the exact controlled fixture: %s", (endpoint) => {
    expect(() => createSmokeOverlay({ ...options, endpoint })).toThrow(/endpoint/);
  });
  it("refuses non-isolated identity and reused production upgrade identity", () => {
    expect(() => createSmokeOverlay({ ...options, nonce: "desktop" })).toThrow(/identity/);
    expect(() =>
      createSmokeOverlay({ ...options, upgradeCode: "dd33f41c-13de-58f4-a67c-28ffd4482b07" }),
    ).toThrow(/upgrade identity/);
  });
  it("serves both bundle-specific entries and rejects traversal or unknown resources", async () => {
    const fixture = await startUpdateFixture({
      nsis: { bytes: Buffer.from("NSIS installer"), signature: "NSIS signature" },
      msi: { bytes: Buffer.from("MSI installer"), signature: "MSI signature" },
    });
    cleanups.push(fixture.close);
    const response = await fetch(`${fixture.origin}/manifest/nsis`);
    const manifest = await response.json();
    expect(Object.keys(manifest.platforms).sort()).toEqual([
      "windows-x86_64-msi",
      "windows-x86_64-nsis",
    ]);
    expect(manifest.version).toBe("1.6.1");
    expect(manifest.platforms["windows-x86_64-nsis"].signature).toBe("NSIS signature");
    expect(await (await fetch(manifest.platforms["windows-x86_64-msi"].url)).text()).toBe(
      "MSI installer",
    );
    expect((await fetch(`${fixture.origin}/manifest/unknown`)).status).toBe(404);
    expect((await fetch(`${fixture.origin}/private.key`)).status).toBe(404);
    expect((await fetch(`${fixture.origin}/manifest/nsis`, { method: "POST" })).status).toBe(405);
  });
  it("bad-signature changes payload bytes; wrong-version changes only the announced version", async () => {
    const bytes = Buffer.from("real installer bytes");
    const fixture = await startUpdateFixture({
      nsis: { bytes, signature: "signed for 1.6.1" },
      msi: { bytes, signature: "signed for 1.6.1" },
    });
    cleanups.push(fixture.close);
    fixture.setMode("bad-signature");
    let manifest = await (await fetch(`${fixture.origin}/manifest/nsis`)).json();
    const altered = Buffer.from(
      await (await fetch(manifest.platforms["windows-x86_64-nsis"].url)).arrayBuffer(),
    );
    expect(altered).not.toEqual(bytes);
    expect(manifest.platforms["windows-x86_64-nsis"].signature).toBe("signed for 1.6.1");
    fixture.setMode("wrong-version");
    manifest = await (await fetch(`${fixture.origin}/manifest/msi`)).json();
    expect(manifest.version).toBe("1.6.2");
    expect(
      Buffer.from(await (await fetch(manifest.platforms["windows-x86_64-msi"].url)).arrayBuffer()),
    ).toEqual(bytes);
    fixture.setMode("valid");
    expect((await (await fetch(`${fixture.origin}/manifest/msi`)).json()).version).toBe("1.6.1");
    expect(() => fixture.setMode("downgrade")).toThrow(/fixture mode/);
  });
});
