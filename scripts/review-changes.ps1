#requires -Version 7.0

[CmdletBinding()]
param(
    [Parameter()]
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,

    [Parameter()]
    [switch]$Detailed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))

function Invoke-GitRaw {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter()]
        [switch]$AllowFailure
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

    if ($process.ExitCode -ne 0 -and -not $AllowFailure) {
        throw "Git failed: git $($Arguments -join ' ')`n$stderr"
    }

    return [pscustomobject]@{
        ExitCode = $process.ExitCode
        StdOut = $stdout
        StdErr = $stderr
    }
}

function Get-NulSeparatedPaths {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $result = Invoke-GitRaw -Arguments $Arguments
    return @($result.StdOut.Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries))
}

function Get-TrackedChanges {
    $result = Invoke-GitRaw -Arguments @(
        "diff",
        "HEAD",
        "--name-status",
        "-z",
        "--find-renames",
        "--"
    )

    $tokens = $result.StdOut.Split([char]0, [System.StringSplitOptions]::RemoveEmptyEntries)
    $changes = [System.Collections.Generic.List[object]]::new()

    for ($index = 0; $index -lt $tokens.Length;) {
        $statusToken = $tokens[$index++]
        $status = $statusToken[0]

        if ($status -eq 'R' -or $status -eq 'C') {
            $oldPath = $tokens[$index++]
            $newPath = $tokens[$index++]
            $changes.Add([pscustomobject]@{
                Status = [string]$status
                Path = $newPath
                OldPath = $oldPath
            })
            continue
        }

        $path = $tokens[$index++]
        $changes.Add([pscustomobject]@{
            Status = [string]$status
            Path = $path
            OldPath = $null
        })
    }

    return @($changes)
}

