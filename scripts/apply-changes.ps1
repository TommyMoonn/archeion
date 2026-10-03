#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    zip = @{ Aliases = @('-ZipPath') }
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
    downloads = @{ Aliases = @('-DownloadsPath'); Default = (Join-Path ([Environment]::GetFolderPath("UserProfile")) "Downloads") }
    pattern = @{ Aliases = @('-ZipPattern'); Default = 'archeion*.zip' }
    'strip-root' = @{ Kind = 'Switch'; Aliases = @('-StripSingleRoot') }
    'dry-run' = @{ Kind = 'Switch'; Aliases = @('-n', '-DryRun') }
    'allow-dirty' = @{ Kind = 'Switch'; Aliases = @('-AllowDirty') }
    'no-backup' = @{ Kind = 'Switch'; Aliases = @('-NoBackup') }
    'allow-directory-deletion' = @{ Kind = 'Switch'; Aliases = @('--allow-directory-delete', '-AllowDirectoryDeletion') }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\apply-changes.ps1 [options]

Options:
  --zip <path>                  Apply a specific changed-files ZIP.
  -p, --project <path>          Target project root.
  --downloads <path>            Directory used for automatic ZIP discovery.
  --pattern <glob>              ZIP discovery pattern. Default: archeion*.zip
  --strip-root                  Strip one extra top-level archive directory.
  -n, --dry-run                 Preview without modifying files.
  --allow-dirty                 Allow tracked working-tree changes.
  --no-backup                   Skip backups of overwritten/deleted paths.
  --allow-directory-deletion    Permit dir: entries in the deletion manifest.
  -h, --help                    Show this help.

Legacy PowerShell flags remain accepted for compatibility.
'@
    return
}

$ZipPath = $cli['zip']
$ProjectRoot = $cli['project']
$DownloadsPath = $cli['downloads']
$ZipPattern = $cli['pattern']
$StripSingleRoot = [bool]$cli['strip-root']
$DryRun = [bool]$cli['dry-run']
$AllowDirty = [bool]$cli['allow-dirty']
$NoBackup = [bool]$cli['no-backup']
$AllowDirectoryDeletion = [bool]$cli['allow-directory-deletion']

$DeleteManifestName = ".chatgpt-delete-manifest.txt"
$PackageManifestName = ".archeion-change-package.json"
$PackageKind = "archeion-change-package"
$PackageSchemaVersion = 1
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

function Test-IsPackageMetadata {
    param(
        [Parameter(Mandatory)]
        [System.IO.FileSystemInfo]$Item
    )

    return $Item.Name -eq $DeleteManifestName -or $Item.Name -eq $PackageManifestName
}

