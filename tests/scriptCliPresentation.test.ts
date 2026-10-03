import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commonScript = path.join(projectRoot, "scripts/Cli.Common.ps1");

function quotePowerShell(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

describe("shared PowerShell CLI presentation", () => {
  it.each(["default", "legacy"])(
    "keeps redirected %s encoding output readable with NO_COLOR",
    (encoding) => {
      const command = [
        "$ErrorActionPreference = 'Stop'",
        "Set-StrictMode -Version Latest",
        ...(encoding === "legacy"
          ? ["[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(437)"]
          : []),
        `. ${quotePowerShell(commonScript)}`,
        "Write-CliHeading -Text 'CLI sample'",
        "Write-CliDetail -Label 'Archive' -Value '/tmp/export.zip' -ValueTone 'Important'",
        "Write-CliDetail -Label 'Unicode' -Value '/tmp/Café-đọc.zip'",
        "Write-CliStatus -Label 'COPY' -Message 'src/file.ts' -Tone 'Important'",
        "Write-CliSuccess -Message 'Done'",
        "Write-CliWarning -Message 'Careful'",
        "Write-CliStep -Message 'Packaging files' -Current 2 -Total 4",
        "Write-CliProgress -Activity 'Packaging' -Status 'Files' -Current 1 -Total 2",
        "Complete-CliProgress -Activity 'Packaging'",
        "Write-Output ('KIB=' + (Format-CliByteSize -Bytes 1024))",
        "Write-Output ('MIB=' + (Format-CliByteSize -Bytes 1048576))",
        "Write-Output ('GIB=' + (Format-CliByteSize -Bytes 1073741824))",
        "Write-Output ('CODEPAGE=' + [Console]::OutputEncoding.CodePage)",
      ].join("; ");

      const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        timeout: 30_000,
        windowsHide: true,
      });
      if (result.error) throw result.error;

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("CLI sample");
      expect(result.stdout).toContain("Archive");
      expect(result.stdout).toContain("/tmp/export.zip");
      expect(result.stdout).toContain("/tmp/Café-đọc.zip");
      expect(result.stdout).toContain("CODEPAGE=65001");
      expect(result.stdout).toContain("COPY");
      expect(result.stdout).toContain("src/file.ts");
      expect(result.stdout).toContain("✓ Done");
      expect(result.stdout).toContain("! Careful");
      expect(result.stdout).toContain("[2/4] Packaging files");
      expect(result.stdout).toContain("KIB=1.0 KiB");
      expect(result.stdout).toContain("MIB=1.0 MiB");
      expect(result.stdout).toContain("GIB=1.00 GiB");
    },
  );
});
