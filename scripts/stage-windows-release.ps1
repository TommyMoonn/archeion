#requires -Version 7.0

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Cli.Common.ps1')

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    'bundle-dir' = @{ Aliases = @('-BundleRoot') }
    output = @{ Aliases = @('-o', '-OutputDirectory') }
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Join-Path $PSScriptRoot '..') }
    'installers-only' = @{ Kind = 'Switch' }
}
if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\stage-windows-release.ps1 [options]

Options:
  --bundle-dir <path>           Tauri bundle directory.
  -o, --output <path>           Staged release output directory.
  -p, --project <path>          Project root.
  --installers-only             Stage unsigned manual-build installers, not a release.
  -h, --help                    Show this help.

Legacy PowerShell flags remain accepted for compatibility.
'@
    return
}
$ProjectRoot = [IO.Path]::GetFullPath([string]$cli['project'])
$BundleRoot = if ($cli['bundle-dir']) { [IO.Path]::GetFullPath([string]$cli['bundle-dir']) } else { Join-Path $ProjectRoot 'src-tauri/target/release/bundle' }
$OutputDirectory = if ($cli['output']) { [IO.Path]::GetFullPath([string]$cli['output']) } else { Join-Path $ProjectRoot 'artifacts/windows' }
$OutputDirectory = $OutputDirectory.TrimEnd([char[]]@('\', '/'))

# Never replace a project, bundle tree, ancestor, or a linked destination. Old
# generated files may be replaced; unknown content always requires intervention.
function Test-WithinPath([string]$Child, [string]$Parent) {
    $Parent = $Parent.TrimEnd([char[]]@('\', '/'))
    return $Child.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Child.StartsWith($Parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
if (-not $OutputDirectory -or $OutputDirectory -eq [IO.Path]::GetPathRoot($OutputDirectory).TrimEnd([char[]]@('\', '/')) -or
    (Test-WithinPath $ProjectRoot $OutputDirectory) -or (Test-WithinPath $BundleRoot $OutputDirectory) -or (Test-WithinPath $OutputDirectory $BundleRoot)) {
    throw 'Unsafe output directory: must not replace the project, filesystem root, or bundle tree.'
}
if (Test-WithinPath $OutputDirectory (Join-Path $ProjectRoot '.git')) {
    throw 'Unsafe output directory: must not write inside Git metadata.'
}
$ancestor = $OutputDirectory
while ($ancestor) {
    if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Unsafe output directory: reparse-point ancestor '$ancestor'."
    }
    $ancestor = [IO.Path]::GetDirectoryName($ancestor)
}
$generatedNames = @('Archeion-Setup-x64.exe', 'Archeion-Setup-x64.exe.sig', 'Archeion-x64.msi', 'Archeion-x64.msi.sig', 'latest.json', 'SHA256SUMS.txt')
function Assert-GeneratedDirectory([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { throw "Output is not a directory: $Directory" }
    foreach ($item in @(Get-ChildItem -LiteralPath $Directory -Force)) {
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $generatedNames -cnotcontains $item.Name) {
            throw "Refusing to replace unexpected output content: $($item.FullName)"
        }
    }
}
function Remove-GeneratedDirectory([string]$Directory) {
    Assert-GeneratedDirectory $Directory
    foreach ($item in @(Get-ChildItem -LiteralPath $Directory -Force)) { Remove-Item -LiteralPath $item.FullName -Force }
    Remove-Item -LiteralPath $Directory -Force
}
if (Test-Path -LiteralPath $OutputDirectory) { Assert-GeneratedDirectory $OutputDirectory }

Write-CliHeading 'Stage Windows release'
Write-CliStep -Current 1 -Total 4 -Message 'Validating release metadata'
& (Join-Path $PSScriptRoot 'check-release.ps1') --project $ProjectRoot
$version = [string](Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'package.json') | ConvertFrom-Json).version
Write-CliStep -Current 2 -Total 4 -Message 'Locating Windows installers'
$nsisDirectory = Join-Path $BundleRoot 'nsis'
$msiDirectory = Join-Path $BundleRoot 'msi'
$nsisInstallers = @(Get-ChildItem -LiteralPath $nsisDirectory -Filter '*.exe' -File)
$msiInstallers = @(Get-ChildItem -LiteralPath $msiDirectory -Filter '*.msi' -File)
if ($nsisInstallers.Count -ne 1) { throw "Expected exactly one NSIS installer in '$nsisDirectory', found $($nsisInstallers.Count)." }
if ($msiInstallers.Count -ne 1) { throw "Expected exactly one MSI installer in '$msiDirectory', found $($msiInstallers.Count)." }
$escapedVersion = [regex]::Escape($version)
if ($nsisInstallers[0].Name -cnotmatch "^Archeion_${escapedVersion}_x64-setup\.exe$" -or
    $msiInstallers[0].Name -cnotmatch "^Archeion_${escapedVersion}_x64(?:_[A-Za-z]{2}(?:-[A-Za-z]{2})?)?\.msi$") {
    throw "Installer filename does not match release version '$version' and x64 architecture."
}
$stagedFiles = @(
    @{ Source = $nsisInstallers[0].FullName; Name = 'Archeion-Setup-x64.exe' },
    @{ Source = $msiInstallers[0].FullName; Name = 'Archeion-x64.msi' }
)
if (-not $cli['installers-only']) {
    foreach ($installer in @($nsisInstallers[0], $msiInstallers[0])) {
        $signatures = @(Get-ChildItem -LiteralPath $installer.DirectoryName -Filter '*.sig' -File)
        if ($signatures.Count -ne 1 -or $signatures[0].Name -cne ($installer.Name + '.sig')) {
            throw "Expected exactly one matching signature for '$($installer.Name)'."
        }
        $publicName = if ($installer.Extension -eq '.exe') { 'Archeion-Setup-x64.exe.sig' } else { 'Archeion-x64.msi.sig' }
        $stagedFiles += @{ Source = $signatures[0].FullName; Name = $publicName }
    }
}
foreach ($file in $stagedFiles) {
    $item = Get-Item -LiteralPath $file.Source
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -eq 0) {
        throw "Bundle asset must be a nonempty regular file: $($item.Name)"
    }
}
Write-CliStep -Current 3 -Total 4 -Message 'Staging installers'
$parentDirectory = [IO.Path]::GetDirectoryName($OutputDirectory)
New-Item -ItemType Directory -Path $parentDirectory -Force | Out-Null
$temporaryDirectory = Join-Path $parentDirectory ('.windows-stage-' + [guid]::NewGuid().ToString('N'))
$backupDirectory = Join-Path $parentDirectory ('.windows-backup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    foreach ($file in $stagedFiles) { Copy-Item -LiteralPath $file.Source -Destination (Join-Path $temporaryDirectory $file.Name) }
    $assetNames = @($stagedFiles.Name | Sort-Object -CaseSensitive)
    if (-not $cli['installers-only']) {
        & node (Join-Path $PSScriptRoot 'windows-update-manifest.mjs') generate --project $ProjectRoot --artifacts-dir $temporaryDirectory
        if ($LASTEXITCODE -ne 0) { throw 'Windows update manifest generation failed.' }
        $assetNames += 'latest.json'
    }
    Write-CliStep -Current 4 -Total 4 -Message 'Writing checksum manifest'
    $checksumLines = foreach ($name in $assetNames) {
        $hash = (Get-FileHash -LiteralPath (Join-Path $temporaryDirectory $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $name"
    }
    Set-Content -LiteralPath (Join-Path $temporaryDirectory 'SHA256SUMS.txt') -Value $checksumLines -Encoding ascii
    $verifyArguments = @('--project', $ProjectRoot, '--artifacts-dir', $temporaryDirectory)
    if ($cli['installers-only']) { $verifyArguments += '--installers-only' }
    & (Join-Path $PSScriptRoot 'verify-windows-release.ps1') @verifyArguments
    if (Test-Path -LiteralPath $OutputDirectory) {
        Assert-GeneratedDirectory $OutputDirectory
        Move-Item -LiteralPath $OutputDirectory -Destination $backupDirectory
    }
    try { Move-Item -LiteralPath $temporaryDirectory -Destination $OutputDirectory }
    catch {
        if (Test-Path -LiteralPath $backupDirectory) { Move-Item -LiteralPath $backupDirectory -Destination $OutputDirectory }
        throw
    }
    if (Test-Path -LiteralPath $backupDirectory) { Remove-GeneratedDirectory $backupDirectory }
} finally {
    if (Test-Path -LiteralPath $temporaryDirectory) { Remove-GeneratedDirectory $temporaryDirectory }
}
Write-CliSuccess 'Windows release staged'
foreach ($entry in @(@('EXE', 'Archeion-Setup-x64.exe'), @('MSI', 'Archeion-x64.msi'), @('Checksums', 'SHA256SUMS.txt'))) {
    $item = Get-Item -LiteralPath (Join-Path $OutputDirectory $entry[1])
    Write-CliDetail -Label $entry[0] -Value "$($item.Name) ($(Format-CliByteSize -Bytes $item.Length))"
}
Write-CliDetail -Label 'Output' -Value $OutputDirectory -ValueTone 'Important'