function Get-ProjectMatchScore {
    param(
        [Parameter(Mandatory)]
        [string]$CandidateRoot
    )

    $score = 0
    $files = Get-ChildItem -LiteralPath $CandidateRoot -File -Recurse -Force |
        Where-Object { -not (Test-IsPackageMetadata -Item $_) } |
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

function Read-PackageManifest {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    try {
        # Use PowerShell's bundled JSON parser without date coercion on every supported version.
        Add-Type -AssemblyName Newtonsoft.Json
        $jsonSettings = [Newtonsoft.Json.JsonSerializerSettings]::new()
        $jsonSettings.DateParseHandling = [Newtonsoft.Json.DateParseHandling]::None
        $manifest = [pscustomobject][Newtonsoft.Json.JsonConvert]::DeserializeObject(
            (Get-Content -LiteralPath $Path -Raw),
            [hashtable],
            $jsonSettings
        )
    }
    catch {
        throw "Package provenance manifest is malformed: $($_.Exception.Message)"
    }

    $requiredProperties = @(
        'schemaVersion',
        'packageKind',
        'projectName',
        'sourceCommit',
        'trackedOnly',
        'includedFiles',
        'deletedPaths',
        'createdAt'
    )

    foreach ($property in $requiredProperties) {
        if ($manifest.PSObject.Properties.Name -notcontains $property) {
            throw "Package provenance manifest is malformed: missing '$property'."
        }
    }

    if ($manifest.schemaVersion -ne $PackageSchemaVersion) {
        throw "Unsupported package provenance schema version: $($manifest.schemaVersion)"
    }

    if ([string]$manifest.packageKind -ne $PackageKind) {
        throw "Unsupported package kind: $($manifest.packageKind)"
    }

    if ([string]::IsNullOrWhiteSpace([string]$manifest.projectName)) {
        throw "Package provenance manifest is malformed: projectName is empty."
    }

    if ([string]$manifest.sourceCommit -notmatch '^[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$') {
        throw "Package provenance manifest is malformed: sourceCommit is not a Git object ID."
    }

    if ($manifest.trackedOnly -isnot [bool]) {
        throw "Package provenance manifest is malformed: trackedOnly must be boolean."
    }

    foreach ($countName in @('includedFiles', 'deletedPaths')) {
        $count = $manifest.$countName
        if ($count -is [bool] -or $count -isnot [ValueType] -or [decimal]$count -ne [Math]::Truncate([decimal]$count) -or [decimal]$count -lt 0) {
            throw "Package provenance manifest is malformed: $countName must be a non-negative integer."
        }
    }

    $createdAt = [DateTimeOffset]::MinValue
    if (
        $manifest.createdAt -isnot [string] -or
        -not [DateTimeOffset]::TryParse(
            $manifest.createdAt,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::None,
            [ref]$createdAt
        ) -or
        -not $manifest.createdAt.EndsWith('Z')
    ) {
        throw "Package provenance manifest is malformed: createdAt must be a UTC timestamp."
    }

    return $manifest
}

function Test-GitContainsCommit {
    param(
        [Parameter(Mandatory)]
        [string]$Commit
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "git"
    $startInfo.WorkingDirectory = $ProjectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    [void]$startInfo.ArgumentList.Add("cat-file")
    [void]$startInfo.ArgumentList.Add("-e")
    [void]$startInfo.ArgumentList.Add("$Commit^{commit}")

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        throw "Unable to start Git for the provenance check."
    }

    $null = $process.StandardOutput.ReadToEnd()
    $null = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return $process.ExitCode -eq 0
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

$targetIsGit = Test-Path -LiteralPath (Join-Path $ProjectRoot ".git")
if ($targetIsGit -and -not $AllowDirty) {
    $gitStatus = & git -C $ProjectRoot status --porcelain --untracked-files=no 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect the Git working tree: $($gitStatus -join [Environment]::NewLine)"
    }

    if ($gitStatus) {
        throw "The Git working tree is not clean. Commit, stash, or rerun with --allow-dirty after reviewing the risk."
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
        Where-Object { -not (Test-IsPackageMetadata -Item $_) })

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

    $packageManifestCandidates = @(Get-ChildItem -LiteralPath $tempRoot -File -Recurse -Force -Filter $PackageManifestName)

    if ($packageManifestCandidates.Count -gt 1) {
        throw "The ZIP contains multiple package provenance manifests."
    }

    $packageManifest = if ($packageManifestCandidates.Count -eq 1) {
        Read-PackageManifest -Path $packageManifestCandidates[0].FullName
    }
    else {
        $null
    }

    $files = @(Get-ChildItem -LiteralPath $contentRoot -File -Recurse -Force |
        Where-Object { -not (Test-IsPackageMetadata -Item $_) } |
        Sort-Object FullName)

    $deleteManifestCandidates = @(Get-ChildItem -LiteralPath $tempRoot -File -Recurse -Force -Filter $DeleteManifestName)

    if ($deleteManifestCandidates.Count -gt 1) {
        throw "The ZIP contains multiple deletion manifests."
    }

    $deleteManifestPath = if ($deleteManifestCandidates.Count -eq 1) { $deleteManifestCandidates[0].FullName } else { $null }

    if ($files.Count -eq 0 -and -not $deleteManifestPath) {
        throw "The ZIP does not contain any files or deletion manifest to apply."
    }

    $copyOperations = [System.Collections.Generic.List[object]]::new()
    $unchangedCount = 0
    foreach ($file in $files) {
        $relativePath = [System.IO.Path]::GetRelativePath($contentRoot, $file.FullName)
        $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath

        if (Test-FileContentEqual -Left $file.FullName -Right $targetPath) {
            $unchangedCount++
            continue
        }

        $copyOperations.Add([pscustomobject]@{
            RelativePath = $relativePath
            SourcePath = $file.FullName
            TargetPath = $targetPath
        })
    }

    $deleteOperations = [System.Collections.Generic.List[object]]::new()
    if ($deleteManifestPath) {
        $manifestEntries = Get-Content -LiteralPath $deleteManifestPath |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith("#") }

        foreach ($entry in $manifestEntries) {
            $isDirectoryDeletion = $entry.StartsWith("dir:", [System.StringComparison]::OrdinalIgnoreCase)
            $relativePath = if ($isDirectoryDeletion) { $entry.Substring(4).Trim() } else { $entry }
            $targetPath = Resolve-SafeProjectPath -RelativePath $relativePath
            $targetExists = Test-Path -LiteralPath $targetPath
            $targetIsDirectory = $targetExists -and (Test-Path -LiteralPath $targetPath -PathType Container)

            if ($targetIsDirectory -and -not $isDirectoryDeletion) {
                throw "Refusing to delete directory without an explicit 'dir:' prefix: $relativePath"
            }

            if ($targetIsDirectory -and -not $AllowDirectoryDeletion) {
                throw "Directory deletion requested for '$relativePath'. Rerun with --allow-directory-deletion after reviewing the manifest."
            }

            $deleteOperations.Add([pscustomobject]@{
                RelativePath = $relativePath
                TargetPath = $targetPath
                Exists = $targetExists
                IsDirectory = $targetIsDirectory
            })
        }
    }

    if ($null -ne $packageManifest) {
        if ([int64]$packageManifest.includedFiles -ne $files.Count) {
            throw "Package provenance manifest is malformed: includedFiles does not match archive contents."
        }
        if ([int64]$packageManifest.deletedPaths -ne $deleteOperations.Count) {
            throw "Package provenance manifest is malformed: deletedPaths does not match the deletion manifest."
        }
    }

    Write-CliHeading -Text $(if ($DryRun) { "Changed-files preview" } else { "Changed-files apply" })
    Write-CliDetail -Label "Archive" -Value $ZipPath -ValueTone 'Important'
    Write-CliDetail -Label "Project" -Value $ProjectRoot -ValueTone 'Important'

    if ($null -eq $packageManifest) {
        Write-CliDetail -Label "Provenance" -Value "unavailable (legacy package)" -ValueTone 'Muted'
    }
    else {
        Write-CliDetail -Label "Package" -Value ([string]$packageManifest.projectName)
        Write-CliDetail -Label "Source commit" -Value ([string]$packageManifest.sourceCommit)

        if ($targetIsGit) {
            if (Test-GitContainsCommit -Commit ([string]$packageManifest.sourceCommit)) {
                Write-CliDetail -Label "Baseline" -Value "source commit present in target" -ValueTone 'Success'
            }
            else {
                Write-CliWarning -Message "Source commit is not present in the target repository. Review that this package belongs to the intended baseline before applying it."
            }
        }
    }

    if ($AllowDirty) {
        Write-CliWarning -Message "--allow-dirty is enabled. Tracked local changes are allowed and may overlap with imported paths."
    }
    if ($NoBackup -and -not $DryRun) {
        Write-CliWarning -Message "--no-backup is enabled. Overwritten and deleted paths will not be backed up."
    }

    Write-CliText -Text ""

    $copiedCount = 0
    foreach ($operation in $copyOperations) {
        if ($DryRun) {
            Write-CliStatus -Label "COPY" -Message $operation.RelativePath -Tone 'Important'
            continue
        }

        Backup-ExistingPath -TargetPath $operation.TargetPath -RelativePath $operation.RelativePath
        $targetParent = Split-Path $operation.TargetPath -Parent
        New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        Copy-Item -LiteralPath $operation.SourcePath -Destination $operation.TargetPath -Force
        $copiedCount++
        Write-CliStatus -Label "COPY" -Message $operation.RelativePath -Tone 'Important'
    }

    $deletedCount = 0
    $skippedCount = 0
    foreach ($operation in $deleteOperations) {
        if (-not $operation.Exists) {
            Write-CliStatus -Label "SKIP" -Message "$($operation.RelativePath) (already absent)" -Tone 'Muted' -MessageTone 'Muted'
            $skippedCount++
            continue
        }

        if ($DryRun) {
            Write-CliStatus -Label "DELETE" -Message $operation.RelativePath -Tone 'Warning'
            continue
        }

        Backup-ExistingPath -TargetPath $operation.TargetPath -RelativePath $operation.RelativePath
        Remove-Item -LiteralPath $operation.TargetPath -Recurse:$operation.IsDirectory -Force
        $deletedCount++
        Write-CliStatus -Label "DELETE" -Message $operation.RelativePath -Tone 'Warning'
    }

    if ($DryRun) {
        $existingDeleteCount = @($deleteOperations | Where-Object { $_.Exists }).Count
        Write-CliText -Text ""
        Write-CliSuccess -Message "Preview complete"
        Write-CliDetail -Label "Would copy" -Value "$($copyOperations.Count) files"
        Write-CliDetail -Label "Would delete" -Value "$existingDeleteCount paths"
        Write-CliDetail -Label "Skipped" -Value "$skippedCount paths"
        Write-CliDetail -Label "Unchanged" -Value "$unchangedCount files"
        Write-CliDetail -Label "Mode" -Value "dry run"
    }
    elseif ($copiedCount -eq 0 -and $deletedCount -eq 0) {
        Write-CliText -Text ""
        Write-CliSuccess -Message "No changes needed"
        Write-CliDetail -Label "Updated" -Value "0 files"
        Write-CliDetail -Label "Deleted" -Value "0 paths"
        Write-CliDetail -Label "Skipped" -Value "$skippedCount paths"
        Write-CliDetail -Label "Unchanged" -Value "$unchangedCount files"
    }
    else {
        Write-CliText -Text ""
        Write-CliSuccess -Message "Changes applied"
        Write-CliDetail -Label "Updated" -Value "$copiedCount files"
        Write-CliDetail -Label "Deleted" -Value "$deletedCount paths"
        Write-CliDetail -Label "Skipped" -Value "$skippedCount paths"
        Write-CliDetail -Label "Unchanged" -Value "$unchangedCount files"
        if ($backupRoot) {
            Write-CliDetail -Label "Backup" -Value $backupRoot -ValueTone 'Important'
        }
    }

    if (-not $DryRun -and $targetIsGit) {
        Write-CliText -Text ""
        Write-CliHeading -Text "Git status"
        & git -C $ProjectRoot status --short
    }
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
