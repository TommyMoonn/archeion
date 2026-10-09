import assert from "node:assert/strict";
import http from "node:http";

export function assertBundlePrivileges(families, isAdministrator) {
  assert.ok(
    !families.includes("msi") || isAdministrator,
    "The normal MSI fixture requires an elevated Windows administrator token. " +
      "Rerun from an elevated terminal; --bundle nsis is diagnostic coverage only.",
  );
}

/** Exact generated names, including partial-build artifacts that lack signatures. */
export function selectSmokeBundleFiles(names, nonce) {
  assert.match(nonce, /^[a-f0-9]{16}$/, "Invalid updater smoke identity");
  const pattern = new RegExp(
    `^Archeion Updater Smoke ${nonce}_1\\.6\\.[01]_x64(?:-setup\\.exe|_en-US\\.msi)(?:\\.sig)?$`,
  );
  return names.filter((name) => pattern.test(name));
}

/** Build-only test overlay. Never write these allowances into the production configuration. */
export function createSmokeOverlay({ nonce, publicKey, endpoint, version, upgradeCode, windows }) {
  assert.match(nonce, /^[a-f0-9]{16}$/, "Invalid updater smoke identity");
  assert.match(upgradeCode, /^[a-f0-9-]{36}$/i, "Invalid updater upgrade identity");
  assert.notEqual(
    upgradeCode.toLowerCase(),
    "dd33f41c-13de-58f4-a67c-28ffd4482b07",
    "Refusing the production MSI upgrade identity",
  );
  assert.ok(publicKey, "An ephemeral public key is required");
  assert.ok(["1.6.0", "1.6.1"].includes(version), "Invalid synthetic updater version");
  assert.ok(Array.isArray(windows) && windows.length === 1, "Expected one source main window");
  const url = new URL(endpoint);
  assert.ok(
    url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      decodeURIComponent(url.pathname) === "/manifest/{{bundle_type}}",
    "Updater smoke endpoint must be the controlled loopback fixture",
  );
  return {
    productName: `Archeion Updater Smoke ${nonce}`,
    mainBinaryName: "ArcheionUpdaterSmoke",
    identifier: `com.archeion.desktop.updatersmoke.r${nonce}`,
    version,
    app: {
      withGlobalTauri: true,
      windows: windows.map((window) => ({
        ...window,
        // Elevated WebView2 ignores driver environment overrides. Supply its
        // loopback-only, ephemeral debugging port through the WebView API instead.
        additionalBrowserArgs: "--remote-debugging-address=127.0.0.1 --remote-debugging-port=0",
      })),
    },
    build: { beforeBuildCommand: "" },
    bundle: {
      createUpdaterArtifacts: true,
      publisher: "Archeion Smoke",
      windows: {
        wix: { upgradeCode },
        nsis: { installMode: "currentUser" },
      },
    },
    plugins: {
      updater: {
        endpoints: [endpoint],
        pubkey: publicKey,
        requireSignedVersion: true,
        allowDowngrades: false,
        dangerousInsecureTransportProtocol: true,
        windows: { installMode: "passive" },
      },
    },
  };
}

/** Exact in-memory routes only: the local server cannot expose signing files or repository paths. */
export async function startUpdateFixture(artifacts = null) {
  let mode = "valid";
  let candidate = artifacts;
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: request.url, mode });
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") return response.writeHead(405).end();
    const bundle = /^\/manifest\/(nsis|msi)$/.exec(request.url)?.[1];
    if (bundle && candidate) {
      const origin = `http://127.0.0.1:${server.address().port}`;
      const platforms = Object.fromEntries(
        ["nsis", "msi"].map((family) => [
          `windows-x86_64-${family}`,
          {
            url: `${origin}/artifact/${mode}/${family}`,
            signature: candidate[family].signature,
          },
        ]),
      );
      response.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          version: mode === "wrong-version" ? "1.6.2" : "1.6.1",
          notes: "Isolated updater smoke fixture.",
          pub_date: "2026-10-08T00:00:00Z",
          platforms,
        }),
      );
      return;
    }
    const artifact = /^\/artifact\/(valid|bad-signature|wrong-version)\/(nsis|msi)$/.exec(
      request.url,
    );
    if (artifact && candidate) {
      const bytes = Buffer.from(candidate[artifact[2]].bytes);
      if (artifact[1] === "bad-signature") bytes[Math.floor(bytes.length / 2)] ^= 1;
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": bytes.length,
      });
      response.end(bytes);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    setArtifacts(value) {
      for (const family of ["nsis", "msi"]) {
        assert.ok(value[family].bytes.length > 0 && value[family].signature.trim());
      }
      candidate = value;
    },
    setMode(value) {
      assert.ok(
        ["valid", "bad-signature", "wrong-version"].includes(value),
        "Invalid fixture mode",
      );
      mode = value;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