function Get-Category {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $normalized = $Path.Replace('\', '/')
    $extension = [System.IO.Path]::GetExtension($normalized).ToLowerInvariant()

    if ($normalized -match '(^|/)(tests?|__tests__)(/|$)' -or $normalized -match '\.(test|spec)\.[^/]+$') {
        return "Tests"
    }

    if ($normalized.StartsWith("src-tauri/") -or $extension -eq ".rs") {
        return "Rust"
    }

    if ($normalized.StartsWith("src/") -or $extension -in @(".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".html")) {
        return "Frontend"
    }

    if ($extension -in @(".md", ".mdx", ".txt")) {
        return "Documentation"
    }

    if ($normalized.StartsWith(".github/") -or $extension -in @(".json", ".toml", ".yaml", ".yml")) {
        return "Configuration"
    }

    if ($extension -in @(".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".webm", ".mp4")) {
        return "Assets"
    }

    return "Other"
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project root does not exist: $ProjectRoot"
}

$insideWorkTree = (Invoke-GitRaw -Arguments @("rev-parse", "--is-inside-work-tree")).StdOut.Trim()
if ($insideWorkTree -ne "true") {
    throw "Project root is not inside a Git working tree: $ProjectRoot"
}

[void](Invoke-GitRaw -Arguments @("rev-parse", "--verify", "HEAD"))

$trackedChanges = @(Get-TrackedChanges)
$untrackedPaths = @(Get-NulSeparatedPaths -Arguments @("ls-files", "--others", "--exclude-standard", "-z"))
$stagedPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$unstagedPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)

foreach ($path in (Get-NulSeparatedPaths -Arguments @("diff", "--cached", "--name-only", "-z", "--"))) {
    [void]$stagedPaths.Add($path)
}

foreach ($path in (Get-NulSeparatedPaths -Arguments @("diff", "--name-only", "-z", "--"))) {
    [void]$unstagedPaths.Add($path)
}

$allChanges = [System.Collections.Generic.List[object]]::new()
foreach ($change in $trackedChanges) {
    $allChanges.Add($change)
}
foreach ($path in $untrackedPaths) {
    $allChanges.Add([pscustomobject]@{
        Status = "?"
        Path = $path
        OldPath = $null
    })
}

if ($allChanges.Count -eq 0) {
    Write-Host "Working tree is clean."
    exit 0
}

$statusLabels = @{
    "A" = "Added"
    "C" = "Copied"
    "D" = "Deleted"
    "M" = "Modified"
    "R" = "Renamed"
    "T" = "Type changed"
    "U" = "Unmerged"
    "?" = "Untracked"
}

Write-Host "Change review"
Write-Host "Project: $ProjectRoot"
Write-Host ""
Write-Host "Summary"

foreach ($status in @("A", "M", "D", "R", "C", "T", "U", "?")) {
    $count = @($allChanges | Where-Object Status -eq $status).Count
    if ($count -gt 0) {
        Write-Host ("  {0,-13} {1}" -f $statusLabels[$status], $count)
    }
}

Write-Host ("  {0,-13} {1}" -f "Staged", $stagedPaths.Count)
Write-Host ("  {0,-13} {1}" -f "Unstaged", $unstagedPaths.Count)
Write-Host ("  {0,-13} {1}" -f "Total", $allChanges.Count)

Write-Host ""
Write-Host "Areas"
$categoryGroups = $allChanges |
    Group-Object { Get-Category -Path $_.Path } |
    Sort-Object Name

foreach ($group in $categoryGroups) {
    Write-Host ("  {0,-16} {1}" -f $group.Name, $group.Count)
}

$flags = [System.Collections.Generic.List[string]]::new()
$deleted = @($allChanges | Where-Object Status -eq "D")
$sourceChanges = @($allChanges | Where-Object {
    (Get-Category -Path $_.Path) -in @("Frontend", "Rust") -and $_.Status -ne "D"
})
$testChanges = @($allChanges | Where-Object { (Get-Category -Path $_.Path) -eq "Tests" })
$generatedPaths = @($allChanges | Where-Object {
    $_.Path.Replace('\', '/') -match '(^|/)(node_modules|dist|coverage|target|test-results|playwright-report|\.vite)(/|$)'
})
$dependencyFiles = @($allChanges | Where-Object {
    [System.IO.Path]::GetFileName($_.Path) -in @(
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "Cargo.toml",
        "Cargo.lock"
    )
})
$workflowFiles = @($allChanges | Where-Object { $_.Path.Replace('\', '/').StartsWith(".github/workflows/") })
$largeFiles = [System.Collections.Generic.List[string]]::new()

foreach ($change in $allChanges | Where-Object Status -ne "D") {
    $fullPath = Join-Path $ProjectRoot $change.Path
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
        $item = Get-Item -LiteralPath $fullPath
        if ($item.Length -ge 1MB) {
            $largeFiles.Add("$($change.Path) ($([math]::Round($item.Length / 1MB, 2)) MB)")
        }
    }
}

if ($deleted.Count -gt 0) {
    $flags.Add("$($deleted.Count) deleted path(s). Confirm obsolete code and imports were removed cleanly.")
}

if ($sourceChanges.Count -gt 0 -and $testChanges.Count -eq 0) {
    $flags.Add("Source changed without any test file changes.")
}

if ($generatedPaths.Count -gt 0) {
    $flags.Add("Generated output appears in the change set: $($generatedPaths.Path -join ', ')")
}

if ($dependencyFiles.Count -gt 0) {
    $flags.Add("Dependency manifests or lock files changed: $($dependencyFiles.Path -join ', ')")
}

if ($workflowFiles.Count -gt 0) {
    $flags.Add("GitHub workflow files changed: $($workflowFiles.Path -join ', ')")
}

if ($largeFiles.Count -gt 0) {
    $flags.Add("Large changed files: $($largeFiles -join ', ')")
}

$unstagedWhitespace = Invoke-GitRaw -Arguments @("diff", "--check", "--") -AllowFailure
$stagedWhitespace = Invoke-GitRaw -Arguments @("diff", "--cached", "--check", "--") -AllowFailure

if ($unstagedWhitespace.ExitCode -ne 0 -or $stagedWhitespace.ExitCode -ne 0) {
    $details = @($unstagedWhitespace.StdOut.Trim(), $stagedWhitespace.StdOut.Trim()) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $flags.Add("Git whitespace check failed: $($details -join '; ')")
}

Write-Host ""
Write-Host "Review flags"
if ($flags.Count -eq 0) {
    Write-Host "  None detected."
}
else {
    foreach ($flag in $flags) {
        Write-Host "  - $flag"
    }
}

if ($Detailed) {
    Write-Host ""
    Write-Host "Files"
    foreach ($change in $allChanges | Sort-Object Path) {
        $label = $statusLabels[$change.Status]
        if ($change.Status -eq "R" -or $change.Status -eq "C") {
            Write-Host ("  {0,-13} {1} -> {2}" -f $label, $change.OldPath, $change.Path)
        }
        else {
            Write-Host ("  {0,-13} {1}" -f $label, $change.Path)
        }
    }
}
else {
    Write-Host ""
    Write-Host "Run with -Detailed to list every changed path."
}
