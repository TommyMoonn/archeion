#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$Name = "changes",

    [Parameter()]
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,

    [Parameter()]
    [string]$OutputPath,

    [Parameter()]
    [switch]$ExcludeUntracked,

    [Parameter()]
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$DeleteManifestName = ".chatgpt-delete-manifest.txt"
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))
$PathComparison = [System.StringComparison]::OrdinalIgnoreCase
$DirectorySeparator = [System.IO.Path]::DirectorySeparatorChar
$ProjectRootPrefix = "$ProjectRoot$DirectorySeparator"

function Invoke-GitRaw {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = "git"
    $startInfo.WorkingDirectory = $ProjectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo

    if (-not $process.Start()) {
        throw "Unable to start Git."
    }

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    if ($process.ExitCode -ne 0) {
        throw "Git failed: git $($Arguments -join ' ')`n$stderr"
    }

    return $stdout
}

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
        throw "Refusing to package .git content: $RelativePath"
    }

    $fullPath = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $normalized))

    if (-not $fullPath.StartsWith($ProjectRootPrefix, $PathComparison)) {
        throw "Path resolves outside the project root: $RelativePath"
    }

    return $fullPath
}

function Add-TrackedChanges {
    param(
        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$CopyPaths,

        [Parameter(Mandatory)]
        [System.Collections.Generic.HashSet[string]]$DeletePaths
    )

    $raw = Invoke-GitRaw -Arguments @(
        "diff",
        "HEAD",
        "--name-status",
        "-z",
        "--find-renames",
        "--"
    )

    $tokens = $raw.Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries)

    for ($index = 0; $index -lt $tokens.Length;) {
        $statusToken = $tokens[$index++]
        $status = $statusToken[0]

        if ($status -eq 'R' -or $status -eq 'C') {
            if (($index + 1) -ge $tokens.Length) {
                throw "Unexpected Git rename/copy output."
            }

            $oldPath = $tokens[$index++]
            $newPath = $tokens[$index++]
            [void]$CopyPaths.Add($newPath)

            if ($status -eq 'R') {
                [void]$DeletePaths.Add($oldPath)
            }

            continue
        }

        if ($index -ge $tokens.Length) {
            throw "Unexpected Git diff output."
        }

        $path = $tokens[$index++]

        if ($status -eq 'D') {
            [void]$DeletePaths.Add($path)
        }
        else {
            [void]$CopyPaths.Add($path)
        }
    }
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}

$insideWorkTree = (Invoke-GitRaw -Arguments @("rev-parse", "--is-inside-work-tree")).Trim()
if ($insideWorkTree -ne "true") {
    throw "Project root is not inside a Git working tree: $ProjectRoot"
}

[void](Invoke-GitRaw -Arguments @("rev-parse", "--verify", "HEAD"))

$copyPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$deletePaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
Add-TrackedChanges -CopyPaths $copyPaths -DeletePaths $deletePaths

if (-not $ExcludeUntracked) {
    $untrackedRaw = Invoke-GitRaw -Arguments @("ls-files", "--others", "--exclude-standard", "-z")
    $untrackedPaths = $untrackedRaw.Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries)

    foreach ($path in $untrackedPaths) {
        [void]$copyPaths.Add($path)
    }
}

foreach ($path in @($copyPaths)) {
    $sourcePath = Resolve-SafeProjectPath -RelativePath $path

    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        [void]$copyPaths.Remove($path)
    }
}

foreach ($path in @($deletePaths)) {
    $targetPath = Resolve-SafeProjectPath -RelativePath $path

    if (Test-Path -LiteralPath $targetPath) {
        [void]$deletePaths.Remove($path)
    }
}

if ($copyPaths.Count -eq 0 -and $deletePaths.Count -eq 0) {
    throw "No changed files were found."
}

$projectName = Split-Path $ProjectRoot -Leaf
$cleanName = $Name.Trim()
$cleanName = $cleanName -replace '\.zip$', ''
$cleanName = $cleanName -replace "^$([regex]::Escape($projectName))-", ''
$cleanName = $cleanName -replace '-changed-files$', ''
$cleanName = ($cleanName.ToLowerInvariant() -replace '[^a-z0-9._-]+', '-' -replace '-+', '-').Trim('-')

if ([string]::IsNullOrWhiteSpace($cleanName)) {
    $cleanName = "changes"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path $ProjectRoot -Parent) "$projectName-$cleanName-changed-files.zip"
}
else {
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

    if ([System.IO.Path]::GetExtension($OutputPath) -ne ".zip") {
        $OutputPath = "$OutputPath.zip"
    }
}

if (Test-Path -LiteralPath $OutputPath) {
    if (-not $Force) {
        throw "Output already exists: $OutputPath. Use -Force to replace it."
    }

    Remove-Item -LiteralPath $OutputPath -Force
}

$outputParent = Split-Path $OutputPath -Parent
New-Item -ItemType Directory -Path $outputParent -Force | Out-Null

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("archeion-package-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

try {
    foreach ($relativePath in ($copyPaths | Sort-Object)) {
        $sourcePath = Resolve-SafeProjectPath -RelativePath $relativePath
        $destinationPath = Join-Path $stagingRoot $relativePath
        $destinationParent = Split-Path $destinationPath -Parent
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    if ($deletePaths.Count -gt 0) {
        $manifestPath = Join-Path $stagingRoot $DeleteManifestName
        $manifestLines = @($deletePaths | Sort-Object)
        [System.IO.File]::WriteAllLines(
            $manifestPath,
            $manifestLines,
            [System.Text.UTF8Encoding]::new($false)
        )
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stagingRoot,
        $OutputPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

Write-Host "Created:  $OutputPath"
Write-Host "Included: $($copyPaths.Count) file(s)"
Write-Host "Deleted:  $($deletePaths.Count) path(s)"

if ($deletePaths.Count -gt 0) {
    Write-Host "Manifest: $DeleteManifestName"
}
