#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
    rust = @{ Kind = 'Switch'; Aliases = @('-Rust') }
    deps = @{ Kind = 'Switch'; Aliases = @('-Dependencies') }
    installers = @{ Kind = 'Switch'; Aliases = @('-Installers') }
    all = @{ Kind = 'Switch'; Aliases = @('-All') }
    'dry-run' = @{ Kind = 'Switch'; Aliases = @('-n', '-DryRun') }
    force = @{ Kind = 'Switch'; Aliases = @('-f', '-Force') }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\clean-generated.ps1 [options]

Options:
  -p, --project <path>          Project root to clean.
  --rust                        Remove src-tauri/target.
  --deps                        Remove node_modules.
  --installers                  Remove generated Tauri installers.
  --all                         Enable rust, deps, and installers cleanup.
  -n, --dry-run                 Preview cleanup only.
  -f, --force                   Allow selected tracked content to be removed.
  -h, --help                    Show this help.

Legacy PowerShell flags remain accepted for compatibility.
'@
    return
}

$ProjectRoot = $cli['project']
$Rust = [bool]$cli['rust']
$Dependencies = [bool]$cli['deps']
$Installers = [bool]$cli['installers']
$All = [bool]$cli['all']
$DryRun = [bool]$cli['dry-run']
$Force = [bool]$cli['force']

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

$scope = [System.Collections.Generic.List[string]]::new()
$scope.Add("generated outputs and caches")
if ($Rust) {
    $scope.Add("Rust target")
}
if ($Dependencies) {
    $scope.Add("dependencies")
}
if ($Installers) {
    $scope.Add("installers")
}

$modeLabel = if ($DryRun) { "dry run" } else { "apply" }
Write-CliHeading -Text "Generated output cleanup"
Write-CliDetail -Label "Project" -Value $ProjectRoot -ValueTone 'Important'
Write-CliDetail -Label "Scope" -Value ($scope -join ", ")
Write-CliDetail -Label "Mode" -Value $modeLabel
if ($Force) {
    Write-CliWarning -Message "Tracked-file protection is disabled by --force."
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
        throw "Refusing to remove '$relativePath' because it contains tracked files. Use --force only after reviewing: $($trackedPaths -join ', ')"
    }

    $existingTargets.Add([pscustomobject]@{
        RelativePath = $relativePath
        FullPath = $fullPath
        Size = Get-PathSize -Path $fullPath
    })
}

$preservedTargets = [System.Collections.Generic.List[string]]::new()
if (-not $Rust -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "src-tauri/target"))) {
    $preservedTargets.Add("src-tauri/target (use --rust to remove)")
}
if (-not $Dependencies -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "node_modules"))) {
    $preservedTargets.Add("node_modules (use --deps to remove)")
}
if (-not $Installers -and -not $Rust -and (Test-Path -LiteralPath (Join-Path $ProjectRoot "src-tauri/target/release/bundle"))) {
    $preservedTargets.Add("src-tauri/target/release/bundle (use --installers to remove)")
}

if ($preservedTargets.Count -gt 0) {
    Write-Host ""
    Write-CliHeading -Text "Preserved"
    foreach ($preservedTarget in $preservedTargets) {
        Write-CliStatus -Label "PRESERVE" -Message $preservedTarget -Tone 'Muted' -MessageTone 'Muted'
    }
}

if ($existingTargets.Count -eq 0) {
    Write-Host ""
    Write-CliSuccess -Message "No selected generated output exists"
    exit 0
}

$cleanupHeading = if ($DryRun) { "Cleanup preview" } else { "Cleanup" }
Write-Host ""
Write-CliHeading -Text $cleanupHeading

$totalBytes = 0L
foreach ($target in $existingTargets) {
    $totalBytes += $target.Size
}

$progressId = 31
try {
    for ($index = 0; $index -lt $existingTargets.Count; $index++) {
        $target = $existingTargets[$index]
        $sizeLabel = Format-CliByteSize -Bytes $target.Size
        $message = "$($target.RelativePath) ($sizeLabel)"

        if ($DryRun) {
            Write-CliStatus -Label "WOULD REMOVE" -Message $message -Tone 'Important'
            continue
        }

        if ($existingTargets.Count -gt 1) {
            Write-CliProgress -Activity "Cleaning generated output" -Status $target.RelativePath -Current ($index + 1) -Total $existingTargets.Count -Id $progressId
        }

        Remove-Item -LiteralPath $target.FullPath -Recurse -Force
        Write-CliStatus -Label "REMOVE" -Message $message -Tone 'Important'
    }
}
finally {
    Complete-CliProgress -Id $progressId -Activity "Cleaning generated output"
}

Write-Host ""
if ($DryRun) {
    Write-CliSuccess -Message "Cleanup preview complete"
    Write-CliDetail -Label "Would remove" -Value "$($existingTargets.Count) target(s)"
    Write-CliDetail -Label "Would free" -Value (Format-CliByteSize -Bytes $totalBytes)
    Write-CliDetail -Label "Mode" -Value "dry run"
}
else {
    Write-CliSuccess -Message "Cleanup complete"
    Write-CliDetail -Label "Removed" -Value "$($existingTargets.Count) target(s)"
    Write-CliDetail -Label "Freed" -Value (Format-CliByteSize -Bytes $totalBytes)
}
