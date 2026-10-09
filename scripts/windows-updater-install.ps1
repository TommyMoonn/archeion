#requires -Version 7.0
param(
    [Parameter(Mandatory)][ValidateSet('Preflight', 'Install', 'Verify', 'Uninstall')][string]$Operation,
    [Parameter(Mandatory)][ValidateSet('nsis', 'msi')][string]$Bundle,
    [Parameter(Mandatory)][string]$Nonce,
    [Parameter(Mandatory)][string]$RunRoot,
    [Parameter(Mandatory)][string]$InstallDirectory,
    [string]$Installer,
    [string]$Version
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Windows updater installation requires Windows.' }
if ($Nonce -notmatch '^[a-f0-9]{16}$') { throw 'Invalid isolated updater identity.' }
$productName = "Archeion Updater Smoke $Nonce"
$runDirectory = [IO.Path]::GetFullPath($RunRoot)
$installPath = [IO.Path]::GetFullPath($InstallDirectory)
if ([IO.Path]::GetFileName($runDirectory) -ne "run-$Nonce" -or
    -not [string]::Equals($installPath, (Join-Path $runDirectory 'installed'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing an installation outside the nonce-owned updater smoke directory.'
}
$application = Join-Path $installPath 'ArcheionUpdaterSmoke.exe'
foreach ($target in @($runDirectory, $installPath)) {
    if ((Test-Path -LiteralPath $target) -and
        ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a redirected updater smoke directory.'
    }
}
$previousLocationKey = "HKCU:\Software\Archeion Smoke\$productName"
$uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

function Find-Registration {
    $items = @()
    foreach ($root in $uninstallRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root) {
            if ([string]$key.GetValue('DisplayName') -ne $productName) { continue }
            $location = ([string]$key.GetValue('InstallLocation')).Trim('"')
            if (-not [string]::Equals($location.TrimEnd('\'), $installPath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing installer state at an unowned location: $location"
            }
            if ($Bundle -eq 'nsis' -and $key.Name -notlike 'HKEY_CURRENT_USER\*') {
                throw 'The isolated NSIS fixture must be installed per-user.'
            }
            if ($Bundle -eq 'msi' -and $key.PSChildName -notmatch '^\{[a-fA-F0-9-]{36}\}$') {
                throw 'Invalid isolated MSI product registration.'
            }
            $items += $key
        }
    }
    if ($items.Count -gt 1) { throw 'Ambiguous isolated installer registration.' }
    return $items
}

function Invoke-Installer([string]$File, [string[]]$Arguments) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(120000)) { throw "Installer timed out: PID $($process.Id)" }
    if ($process.ExitCode -notin @(0, 3010)) { throw "Installer failed with exit code $($process.ExitCode)." }
}

if ($Operation -in @('Preflight', 'Install')) {
    if ((Test-Path -LiteralPath $installPath) -or (Test-Path -LiteralPath $previousLocationKey) -or @(Find-Registration).Count) {
        throw 'Refusing pre-existing isolated installer state.'
    }
    if ($Operation -eq 'Preflight') {
        Write-Output "Preflight passed for isolated $Bundle fixture."
        return
    }
    $installerPath = [IO.Path]::GetFullPath($Installer)
    if (-not $installerPath.StartsWith($runDirectory + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw 'Installer must be an artifact inside the owned run directory.'
    }
    if ($Bundle -eq 'nsis') {
        Invoke-Installer $installerPath @('/S', '/NS', "/D=$installPath")
    }
    else {
        Invoke-Installer 'msiexec.exe' @('/i', "`"$installerPath`"", '/qn', '/norestart', "INSTALLDIR=`"$installPath`"", '/L*v', "`"$(Join-Path $runDirectory 'msi-install.log')`"")
    }
}

if ($Operation -ne 'Uninstall') {
    $registration = @(Find-Registration)
    if ($registration.Count -ne 1 -or -not (Test-Path -LiteralPath $application -PathType Leaf)) {
        throw 'Isolated installation is missing its application or registration.'
    }
    $metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($application)
    if ($metadata.ProductName -ne $productName -or $metadata.ProductVersion -notin @($Version, "$Version.0")) {
        throw "Unexpected installed identity/version: $($metadata.ProductName) $($metadata.ProductVersion)"
    }
    Write-Output "Verified $Bundle $Version at $installPath"
    return
}

$registration = @(Find-Registration)
if ($registration.Count -eq 1) {
    if ($Bundle -eq 'nsis') {
        $uninstaller = Join-Path $installPath 'uninstall.exe'
        if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) { throw 'Owned NSIS uninstaller is missing.' }
        Invoke-Installer $uninstaller @('/S')
    }
    else {
        $productCode = $registration[0].PSChildName
        if ($productCode -notmatch '^\{[a-fA-F0-9-]{36}\}$') { throw 'Invalid owned MSI product code.' }
        Invoke-Installer 'msiexec.exe' @('/x', $productCode, '/qn', '/norestart')
    }
}
for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if (-not (Test-Path -LiteralPath $application) -and @(Find-Registration).Count -eq 0) { break }
    Start-Sleep -Milliseconds 200
}
if ((Test-Path -LiteralPath $application) -or @(Find-Registration).Count) { throw 'Owned installation was not removed.' }
if (Test-Path -LiteralPath $previousLocationKey) {
    $key = Get-Item -LiteralPath $previousLocationKey
    foreach ($name in @('', 'InstallDir')) {
        $location = [string]$key.GetValue($name)
        if ($location -and -not [string]::Equals($location.Trim('"').TrimEnd('\'), $installPath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing unowned previous-location registry state.'
        }
    }
    if ($key.SubKeyCount -or @($key.GetValueNames() | Where-Object { $_ -notin @('', 'InstallDir', 'Installer Language', 'Desktop Shortcut', 'Uninstaller Shortcut') }).Count) {
        throw 'Unexpected values in isolated previous-location state.'
    }
    Remove-Item -LiteralPath $previousLocationKey -Force
}
if (Test-Path -LiteralPath $installPath) {
    if (@(Get-ChildItem -LiteralPath $installPath -Force).Count) { throw 'Uninstaller left files behind; refusing recursive removal.' }
    Remove-Item -LiteralPath $installPath
}
Write-Output "Uninstalled and verified cleanup of isolated $Bundle fixture."
