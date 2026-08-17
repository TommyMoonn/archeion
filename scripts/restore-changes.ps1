#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
    backup = @{ Aliases = @('-BackupPath') }
    'dry-run' = @{ Kind = 'Switch'; Aliases = @('-n', '-DryRun') }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\restore-changes.ps1 [options]

Options:
  -p, --project <path>          Project root to restore into.
  --backup <path>               Restore a specific backup.
  -n, --dry-run                 Preview without restoring files.
  -h, --help                    Show this help.

Legacy PowerShell flags remain accepted for compatibility.
'@
    return
}

$ProjectRoot = $cli['project']
$BackupPath = $cli['backup']
$DryRun = [bool]$cli['dry-run']

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
        throw "Refusing to restore .git content: $RelativePath"
    }

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $normalized))

    if (-not $fullPath.StartsWith($ProjectRootPrefix, $PathComparison)) {
        throw "Path resolves outside the project root: $RelativePath"
    }

    return $fullPath
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}

$projectName = Split-Path $ProjectRoot -Leaf
$backupBase = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "Archeion\ChatGPTImports\$projectName"
}
else {
    Join-Path ([System.IO.Path]::GetTempPath()) "Archeion-ChatGPTImports\$projectName"
}

if ([string]::IsNullOrWhiteSpace($BackupPath)) {
    if (-not (Test-Path -LiteralPath $backupBase -PathType Container)) {
        throw "No ChatGPT import backups were found for '$projectName' under: $backupBase"
    }

    $latestBackup = Get-ChildItem -LiteralPath $backupBase -Directory |
        Sort-Object Name -Descending |
        Select-Object -First 1

    if ($null -eq $latestBackup) {
        throw "No ChatGPT import backups were found for '$projectName' under: $backupBase"
    }

    $BackupPath = $latestBackup.FullName
}
else {
    $BackupPath = [System.IO.Path]::GetFullPath($BackupPath)
}

if (-not (Test-Path -LiteralPath $BackupPath -PathType Container)) {
    throw "Backup directory does not exist: $BackupPath"
}

$backupFiles = @(Get-ChildItem -LiteralPath $BackupPath -File -Recurse -Force)
$backupDirectories = @(Get-ChildItem -LiteralPath $BackupPath -Directory -Recurse -Force |
    Sort-Object { $_.FullName.Length })

if ($backupFiles.Count -eq 0 -and $backupDirectories.Count -eq 0) {
    throw "Backup directory is empty: $BackupPath"
}

Write-Host "Backup:  $BackupPath"
Write-Host "Project: $ProjectRoot"
Write-Host ""

$createdDirectoryCount = 0
$restoredFileCount = 0

foreach ($directory in $backupDirectories) {
    $relativePath = [System.IO.Path]::GetRelativePath($BackupPath, $directory.FullName)
    $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

    if (Test-Path -LiteralPath $targetPath -PathType Container) {
        continue
    }

    if ($DryRun) {
        Write-Host "WOULD CREATE  $relativePath"
    }
    else {
        New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
        Write-Host "CREATED       $relativePath"
    }

    $createdDirectoryCount++
}

foreach ($file in $backupFiles) {
    $relativePath = [System.IO.Path]::GetRelativePath($BackupPath, $file.FullName)
    $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

    if ($DryRun) {
        Write-Host "WOULD RESTORE $relativePath"
        $restoredFileCount++
        continue
    }

    $targetParent = Split-Path $targetPath -Parent
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $targetPath -Force
    Write-Host "RESTORED      $relativePath"
    $restoredFileCount++
}

Write-Host ""
Write-Host "Restored files:     $restoredFileCount"
Write-Host "Created directories: $createdDirectoryCount"

if ($DryRun) {
    Write-Host "Mode: dry run, no project files were changed"
}
else {
    Write-Warning "The current importer does not record newly added files. This restore only reinstates overwritten or deleted paths from the backup. Review untracked files before considering the import fully reverted."

    if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git")) {
        Write-Host ""
        Write-Host "Git status:"
        & git -C $ProjectRoot status --short
    }
}
