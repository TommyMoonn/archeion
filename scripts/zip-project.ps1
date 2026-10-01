#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    mode = @{ Aliases = @('-Mode') }
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Join-Path $PSScriptRoot '..') }
    output = @{ Aliases = @('-o', '-OutputPath') }
}
if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\zip-project.ps1 --mode repo|workspace [options]

Options:
  --mode <repo|workspace>       Export committed Git source or the filtered workspace.
  -p, --project <path>          Git repository root to export.
  -o, --output <path>           ZIP path outside the repository.
  -h, --help                    Show this help.
'@
    return
}

$Mode = [string]$cli['mode']
if ($Mode -notin @('repo', 'workspace')) {
    throw "Specify --mode repo or --mode workspace."
}

$ProjectRoot = [System.IO.Path]::GetFullPath([string]$cli['project']).TrimEnd([char[]]@('\', '/'))
if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}

$SourceCommit = $null
$WorkingTreeDirty = $null
$gitRoot = (& git -C $ProjectRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -eq 0 -and $gitRoot -and [System.IO.Path]::GetFullPath($gitRoot.Trim()).Equals($ProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $head = (& git -C $ProjectRoot rev-parse --verify HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $head) {
        $SourceCommit = $head.Trim()
        if ($SourceCommit -notmatch '^[0-9a-f]{40}$') {
            throw "Invalid Git source commit in $ProjectRoot."
        }
    } elseif ($Mode -eq 'repo') {
        throw "Repo export requires a committed Git repository: $ProjectRoot"
    }
    $WorkingTreeDirty = @(& git -C $ProjectRoot status --porcelain --untracked-files=all).Count -gt 0
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect working-tree state in $ProjectRoot."
    }
} elseif ($Mode -eq 'repo') {
    throw "Repo export requires a committed Git repository: $ProjectRoot"
}

$ProjectName = Split-Path $ProjectRoot -Leaf
$ProjectSlug = ($ProjectName.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
if ([string]::IsNullOrWhiteSpace($ProjectSlug)) {
    throw "Could not derive a project slug from '$ProjectName'."
}

$OutputPath = if ($cli['output']) {
    [System.IO.Path]::GetFullPath([string]$cli['output'])
} else {
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    Join-Path (Split-Path $ProjectRoot -Parent) "$ProjectSlug-$Mode-$timestamp.zip"
}
if (-not [System.IO.Path]::GetExtension($OutputPath).Equals('.zip', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Output path must end in .zip: $OutputPath"
}
$projectPrefix = "$ProjectRoot$([System.IO.Path]::DirectorySeparatorChar)"
if ($OutputPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Output ZIP must be outside the exported repository: $OutputPath"
}
if (Test-Path -LiteralPath $OutputPath) {
    throw "Output ZIP already exists: $OutputPath"
}

$ManifestName = 'EXPORT_MANIFEST.json'
$temporaryArchive = Join-Path ([System.IO.Path]::GetTempPath()) ("archeion-export-$([Guid]::NewGuid().ToString('N')).zip")
$fileList = $null

try {
    Push-Location $ProjectRoot
    try {
        if ($Mode -eq 'repo') {
            & git archive --format=zip --output=$temporaryArchive $SourceCommit
            if ($LASTEXITCODE -ne 0) {
                throw "Git archive failed for $SourceCommit."
            }
        } else {
            if (-not (Test-Path -LiteralPath '.zipignore' -PathType Leaf)) {
                throw "Workspace export requires .zipignore in $ProjectRoot."
            }
            $fileList = [System.IO.Path]::GetTempFileName()
            Get-ChildItem -Force -Name | Set-Content -LiteralPath $fileList -Encoding utf8
            & tar -a -cf $temporaryArchive --exclude-from=.zipignore -T $fileList
            if ($LASTEXITCODE -ne 0) {
                throw "Workspace ZIP creation failed for $ProjectRoot."
            }
        }
    } finally {
        Pop-Location
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($temporaryArchive, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $paths = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        if ($paths -contains $ManifestName) {
            throw "Export already contains reserved manifest path $ManifestName."
        }

        $includesPlanning = @($paths | Where-Object { $_ -match '^\.planning/.+' -and -not $_.EndsWith('/') }).Count -gt 0
        $includesProject = @($paths | Where-Object { $_ -match '^\.project/.+' -and -not $_.EndsWith('/') }).Count -gt 0
        if ($Mode -eq 'repo' -and ($includesPlanning -or $includesProject)) {
            throw "Repo export cannot contain local-only .planning or .project files."
        }

        $manifest = [ordered]@{
            schemaVersion = 1
            exportMode = $Mode
            sourceCommit = $SourceCommit
            workingTreeDirty = $WorkingTreeDirty
            trackedSourceBaseline = if ($Mode -eq 'repo') { 'git-commit' } elseif ($SourceCommit) { 'working-tree-over-commit' } else { 'working-tree' }
            includedLocalOnly = [ordered]@{
                planning = $includesPlanning
                project = $includesProject
            }
            createdAt = (Get-Date).ToUniversalTime().ToString('o')
        }
        $entry = $archive.CreateEntry($ManifestName)
        $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
        try {
            $writer.WriteLine(($manifest | ConvertTo-Json -Depth 4))
        } finally {
            $writer.Dispose()
        }
    } finally {
        $archive.Dispose()
    }

    $outputParent = Split-Path $OutputPath -Parent
    New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
    Move-Item -LiteralPath $temporaryArchive -Destination $OutputPath
    Write-Host "Created: $OutputPath"
    Write-Host "Mode: $Mode"
    Write-Host "Source commit: $SourceCommit"
} finally {
    if ($fileList -and (Test-Path -LiteralPath $fileList)) {
        Remove-Item -LiteralPath $fileList -Force
    }
    if (Test-Path -LiteralPath $temporaryArchive) {
        Remove-Item -LiteralPath $temporaryArchive -Force
    }
}
