#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ZipPath,

    [Parameter()]
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,

    [Parameter()]
    [string]$DownloadsPath = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads"),

    [Parameter()]
    [string]$ZipPattern = "archeion*.zip",

    [Parameter()]
    [switch]$StripSingleRoot,

    [Parameter()]
    [switch]$DryRun,

    [Parameter()]
    [switch]$AllowDirty,

    [Parameter()]
    [switch]$NoBackup,

    [Parameter()]
    [switch]$AllowDirectoryDeletion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DeleteManifestName = ".chatgpt-delete-manifest.txt"
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))
$PathComparison = [System.StringComparison]::OrdinalIgnoreCase
$DirectorySeparator = [System.IO.Path]::DirectorySeparatorChar
$ProjectRootPrefix = "$ProjectRoot$DirectorySeparator"

function Resolve-SafeProjectPath {
    param(
        [Parameter(Mandatory)]
        [string]$RelativePath,

        [Parameter()]
        [switch]$AllowProjectRoot
    )

    $normalizedRelativePath = $RelativePath.Trim().Replace([char]'/', $DirectorySeparator).Replace([char]'\', $DirectorySeparator)

    if ([string]::IsNullOrWhiteSpace($normalizedRelativePath)) {
        throw "Encountered an empty project-relative path."
    }

    if ([System.IO.Path]::IsPathRooted($normalizedRelativePath)) {
        throw "Absolute paths are not allowed: $RelativePath"
    }

    if ($normalizedRelativePath -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Parent-directory traversal is not allowed: $RelativePath"
    }

    if ($normalizedRelativePath -match '^(\.git)([\\/]|$)') {
        throw "The importer will not modify .git: $RelativePath"
    }

    $targetPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $normalizedRelativePath))
    $isProjectRoot = $targetPath.Equals($ProjectRoot, $PathComparison)
    $isInsideProject = $targetPath.StartsWith($ProjectRootPrefix, $PathComparison)

    if ((-not $isInsideProject) -and (-not ($AllowProjectRoot -and $isProjectRoot))) {
        throw "Path resolves outside the project root: $RelativePath"
    }

    return $targetPath
}

function Get-ProjectMatchScore {
    param(
        [Parameter(Mandatory)]
        [string]$CandidateRoot
    )

    $score = 0
    $files = Get-ChildItem -LiteralPath $CandidateRoot -File -Recurse -Force |
        Where-Object { $_.Name -ne $DeleteManifestName } |
        Select-Object -First 500

    foreach ($file in $files) {
        $relativePath = [System.IO.Path]::GetRelativePath($CandidateRoot, $file.FullName)
        $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

        if (Test-Path -LiteralPath $targetPath) {
            $score++
        }
    }

    return $score
}

function Test-FileContentEqual {
    param(
        [Parameter(Mandatory)]
        [string]$Left,

        [Parameter(Mandatory)]
        [string]$Right
    )

    if (-not (Test-Path -LiteralPath $Right -PathType Leaf)) {
        return $false
    }

    $leftInfo = Get-Item -LiteralPath $Left
    $rightInfo = Get-Item -LiteralPath $Right

    if ($leftInfo.Length -ne $rightInfo.Length) {
        return $false
    }

    $leftHash = (Get-FileHash -LiteralPath $Left -Algorithm SHA256).Hash
    $rightHash = (Get-FileHash -LiteralPath $Right -Algorithm SHA256).Hash
    return $leftHash -eq $rightHash
}

$backupRoot = $null

function Backup-ExistingPath {
    param(
        [Parameter(Mandatory)]
        [string]$TargetPath,

        [Parameter(Mandatory)]
        [string]$RelativePath
    )

    if ($NoBackup -or -not (Test-Path -LiteralPath $TargetPath)) {
        return
    }

    if ($null -eq $script:backupRoot) {
        $projectName = Split-Path $ProjectRoot -Leaf
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupBase = if ($env:LOCALAPPDATA) {
            Join-Path $env:LOCALAPPDATA "Archeion\ChatGPTImports"
        }
        else {
            Join-Path ([System.IO.Path]::GetTempPath()) "Archeion-ChatGPTImports"
        }

        $script:backupRoot = Join-Path (Join-Path $backupBase $projectName) $timestamp
    }

    $backupPath = Join-Path $script:backupRoot $RelativePath
    $backupParent = Split-Path $backupPath -Parent
    New-Item -ItemType Directory -Path $backupParent -Force | Out-Null

    if (Test-Path -LiteralPath $TargetPath -PathType Container) {
        Copy-Item -LiteralPath $TargetPath -Destination $backupPath -Recurse -Force
    }
    else {
        Copy-Item -LiteralPath $TargetPath -Destination $backupPath -Force
    }
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}

if (-not $AllowDirty -and (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git"))) {
    $gitStatus = & git -C $ProjectRoot status --porcelain --untracked-files=no 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect the Git working tree: $($gitStatus -join [Environment]::NewLine)"
    }

    if ($gitStatus) {
        throw "The Git working tree is not clean. Commit, stash, or rerun with -AllowDirty after reviewing the risk."
    }
}

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    if (-not (Test-Path -LiteralPath $DownloadsPath -PathType Container)) {
        throw "Downloads directory does not exist: $DownloadsPath"
    }

    $latestZip = Get-ChildItem -LiteralPath $DownloadsPath -File -Filter $ZipPattern |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $latestZip) {
        throw "No ZIP matching '$ZipPattern' was found in $DownloadsPath"
    }

    $ZipPath = $latestZip.FullName
}

