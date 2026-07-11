[CmdletBinding()]
param(
    [string]$BundleRoot,
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

& (Join-Path $PSScriptRoot "check-release.ps1") -ProjectRoot $projectRoot

if ([string]::IsNullOrWhiteSpace($BundleRoot)) {
    $BundleRoot = Join-Path $projectRoot "src-tauri/target/release/bundle"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $projectRoot "artifacts/windows"
}

$packagePath = Join-Path $projectRoot "package.json"
$package = Get-Content -Raw -Path $packagePath | ConvertFrom-Json
$version = [string]$package.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw "package.json does not contain a release version."
}

$nsisDirectory = Join-Path $BundleRoot "nsis"
$msiDirectory = Join-Path $BundleRoot "msi"
$nsisInstallers = @(Get-ChildItem -Path $nsisDirectory -Filter "*-setup.exe" -File -ErrorAction Stop)
$msiInstallers = @(Get-ChildItem -Path $msiDirectory -Filter "*.msi" -File -ErrorAction Stop)

if ($nsisInstallers.Count -ne 1) {
    throw "Expected exactly one NSIS installer in '$nsisDirectory', found $($nsisInstallers.Count)."
}

if ($msiInstallers.Count -ne 1) {
    throw "Expected exactly one MSI installer in '$msiDirectory', found $($msiInstallers.Count)."
}

foreach ($installer in @($nsisInstallers[0], $msiInstallers[0])) {
    if ($installer.Name -notmatch [regex]::Escape($version)) {
        throw "Installer '$($installer.Name)' does not match release version '$version'."
    }
}

if (Test-Path $OutputDirectory) {
    Remove-Item -Path $OutputDirectory -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$stagedFiles = @(
    @{
        Source = $nsisInstallers[0].FullName
        Name = "Archeion_${version}_x64-setup.exe"
    },
    @{
        Source = $msiInstallers[0].FullName
        Name = "Archeion_${version}_x64_en-US.msi"
    }
)

foreach ($file in $stagedFiles) {
    Copy-Item -Path $file.Source -Destination (Join-Path $OutputDirectory $file.Name)
}

$checksumLines = foreach ($file in $stagedFiles) {
    $stagedPath = Join-Path $OutputDirectory $file.Name
    $hash = (Get-FileHash -Path $stagedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($file.Name)"
}

$checksumPath = Join-Path $OutputDirectory "SHA256SUMS.txt"
Set-Content -Path $checksumPath -Value $checksumLines -Encoding ascii

Write-Host "Staged Windows release artifacts in $OutputDirectory"
Get-ChildItem -Path $OutputDirectory -File | Select-Object Name, Length
