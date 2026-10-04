#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    'bundle-dir' = @{ Aliases = @('-BundleRoot') }
    output = @{ Aliases = @('-o', '-OutputDirectory') }
    project = @{ Aliases = @('-p', '-ProjectRoot'); Default = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\stage-windows-release.ps1 [options]

Options:
  --bundle-dir <path>           Tauri bundle directory.
  -o, --output <path>           Staged release output directory.
  -p, --project <path>          Project root.
  -h, --help                    Show this help.

Legacy PowerShell flags remain accepted for compatibility.
'@
    return
}

$BundleRoot = $cli['bundle-dir']
$OutputDirectory = $cli['output']
$ProjectRoot = $cli['project']

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd([char[]]@('\', '/'))

Write-CliHeading "Stage Windows release"
Write-CliStep -Current 1 -Total 4 -Message "Validating release metadata"
& (Join-Path $PSScriptRoot "check-release.ps1") '--project' $ProjectRoot

if ([string]::IsNullOrWhiteSpace($BundleRoot)) {
    $BundleRoot = Join-Path $ProjectRoot "src-tauri/target/release/bundle"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $ProjectRoot "artifacts/windows"
}

$packagePath = Join-Path $ProjectRoot "package.json"
$package = Get-Content -Raw -Path $packagePath | ConvertFrom-Json
$version = [string]$package.version

if ([string]::IsNullOrWhiteSpace($version)) {
    throw "package.json does not contain a release version."
}

Write-CliStep -Current 2 -Total 4 -Message "Locating Windows installers"
$nsisDirectory = Join-Path $BundleRoot "nsis"
$msiDirectory = Join-Path $BundleRoot "msi"
$nsisInstallers = @(Get-ChildItem -Path $nsisDirectory -Filter "*-setup.exe" -File -ErrorAction Stop)
$msiInstallers = @(Get-ChildItem -Path $msiDirectory -Filter "*.msi" -File -ErrorAction Stop)

if ($nsisInstallers.Count -ne 1) {
    throw "Expected exactly one NSIS installer in '$nsisDirectory', found $($nsisInstallers.Count)."
}

if ($msiInstallers.Count -ne 1) {
    throw "Expected exactly one MSI installer in '$msiDirectory', found $($msiInstallers.Count)."
}

foreach ($installer in @($nsisInstallers[0], $msiInstallers[0])) {
    if ($installer.Name -notmatch [regex]::Escape($version)) {
        throw "Installer '$($installer.Name)' does not match release version '$version'."
    }
}

Write-CliStep -Current 3 -Total 4 -Message "Staging installers"
if (Test-Path $OutputDirectory) {
    Remove-Item -Path $OutputDirectory -Recurse -Force
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$stagedFiles = @(
    @{
        Source = $nsisInstallers[0].FullName
        Name = "Archeion-Setup-x64.exe"
    },
    @{
        Source = $msiInstallers[0].FullName
        Name = "Archeion-x64.msi"
    }
)

foreach ($file in $stagedFiles) {
    Copy-Item -Path $file.Source -Destination (Join-Path $OutputDirectory $file.Name)
}

Write-CliStep -Current 4 -Total 4 -Message "Writing checksum manifest"
$checksumLines = foreach ($file in $stagedFiles) {
    $stagedPath = Join-Path $OutputDirectory $file.Name
    $hash = (Get-FileHash -Path $stagedPath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($file.Name)"
}

$checksumPath = Join-Path $OutputDirectory "SHA256SUMS.txt"
Set-Content -Path $checksumPath -Value $checksumLines -Encoding ascii

$stagedExe = Get-Item -LiteralPath (Join-Path $OutputDirectory "Archeion-Setup-x64.exe")
$stagedMsi = Get-Item -LiteralPath (Join-Path $OutputDirectory "Archeion-x64.msi")
$stagedChecksums = Get-Item -LiteralPath $checksumPath

Write-CliSuccess "Windows release staged"
Write-CliDetail -Label "EXE" -Value "$($stagedExe.Name) ($(Format-CliByteSize -Bytes $stagedExe.Length))"
Write-CliDetail -Label "MSI" -Value "$($stagedMsi.Name) ($(Format-CliByteSize -Bytes $stagedMsi.Length))"
Write-CliDetail -Label "Checksums" -Value "$($stagedChecksums.Name) ($(Format-CliByteSize -Bytes $stagedChecksums.Length))"
Write-CliDetail -Label "Output" -Value $OutputDirectory -ValueTone 'Important'
