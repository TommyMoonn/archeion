#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    version = @{ Aliases = @('-Version') }
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
} -Positionals @('version')

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\set-version.ps1 VERSION [options]

Arguments:
  VERSION                       Semantic version to apply.

Options:
  -p, --project <path>          Project root to update.
  -h, --help                    Show this help.

Legacy -Version and -ProjectRoot flags remain accepted for compatibility.
'@
    return
}

$Version = [string]$cli['version']
$ProjectRoot = $cli['project']

$semVerPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
if ([string]::IsNullOrWhiteSpace($Version) -or $Version -notmatch $semVerPattern) {
    throw "VERSION must be a valid semantic version."
}

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
$cargoLockVersionPattern = [regex]::new(
    '(?ms)(^\[\[package\]\]\s*\r?\nname\s*=\s*"archeion"\s*\r?\nversion\s*=\s*")[^"]+("\s*$)'
)
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

    $cargoLock = Get-Content -Raw -LiteralPath $paths.CargoLock
    $updatedCargoLock = Set-FirstRegexValue `
        -Source $cargoLock `
        -Pattern $cargoLockVersionPattern `
        -Value $Version `
        -Description "src-tauri/Cargo.lock Archeion package.version"
    [System.IO.File]::WriteAllText($paths.CargoLock, $updatedCargoLock, $utf8WithoutBom)

    $tauriConfig = Get-Content -Raw -LiteralPath $paths.TauriConfig
    $updatedTauriConfig = Set-FirstRegexValue `
        -Source $tauriConfig `
        -Pattern $tauriVersionPattern `
        -Value $Version `
        -Description "src-tauri/tauri.conf.json version"
    [System.IO.File]::WriteAllText($paths.TauriConfig, $updatedTauriConfig, $utf8WithoutBom)

    & cargo metadata `
        --locked `
        --manifest-path $paths.CargoToml `
        --format-version 1 `
        --no-deps | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Cargo rejected the updated manifest and lockfile."
    }

    & (Join-Path $PSScriptRoot "check-release.ps1") '--project' $ProjectRoot

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
