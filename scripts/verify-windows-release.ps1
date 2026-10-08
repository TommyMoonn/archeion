#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    'artifacts-dir' = @{ Aliases = @('-ArtifactsDirectory'); Default = (Join-Path $PSScriptRoot "../artifacts/windows") }
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Join-Path $PSScriptRoot '..') }
    'installers-only' = @{ Kind = 'Switch' }
}
if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\verify-windows-release.ps1 [options]

Options:
  --artifacts-dir <path>        Directory containing staged assets.
  -p, --project <path>          Project root for canonical release metadata.
  --installers-only            Verify unsigned manual-build installers, not a release.
  -h, --help                    Show this help.
'@
    return
}
$artifactsDirectory = [IO.Path]::GetFullPath([string]$cli['artifacts-dir'])
if (-not (Test-Path -LiteralPath $artifactsDirectory -PathType Container)) {
    throw "Release artifact directory does not exist: $artifactsDirectory"
}
if ((Get-Item -LiteralPath $artifactsDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Release artifact directory must not be a reparse point."
}
Write-CliHeading "Verify Windows release"
Write-CliStep -Current 1 -Total 3 -Message "Checking expected asset set"
$assetNames = @('Archeion-Setup-x64.exe', 'Archeion-x64.msi')
if (-not $cli['installers-only']) {
    $assetNames = @('Archeion-Setup-x64.exe', 'Archeion-Setup-x64.exe.sig', 'Archeion-x64.msi', 'Archeion-x64.msi.sig', 'latest.json')
}
$expectedNames = @($assetNames + 'SHA256SUMS.txt' | Sort-Object -CaseSensitive)
$items = @(Get-ChildItem -LiteralPath $artifactsDirectory -Force)
$actualNames = @($items | ForEach-Object Name | Sort-Object -CaseSensitive)
if (($actualNames -join "`n") -cne ($expectedNames -join "`n")) {
    throw "Release artifact files do not match the expected asset set."
}
foreach ($item in $items) {
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -eq 0) {
        throw "Release asset must be a nonempty regular file: $($item.Name)"
    }
}
Write-CliStep -Current 2 -Total 3 -Message "Verifying asset checksums"
$checksumPath = Join-Path $artifactsDirectory 'SHA256SUMS.txt'
$checksumLines = @(Get-Content -LiteralPath $checksumPath)
if ($checksumLines.Count -ne $assetNames.Count) {
    throw "SHA256SUMS.txt must contain exactly one checksum for each non-checksum asset."
}
$checksums = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
foreach ($line in $checksumLines) {
    if ($line -cnotmatch '^([0-9a-f]{64})  (.+)$' -or $assetNames -cnotcontains $Matches[2]) {
        throw "SHA256SUMS.txt contains an invalid asset checksum entry."
    }
    $name = $Matches[2]
    if ($checksums.ContainsKey($name)) { throw "SHA256SUMS.txt contains a duplicate checksum for $name." }
    $checksums.Add($name, $Matches[1])
}
foreach ($name in $assetNames) {
    if (-not $checksums.ContainsKey($name)) { throw "SHA256SUMS.txt does not contain a checksum for $name." }
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $artifactsDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -cne $checksums[$name]) { throw "Release asset checksum does not match SHA256SUMS.txt: $name" }
}
Write-CliStep -Current 3 -Total 3 -Message "Verifying update manifest"
if ($cli['installers-only']) {
    Write-CliDetail -Label 'Mode' -Value 'Unsigned manual build; no updater manifest'
} else {
    & node (Join-Path $PSScriptRoot 'windows-update-manifest.mjs') verify --project $cli['project'] --artifacts-dir $artifactsDirectory
    if ($LASTEXITCODE -ne 0) { throw "Windows update manifest verification failed." }
}
Write-CliSuccess "Windows release verified"
foreach ($entry in @(@('EXE', 'Archeion-Setup-x64.exe'), @('MSI', 'Archeion-x64.msi'), @('Checksums', 'SHA256SUMS.txt'))) {
    $item = Get-Item -LiteralPath (Join-Path $artifactsDirectory $entry[1])
    Write-CliDetail -Label $entry[0] -Value "$($item.Name) ($(Format-CliByteSize -Bytes $item.Length))"
}
Write-CliDetail -Label 'Directory' -Value $artifactsDirectory -ValueTone 'Important'
