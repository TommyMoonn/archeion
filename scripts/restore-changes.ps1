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

$backupFiles = @(Get-ChildItem -LiteralPath $BackupPath -File -Recurse -Force | Sort-Object FullName)
$backupDirectories = @(Get-ChildItem -LiteralPath $BackupPath -Directory -Recurse -Force |
    Sort-Object { $_.FullName.Length }, FullName)

if ($backupFiles.Count -eq 0 -and $backupDirectories.Count -eq 0) {
    throw "Backup directory is empty: $BackupPath"
}

$directoryOperations = [System.Collections.Generic.List[object]]::new()
foreach ($directory in $backupDirectories) {
    $relativePath = [System.IO.Path]::GetRelativePath($BackupPath, $directory.FullName)
    $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

    if (-not (Test-Path -LiteralPath $targetPath -PathType Container)) {
        $directoryOperations.Add([pscustomobject]@{
            RelativePath = $relativePath
            TargetPath = $targetPath
        })
    }
}

$fileOperations = [System.Collections.Generic.List[object]]::new()
foreach ($file in $backupFiles) {
    $relativePath = [System.IO.Path]::GetRelativePath($BackupPath, $file.FullName)
    $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath
    $fileOperations.Add([pscustomobject]@{
        RelativePath = $relativePath
        SourcePath = $file.FullName
        TargetPath = $targetPath
    })
}

Write-CliHeading -Text $(if ($DryRun) { "Backup restore preview" } else { "Restore changed-files backup" })
Write-CliDetail -Label "Backup" -Value $BackupPath -ValueTone 'Important'
Write-CliDetail -Label "Project" -Value $ProjectRoot -ValueTone 'Important'
Write-CliText -Text ""

$createdDirectoryCount = 0
foreach ($operation in $directoryOperations) {
    if ($DryRun) {
        Write-CliStatus -Label "CREATE" -Message $operation.RelativePath -Tone 'Important'
        continue
    }

    New-Item -ItemType Directory -Path $operation.TargetPath -Force | Out-Null
    $createdDirectoryCount++
    Write-CliStatus -Label "CREATE" -Message $operation.RelativePath -Tone 'Important'
}

$restoredFileCount = 0
foreach ($operation in $fileOperations) {
    if ($DryRun) {
        Write-CliStatus -Label "RESTORE" -Message $operation.RelativePath -Tone 'Important'
        continue
    }

    $targetParent = Split-Path $operation.TargetPath -Parent
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    Copy-Item -LiteralPath $operation.SourcePath -Destination $operation.TargetPath -Force
    $restoredFileCount++
    Write-CliStatus -Label "RESTORE" -Message $operation.RelativePath -Tone 'Important'
}

Write-CliText -Text ""
if ($DryRun) {
    Write-CliSuccess -Message "Preview complete"
    Write-CliDetail -Label "Would create" -Value "$($directoryOperations.Count) directories"
    Write-CliDetail -Label "Would restore" -Value "$($fileOperations.Count) files"
    Write-CliDetail -Label "Mode" -Value "dry run"
}
else {
    Write-CliSuccess -Message "Restore complete"
    Write-CliDetail -Label "Created" -Value "$createdDirectoryCount directories"
    Write-CliDetail -Label "Restored" -Value "$restoredFileCount files"
    Write-CliWarning -Message "The current importer does not record newly added files. This restore reinstates overwritten or deleted paths only. Review untracked files before considering the import fully reverted."

    if (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git")) {
        Write-CliText -Text ""
        Write-CliHeading -Text "Git status"
        & git -C $ProjectRoot status --short
    }
}
