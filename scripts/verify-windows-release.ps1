#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    'artifacts-dir' = @{ Aliases = @('-ArtifactsDirectory'); Default = (Join-Path $PSScriptRoot "../artifacts/windows") }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\verify-windows-release.ps1 [options]

Options:
  --artifacts-dir <path>        Directory containing the staged release assets.
  -h, --help                    Show this help.
'@
    return
}

$artifactsDirectory = [System.IO.Path]::GetFullPath([string]$cli['artifacts-dir'])
if (-not (Test-Path -LiteralPath $artifactsDirectory -PathType Container)) {
    throw "Release artifact directory does not exist: $artifactsDirectory"
}

Write-CliHeading "Verify Windows release"
Write-CliStep -Current 1 -Total 2 -Message "Checking expected asset set"

$installerNames = @('Archeion-Setup-x64.exe', 'Archeion-x64.msi')
$expectedNames = @($installerNames + 'SHA256SUMS.txt' | Sort-Object)
$actualNames = @(Get-ChildItem -LiteralPath $artifactsDirectory | ForEach-Object Name | Sort-Object)
if (($actualNames -join "`n") -ne ($expectedNames -join "`n")) {
    throw "Release artifact files do not match the expected installers and checksum manifest."
}

Write-CliStep -Current 2 -Total 2 -Message "Verifying installer checksums"

$checksumPath = Join-Path $artifactsDirectory 'SHA256SUMS.txt'
$checksumLines = @(Get-Content -LiteralPath $checksumPath)
if ($checksumLines.Count -ne $installerNames.Count) {
    throw "SHA256SUMS.txt must contain exactly one checksum for each installer."
}

$checksums = @{}
foreach ($line in $checksumLines) {
    if ($line -notmatch '^([0-9a-f]{64})  (Archeion-Setup-x64\.exe|Archeion-x64\.msi)$') {
        throw "SHA256SUMS.txt contains an invalid installer checksum entry."
    }

    $name = $Matches[2]
    if ($checksums.ContainsKey($name)) {
        throw "SHA256SUMS.txt contains a duplicate checksum for $name."
    }
    $checksums[$name] = $Matches[1]
}

foreach ($name in $installerNames) {
    if (-not $checksums.ContainsKey($name)) {
        throw "SHA256SUMS.txt does not contain a checksum for $name."
    }

    $installerPath = Join-Path $artifactsDirectory $name
    if ((Get-Item -LiteralPath $installerPath).Length -eq 0) {
        throw "Release installer is empty: $name"
    }

    $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $checksums[$name]) {
        throw "Release installer checksum does not match SHA256SUMS.txt: $name"
    }
}

$verifiedExe = Get-Item -LiteralPath (Join-Path $artifactsDirectory 'Archeion-Setup-x64.exe')
$verifiedMsi = Get-Item -LiteralPath (Join-Path $artifactsDirectory 'Archeion-x64.msi')
$verifiedChecksums = Get-Item -LiteralPath $checksumPath

Write-CliSuccess "Windows release verified"
Write-CliDetail -Label "EXE" -Value "$($verifiedExe.Name) ($(Format-CliByteSize -Bytes $verifiedExe.Length))"
Write-CliDetail -Label "MSI" -Value "$($verifiedMsi.Name) ($(Format-CliByteSize -Bytes $verifiedMsi.Length))"
Write-CliDetail -Label "Checksums" -Value "$($verifiedChecksums.Name) ($(Format-CliByteSize -Bytes $verifiedChecksums.Length))"
Write-CliDetail -Label "Directory" -Value $artifactsDirectory -ValueTone 'Important'
