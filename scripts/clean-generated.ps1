#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,

    [Parameter()]
    [switch]$Rust,

    [Parameter()]
    [switch]$Dependencies,

    [Parameter()]
    [switch]$Installers,

    [Parameter()]
    [switch]$All,

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))
$PathComparison = [System.StringComparison]::OrdinalIgnoreCase
$DirectorySeparator = [System.IO.Path]::DirectorySeparatorChar
$ProjectRootPrefix = "$ProjectRoot$DirectorySeparator"

function Resolve-SafeProjectPath {
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath
    )

    $normalized = $RelativePath.Trim().Replace([char]'/', $DirectorySeparator).Replace([char]'\', $DirectorySeparator)

    if ([string]::IsNullOrWhiteSpace($normalized)) {
        throw "Encountered an empty project-relative path."
    }

    if ([System.IO.Path]::IsPathRooted($normalized) -or $normalized -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Unsafe project-relative path: $RelativePath"
    }

    if ($normalized -match '^(\.git)([\\/]|$)') {
        throw "Refusing to remove .git content: $RelativePath"
    }

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $normalized))

    if (-not $fullPath.StartsWith($ProjectRootPrefix, $PathComparison)) {
        throw "Path resolves outside the project root: $RelativePath"
    }

    return $fullPath
}

function Get-PathSize {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        return (Get-Item -LiteralPath $Path).Length
    }

    $measurement = Get-ChildItem -LiteralPath $Path -File -Recurse -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum

    if ($null -eq $measurement.Sum) {
        return 0L
    }

    return [long]$measurement.Sum
}

function Format-ByteSize {
    param(
        [Parameter(Mandatory)]
        [long]$Bytes
    )

    if ($Bytes -ge 1GB) {
        return "{0:N2} GB" -f ($Bytes / 1GB)
    }

    if ($Bytes -ge 1MB) {
        return "{0:N2} MB" -f ($Bytes / 1MB)
    }

    if ($Bytes -ge 1KB) {
        return "{0:N2} KB" -f ($Bytes / 1KB)
    }

    return "$Bytes B"
}

function Get-TrackedPathsUnder {
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath
    )

    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git"))) {
        return @()
    }

    $normalized = $RelativePath.Replace('\', '/')
    $result = & git -C $ProjectRoot ls-files -- "$normalized" "$normalized/**"

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to check tracked files under: $RelativePath"
    }

    return @($result | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}

if ($All) {
    $Rust = $true
    $Dependencies = $true
    $Installers = $true
}

$targets = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

foreach ($path in @(
    "dist",
    "coverage",
    ".nyc_output",
    "test-results",
    "playwright-report",
    ".eslintcache",
    ".stylelintcache",
    ".parcel-cache",
    ".turbo",
    "node_modules/.vite",
    "node_modules/.cache"
)) {
    [void]$targets.Add($path)
}

if ($Installers) {
    [void]$targets.Add("src-tauri/target/release/bundle")
}

if ($Rust) {
    [void]$targets.Add("src-tauri/target")
}

if ($Dependencies) {
    [void]$targets.Add("node_modules")
}

$existingTargets = [System.Collections.Generic.List[object]]::new()

foreach ($relativePath in ($targets | Sort-Object { $_.Length })) {
    $fullPath = Resolve-SafeProjectPath -RelativePath $relativePath

    if (-not (Test-Path -LiteralPath $fullPath)) {
        continue
    }

    $isNestedUnderSelectedParent = $false
    foreach ($selected in $existingTargets) {
        $selectedPrefix = "$($selected.FullPath)$DirectorySeparator"
        if ($fullPath.StartsWith($selectedPrefix, $PathComparison)) {
            $isNestedUnderSelectedParent = $true
            break
        }
    }

    if ($isNestedUnderSelectedParent) {
        continue
    }

    $trackedPaths = @(Get-TrackedPathsUnder -RelativePath $relativePath)
    if ($trackedPaths.Count -gt 0 -and -not $Force) {
        throw "Refusing to remove '$relativePath' because it contains tracked files. Use -Force only after reviewing: $($trackedPaths -join ', ')"
    }

    $existingTargets.Add([pscustomobject]@{
        RelativePath = $relativePath
        FullPath = $fullPath
        Size = Get-PathSize -Path $fullPath
    })
}

if ($existingTargets.Count -eq 0) {
    Write-Host "No selected generated output exists."
    exit 0
}

$totalBytes = 0L
foreach ($target in $existingTargets) {
    $totalBytes += $target.Size
    $sizeLabel = Format-ByteSize -Bytes $target.Size

    if ($DryRun) {
        Write-Host ("WOULD REMOVE {0,-42} {1,12}" -f $target.RelativePath, $sizeLabel)
    }
    else {
        Remove-Item -LiteralPath $target.FullPath -Recurse -Force
        Write-Host ("REMOVED      {0,-42} {1,12}" -f $target.RelativePath, $sizeLabel)
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "Would free approximately: $(Format-ByteSize -Bytes $totalBytes)"
    Write-Host "Mode: dry run, nothing was removed"
}
else {
    Write-Host "Freed approximately: $(Format-ByteSize -Bytes $totalBytes)"
}

if (-not $Rust -and -not $All) {
    Write-Host "Rust target was preserved. Use -Rust to remove it."
}

if (-not $Dependencies -and -not $All) {
    Write-Host "node_modules was preserved. Use -Dependencies to remove it."
}
