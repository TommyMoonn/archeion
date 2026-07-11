#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$')]
    [string]$Version,

    [Parameter()]
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))

function Set-FirstRegexValue {
    param(
        [Parameter(Mandatory)]
        [string]$Source,

        [Parameter(Mandatory)]
        [regex]$Pattern,

        [Parameter(Mandatory)]
        [string]$Value,

        [Parameter(Mandatory)]
        [string]$Description
    )

    $match = $Pattern.Match($Source)
    if (-not $match.Success) {
        throw "Unable to locate $Description."
    }

    return $Pattern.Replace(
        $Source,
        { param($current) "$($current.Groups[1].Value)$Value$($current.Groups[2].Value)" },
        1
    )
}

foreach ($command in @("npm", "cargo")) {
    if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is not available: $command"
    }
}

$paths = [ordered]@{
    Package = Join-Path $ProjectRoot "package.json"
    PackageLock = Join-Path $ProjectRoot "package-lock.json"
    CargoToml = Join-Path $ProjectRoot "src-tauri/Cargo.toml"
    CargoLock = Join-Path $ProjectRoot "src-tauri/Cargo.lock"
    TauriConfig = Join-Path $ProjectRoot "src-tauri/tauri.conf.json"
}

foreach ($path in $paths.Values) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required version file does not exist: $path"
    }
}

$backups = @{}
foreach ($entry in $paths.GetEnumerator()) {
    $backups[$entry.Key] = Get-Content -Raw -LiteralPath $entry.Value
}

$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
$cargoVersionPattern = [regex]::new('(?ms)(^\[package\]\s*.*?^version\s*=\s*")[^"]+("\s*$)')
$tauriVersionPattern = [regex]::new('(?m)(^\s*"version"\s*:\s*")[^"]+("\s*,?\s*$)')

Push-Location $ProjectRoot
try {
    & npm version $Version --no-git-tag-version --allow-same-version | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "npm failed to update package.json and package-lock.json."
    }

    $cargoToml = Get-Content -Raw -LiteralPath $paths.CargoToml
    $updatedCargoToml = Set-FirstRegexValue `
        -Source $cargoToml `
        -Pattern $cargoVersionPattern `
        -Value $Version `
        -Description "src-tauri/Cargo.toml package.version"
    [System.IO.File]::WriteAllText($paths.CargoToml, $updatedCargoToml, $utf8WithoutBom)

    $tauriConfig = Get-Content -Raw -LiteralPath $paths.TauriConfig
    $updatedTauriConfig = Set-FirstRegexValue `
        -Source $tauriConfig `
        -Pattern $tauriVersionPattern `
        -Value $Version `
        -Description "src-tauri/tauri.conf.json version"
    [System.IO.File]::WriteAllText($paths.TauriConfig, $updatedTauriConfig, $utf8WithoutBom)

    & cargo metadata --manifest-path $paths.CargoToml --format-version 1 --no-deps | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Cargo failed to refresh src-tauri/Cargo.lock."
    }

    & (Join-Path $PSScriptRoot "check-release.ps1") -ProjectRoot $ProjectRoot

    Write-Host "Updated Archeion to version $Version."
    Write-Host "Add the dated changelog section before creating the release tag."
}
catch {
    foreach ($entry in $paths.GetEnumerator()) {
        [System.IO.File]::WriteAllText($entry.Value, [string]$backups[$entry.Key], $utf8WithoutBom)
    }

    throw
}
finally {
    Pop-Location
}
