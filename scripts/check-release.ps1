#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
    tag = @{ Aliases = @('-Tag') }
    'require-changelog' = @{ Kind = 'Switch'; Aliases = @('-RequireChangelogEntry') }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\check-release.ps1 [options]

Options:
  -p, --project <path>          Project root to validate.
  --tag <tag>                   Expected release tag.
  --require-changelog           Require a matching changelog entry.
  -h, --help                    Show this help.

Legacy PowerShell flags remain accepted for compatibility.
'@
    return
}

$ProjectRoot = $cli['project']
$Tag = $cli['tag']
$RequireChangelogEntry = [bool]$cli['require-changelog']

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))
$semVerPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'

function Read-JsonFile {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter()]
        [switch]$AsHashtable
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required release file does not exist: $Path"
    }

    $source = Get-Content -Raw -LiteralPath $Path

    if ($AsHashtable) {
        return $source | ConvertFrom-Json -AsHashtable
    }

    return $source | ConvertFrom-Json
}

function Get-CargoPackageVersion {
    param(
        [Parameter(Mandatory)]
        [string]$Source
    )

    $packageSection = [regex]::Match($Source, '(?ms)^\[package\]\s*(.*?)(?=^\[|\z)')
    if (-not $packageSection.Success) {
        throw "src-tauri/Cargo.toml does not contain a [package] section."
    }

    $versionMatch = [regex]::Match($packageSection.Groups[1].Value, '(?m)^version\s*=\s*"([^"]+)"\s*$')
    if (-not $versionMatch.Success) {
        throw "src-tauri/Cargo.toml does not contain package.version."
    }

    return $versionMatch.Groups[1].Value
}

function Get-CargoLockPackageVersion {
    param(
        [Parameter(Mandatory)]
        [string]$Source
    )

    $packageMatch = [regex]::Match(
        $Source,
        '(?ms)^\[\[package\]\]\s*\r?\nname\s*=\s*"archeion"\s*\r?\nversion\s*=\s*"([^"]+)"'
    )

    if (-not $packageMatch.Success) {
        throw "src-tauri/Cargo.lock does not contain the Archeion package entry."
    }

    return $packageMatch.Groups[1].Value
}

$packagePath = Join-Path $ProjectRoot "package.json"
$packageLockPath = Join-Path $ProjectRoot "package-lock.json"
$cargoTomlPath = Join-Path $ProjectRoot "src-tauri/Cargo.toml"
$cargoLockPath = Join-Path $ProjectRoot "src-tauri/Cargo.lock"
$tauriConfigPath = Join-Path $ProjectRoot "src-tauri/tauri.conf.json"
$changelogPath = Join-Path $ProjectRoot "CHANGELOG.md"

$packageJson = Read-JsonFile -Path $packagePath
$packageLock = Read-JsonFile -Path $packageLockPath -AsHashtable
$tauriConfig = Read-JsonFile -Path $tauriConfigPath
$cargoToml = Get-Content -Raw -LiteralPath $cargoTomlPath
$cargoLock = Get-Content -Raw -LiteralPath $cargoLockPath

$packageLockPackages = $packageLock["packages"]
if ($null -eq $packageLockPackages) {
    throw "package-lock.json does not contain the packages map."
}

$packageLockRoot = $packageLockPackages[""]
if ($null -eq $packageLockRoot) {
    throw "package-lock.json does not contain the root package entry."
}

$versions = [ordered]@{
    "package.json" = [string]$packageJson.version
    "package-lock.json" = [string]$packageLockRoot["version"]
    "src-tauri/Cargo.toml" = Get-CargoPackageVersion -Source $cargoToml
    "src-tauri/Cargo.lock" = Get-CargoLockPackageVersion -Source $cargoLock
    "src-tauri/tauri.conf.json" = [string]$tauriConfig.version
}

foreach ($entry in $versions.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($entry.Value)) {
        throw "$($entry.Key) does not contain a release version."
    }

    if ($entry.Value -notmatch $semVerPattern) {
        throw "$($entry.Key) contains an invalid semantic version: $($entry.Value)"
    }
}

$version = $versions["package.json"]
$mismatches = @($versions.GetEnumerator() | Where-Object Value -ne $version)
if ($mismatches.Count -gt 0) {
    $details = $versions.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }
    throw "Release versions are not aligned: $($details -join ', ')"
}

$effectiveTag = $Tag
if ([string]::IsNullOrWhiteSpace($effectiveTag) -and $env:GITHUB_REF_TYPE -eq "tag") {
    $effectiveTag = $env:GITHUB_REF_NAME
}

if (-not [string]::IsNullOrWhiteSpace($effectiveTag)) {
    $expectedTag = "v$version"
    if ($effectiveTag -ne $expectedTag) {
        throw "Release tag '$effectiveTag' does not match version '$version'. Expected '$expectedTag'."
    }
}

if ($RequireChangelogEntry) {
    if (-not (Test-Path -LiteralPath $changelogPath -PathType Leaf)) {
        throw "CHANGELOG.md is required for a release."
    }

    $changelog = Get-Content -Raw -LiteralPath $changelogPath
    $escapedVersion = [regex]::Escape($version)
    $headingPattern = "(?m)^## \[$escapedVersion\] - \d{4}-\d{2}-\d{2}\s*$"
    $linkPattern = "(?m)^\[$escapedVersion\]:\s+\S+\s*$"

    if ($changelog -notmatch $headingPattern) {
        throw "CHANGELOG.md does not contain a dated [$version] release section."
    }

    if ($changelog -notmatch $linkPattern) {
        throw "CHANGELOG.md does not contain a [$version] comparison link."
    }
}

Write-Host "Release configuration is valid."
Write-Host "Version: $version"
if (-not [string]::IsNullOrWhiteSpace($effectiveTag)) {
    Write-Host "Tag:     $effectiveTag"
}
