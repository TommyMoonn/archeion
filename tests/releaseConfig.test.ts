import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8")) as T;
}

function cargoPackageField(source: string, field: string): string | undefined {
  const packageSection = source.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? "";
  return packageSection.match(new RegExp(`^${field}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
}

type PackageJson = {
  author?: string;
  description?: string;
  homepage?: string;
  name: string;
  version: string;
};

type PackageLock = {
  packages: Record<string, { name?: string; version?: string }>;
};

type TauriConfig = {
  identifier: string;
  mainBinaryName?: string;
  productName: string;
  version: string;
  app: {
    security: {
      csp: Record<string, string>;
      devCsp?: Record<string, string>;
      freezePrototype?: boolean;
    };
  };
  bundle: {
    publisher?: string;
    targets: string[] | string;
    windows?: {
      nsis?: { installMode?: string };
      webviewInstallMode?: { type?: string };
      wix?: { language?: string; upgradeCode?: string };
    };
  };
};

describe("release configuration", () => {
  const packageJson = readJson<PackageJson>("package.json");
  const packageLock = readJson<PackageLock>("package-lock.json");
  const tauriConfig = readJson<TauriConfig>("src-tauri/tauri.conf.json");
  const cargoToml = fs.readFileSync(path.join(projectRoot, "src-tauri/Cargo.toml"), "utf8");

  it("keeps release versions aligned", () => {
    const versions = [
      packageJson.version,
      packageLock.packages[""].version,
      cargoPackageField(cargoToml, "version"),
      tauriConfig.version,
    ];

    expect(new Set(versions)).toEqual(new Set(["0.1.0"]));
  });

  it("uses finalized package identity and metadata", () => {
    expect(packageJson.name).toBe("archeion");
    expect(packageJson.author).toBe("Khoa Luong");
    expect(packageJson.homepage).toBe("https://tommymoonn.github.io/archeion/");
    expect(packageJson.description).toBeTruthy();
    expect(cargoPackageField(cargoToml, "authors")).toBeUndefined();
    expect(cargoToml).toContain('authors = ["Khoa Luong"]');
    expect(tauriConfig.productName).toBe("Archeion");
    expect(tauriConfig.mainBinaryName).toBe("Archeion");
    expect(tauriConfig.identifier).toBe("com.archeion.desktop");
    expect(tauriConfig.bundle.publisher).toBe("Khoa Luong");
  });

  it("builds both Windows installer formats with stable upgrade behavior", () => {
    expect(tauriConfig.bundle.targets).toEqual(["nsis", "msi"]);
    expect(tauriConfig.bundle.windows?.nsis?.installMode).toBe("currentUser");
    expect(tauriConfig.bundle.windows?.webviewInstallMode?.type).toBe("downloadBootstrapper");
    expect(tauriConfig.bundle.windows?.wix?.language).toBe("en-US");
    expect(tauriConfig.bundle.windows?.wix?.upgradeCode).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("keeps the packaged EPUB reader compatible with local blob resources", () => {
    const productionCsp = tauriConfig.app.security.csp;
    const developmentCsp = tauriConfig.app.security.devCsp;

    expect(productionCsp).toBeTruthy();
    expect(developmentCsp).toBeTruthy();
    expect(productionCsp["script-src"]).toBe("'self'");
    expect(productionCsp["connect-src"]).toContain("blob:");
    expect(productionCsp["style-src"]).toContain("blob:");
    expect(productionCsp["frame-src"]).toContain("blob:");
    expect(productionCsp["worker-src"]).toContain("blob:");
    expect(developmentCsp?.["connect-src"]).toContain("blob:");
    expect(developmentCsp?.["style-src"]).toContain("blob:");
    expect(tauriConfig.app.security.freezePrototype).not.toBe(true);
  });

  it("packages reader font notices and permits local iframe font assets", () => {
    const licensePaths = [
      "public/licenses/fonts/Literata-OFL-1.1.txt",
      "public/licenses/fonts/Atkinson-Hyperlegible-OFL-1.1.txt",
    ];
    const productionCsp = tauriConfig.app.security.csp;
    const developmentCsp = tauriConfig.app.security.devCsp;

    for (const licensePath of licensePaths) {
      const license = fs.readFileSync(path.join(projectRoot, licensePath), "utf8");

      expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }

    expect(productionCsp["font-src"]).toContain("'self'");
    expect(productionCsp["font-src"]).toContain("blob:");
    expect(productionCsp["style-src"]).toContain("'unsafe-inline'");
    expect(developmentCsp?.["font-src"]).toContain("'self'");
    expect(developmentCsp?.["font-src"]).toContain("blob:");
    expect(developmentCsp?.["style-src"]).toContain("'unsafe-inline'");
  });
});
