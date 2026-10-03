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

$OutputPath = if ($cli['output']) {
    [System.IO.Path]::GetFullPath([string]$cli['output'])
} else {
    $timestamp = (Get-Date).ToString('yyMMddHHmm')
    Join-Path (Split-Path $ProjectRoot -Parent) "archeion-$Mode($timestamp).zip"
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
$sourceArchive = Join-Path ([System.IO.Path]::GetTempPath()) ("archeion-source-$([Guid]::NewGuid().ToString('N')).zip")
$temporaryArchive = Join-Path ([System.IO.Path]::GetTempPath()) ("archeion-export-$([Guid]::NewGuid().ToString('N')).zip")
$fileList = $null
$entryCount = 0
$progressId = 1
$progressActivity = "Packaging $ProjectName export"
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

Write-CliHeading -Text "Exporting $ProjectName ($Mode)"

try {
    Write-CliStep -Message 'Creating source snapshot'

    Push-Location $ProjectRoot
    try {
        if ($Mode -eq 'repo') {
            & git archive --format=zip --output=$sourceArchive $SourceCommit
            if ($LASTEXITCODE -ne 0) {
                throw "Git archive failed for $SourceCommit."
            }
        } else {
            if (-not (Test-Path -LiteralPath '.zipignore' -PathType Leaf)) {
                throw "Workspace export requires .zipignore in $ProjectRoot."
            }
            $fileList = [System.IO.Path]::GetTempFileName()
            Get-ChildItem -Force -Name | Set-Content -LiteralPath $fileList -Encoding utf8
            & tar -a -cf $sourceArchive --exclude-from=.zipignore -T $fileList
            if ($LASTEXITCODE -ne 0) {
                throw "Workspace ZIP creation failed for $ProjectRoot."
            }
        }
    } finally {
        Pop-Location
    }

    # Rebuild instead of updating the source ZIP in place. Streamed ZIPs can use data
    # descriptors that ZipArchive Update does not preserve reliably across tools.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $inputArchive = [System.IO.Compression.ZipFile]::OpenRead($sourceArchive)
    try {
        $sourceEntries = @($inputArchive.Entries)
        $paths = @($sourceEntries | ForEach-Object { $_.FullName.Replace('\', '/') })
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

        $fileEntries = @($sourceEntries | Where-Object { -not $_.FullName.EndsWith('/') })
        $fileCount = $fileEntries.Count
        $progressUpdateEvery = [Math]::Max(1, [int][Math]::Ceiling($fileCount / 100.0))
        $processedFiles = 0

        Write-CliStep -Message "Packaging $fileCount files"

        $outputArchive = [System.IO.Compression.ZipFile]::Open(
            $temporaryArchive,
            [System.IO.Compression.ZipArchiveMode]::Create
        )
        try {
            foreach ($sourceEntry in $sourceEntries) {
                $destinationEntry = $outputArchive.CreateEntry(
                    $sourceEntry.FullName,
                    [System.IO.Compression.CompressionLevel]::Optimal
                )
                $destinationEntry.LastWriteTime = $sourceEntry.LastWriteTime
                $destinationEntry.ExternalAttributes = $sourceEntry.ExternalAttributes

                if ($sourceEntry.FullName.EndsWith('/')) {
                    continue
                }

                $sourceStream = $sourceEntry.Open()
                $destinationStream = $destinationEntry.Open()
                try {
                    $sourceStream.CopyTo($destinationStream)
                } finally {
                    $destinationStream.Dispose()
                    $sourceStream.Dispose()
                }

                $processedFiles++
                if (
                    $processedFiles -eq 1 -or
                    $processedFiles -eq $fileCount -or
                    ($processedFiles % $progressUpdateEvery) -eq 0
                ) {
                    Write-CliProgress `
                        -Id $progressId `
                        -Activity $progressActivity `
                        -Status 'Files' `
                        -Current $processedFiles `
                        -Total $fileCount
                }
            }

            Complete-CliProgress -Id $progressId -Activity $progressActivity
            Write-CliStep -Message 'Writing export manifest'

            $entry = $outputArchive.CreateEntry($ManifestName)
            $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
            try {
                $writer.WriteLine(($manifest | ConvertTo-Json -Depth 4))
            } finally {
                $writer.Dispose()
            }

            $entryCount = $fileCount + 1
        } finally {
            $outputArchive.Dispose()
        }
    } finally {
        $inputArchive.Dispose()
    }

    Write-CliStep -Message 'Finalizing archive'

    $outputParent = Split-Path $OutputPath -Parent
    New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
    Move-Item -LiteralPath $temporaryArchive -Destination $OutputPath

    $stopwatch.Stop()
    $outputInfo = Get-Item -LiteralPath $OutputPath
    $commitDisplay = if ($SourceCommit) { $SourceCommit.Substring(0, 12) } else { 'unavailable' }

    Write-Host ''
    Write-CliSuccess -Message 'Export complete'
    Write-CliDetail -Label 'Archive' -Value $OutputPath -ValueTone 'Important'
    Write-CliDetail -Label 'Size' -Value (Format-CliByteSize -Bytes $outputInfo.Length)
    Write-CliDetail -Label 'Files' -Value ([string]$entryCount)
    Write-CliDetail -Label 'Mode' -Value $Mode
    Write-CliDetail -Label 'Commit' -Value $commitDisplay
    if ($null -ne $WorkingTreeDirty) {
        $treeState = if ($WorkingTreeDirty) { 'dirty' } else { 'clean' }
        $treeTone = if ($WorkingTreeDirty) { 'Warning' } else { 'Success' }
        Write-CliDetail -Label 'Tree' -Value $treeState -ValueTone $treeTone
    }
    Write-CliDetail -Label 'Elapsed' -Value ("{0:0.0} s" -f $stopwatch.Elapsed.TotalSeconds)
} finally {
    Complete-CliProgress -Id $progressId -Activity $progressActivity
    if ($stopwatch.IsRunning) {
        $stopwatch.Stop()
    }
    if ($fileList -and (Test-Path -LiteralPath $fileList)) {
        Remove-Item -LiteralPath $fileList -Force
    }
    if (Test-Path -LiteralPath $sourceArchive) {
        Remove-Item -LiteralPath $sourceArchive -Force
    }
    if (Test-Path -LiteralPath $temporaryArchive) {
        Remove-Item -LiteralPath $temporaryArchive -Force
    }
}