$ZipPath = [System.IO.Path]::GetFullPath($ZipPath)

if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    throw "ZIP file does not exist: $ZipPath"
}

if ([System.IO.Path]::GetExtension($ZipPath) -ne ".zip") {
    throw "Expected a .zip file: $ZipPath"
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("archeion-import-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $tempRoot -Force

    $contentRoot = $tempRoot
    $topLevelContent = @(Get-ChildItem -LiteralPath $tempRoot -Force |
        Where-Object { $_.Name -ne $DeleteManifestName })

    if ($topLevelContent.Count -eq 1 -and $topLevelContent[0].PSIsContainer) {
        $rootScore = Get-ProjectMatchScore -CandidateRoot $tempRoot
        $childScore = Get-ProjectMatchScore -CandidateRoot $topLevelContent[0].FullName

        $zipBaseName = [System.IO.Path]::GetFileNameWithoutExtension($ZipPath)
        $singleRootMatchesArchiveName = $topLevelContent[0].Name.Equals(
            $zipBaseName,
            [System.StringComparison]::OrdinalIgnoreCase
        )

        if ($StripSingleRoot -or $childScore -gt $rootScore -or $singleRootMatchesArchiveName) {
            $contentRoot = $topLevelContent[0].FullName
        }
    }

    $files = @(Get-ChildItem -LiteralPath $contentRoot -File -Recurse -Force |
        Where-Object { $_.Name -ne $DeleteManifestName })

    $manifestCandidates = @(
        (Join-Path $contentRoot $DeleteManifestName),
        (Join-Path $tempRoot $DeleteManifestName)
    ) | Select-Object -Unique

    $manifestPath = $manifestCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1

    if ($files.Count -eq 0 -and -not $manifestPath) {
        throw "The ZIP does not contain any files or deletion manifest to apply."
    }

    $copiedCount = 0
    $unchangedCount = 0
    $deletedCount = 0

    Write-Host "ZIP:     $ZipPath"
    Write-Host "Project: $ProjectRoot"
    Write-Host "Source:  $contentRoot"
    Write-Host ""

    foreach ($file in $files) {
        $relativePath = [System.IO.Path]::GetRelativePath($contentRoot, $file.FullName)
        $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

        if (Test-FileContentEqual -Left $file.FullName -Right $targetPath) {
            $unchangedCount++
            Write-Host "UNCHANGED  $relativePath"
            continue
        }

        if ($DryRun) {
            Write-Host "WOULD COPY $relativePath"
            $copiedCount++
            continue
        }

        Backup-ExistingPath -TargetPath $targetPath -RelativePath $relativePath
        $targetParent = Split-Path $targetPath -Parent
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $targetPath -Force
        $copiedCount++
        Write-Host "COPIED     $relativePath"
    }

    if ($manifestPath) {
        $manifestEntries = Get-Content -LiteralPath $manifestPath |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith("#") }

        foreach ($entry in $manifestEntries) {
            $isDirectoryDeletion = $entry.StartsWith("dir:", [System.StringComparison]::OrdinalIgnoreCase)
            $relativePath = if ($isDirectoryDeletion) { $entry.Substring(4).Trim() } else { $entry }
            $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

            if (-not (Test-Path -LiteralPath $targetPath)) {
                Write-Host "MISSING     $relativePath"
                continue
            }

            $targetIsDirectory = Test-Path -LiteralPath $targetPath -PathType Container

            if ($targetIsDirectory -and -not $isDirectoryDeletion) {
                throw "Refusing to delete directory without an explicit 'dir:' prefix: $relativePath"
            }

            if ($targetIsDirectory -and -not $AllowDirectoryDeletion) {
                throw "Directory deletion requested for '$relativePath'. Rerun with -AllowDirectoryDeletion after reviewing the manifest."
            }

            if ($DryRun) {
                Write-Host "WOULD DELETE $relativePath"
                $deletedCount++
                continue
            }

            Backup-ExistingPath -TargetPath $targetPath -RelativePath $relativePath
            Remove-Item -LiteralPath $targetPath -Recurse:$targetIsDirectory -Force
            $deletedCount++
            Write-Host "DELETED    $relativePath"
        }
    }

    Write-Host ""
    Write-Host "Applied:   $copiedCount"
    Write-Host "Deleted:   $deletedCount"
    Write-Host "Unchanged: $unchangedCount"

    if ($DryRun) {
        Write-Host "Mode:      dry run, no project files were changed"
    }
    elseif ($backupRoot) {
        Write-Host "Backup:    $backupRoot"
    }

    if (-not $DryRun -and (Test-Path -LiteralPath (Join-Path $ProjectRoot ".git"))) {
        Write-Host ""
        Write-Host "Git status:"
        & git -C $ProjectRoot status --short
    }
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
