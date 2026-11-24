#requires -Version 7.0
param([Parameter(Mandatory)][string]$Installer)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'WindowsEpubAssociation.Common.ps1')

if (-not $IsWindows) { throw 'MSI installer smoke requires Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'MSI installer smoke requires an elevated terminal.'
}
$installerPath = [IO.Path]::GetFullPath($Installer)
if ([IO.Path]::GetExtension($installerPath) -ne '.msi' -or -not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
    throw "Expected an existing MSI installer: $installerPath"
}
Assert-CleanArcheionAssociationState
foreach ($existing in @(
    'HKCU:\Software\Khoa Luong\Archeion', 'HKLM:\Software\Khoa Luong\Archeion',
    'HKCU:\Software\Archeion', 'HKLM:\Software\Archeion',
    (Join-Path $env:LOCALAPPDATA 'Archeion'), (Join-Path $env:ProgramFiles 'Archeion'))) {
    if (Test-Path -LiteralPath $existing) { throw "Existing Archeion installation state at $existing; refusing MSI smoke." }
}
$originalDefault = Get-EpubDefaultState
$scratch = Join-Path ([IO.Path]::GetTempPath()) "archeion-msi-smoke-$([guid]::NewGuid().ToString('N'))"
$installDirectory = Join-Path $scratch 'installed'
$application = Join-Path $installDirectory 'Archeion.exe'
$classes = 'HKLM:\Software\Classes'
$failure = $null

function Invoke-Msi([string[]]$Arguments) {
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $Arguments -PassThru -Wait -NoNewWindow
    if ($process.ExitCode -notin @(0, 3010)) { throw "MSI operation failed: exit code $($process.ExitCode). Logs: $scratch" }
}

function Get-OwnedMsiRegistration {
    $registrations = @(Find-ArcheionInstallerRegistration)
    if ($registrations.Count -eq 0) { return }
    if ($registrations.Count -ne 1) { throw 'Ambiguous Archeion installer registration.' }
    $key = $registrations[0]
    $location = ([string]$key.GetValue('InstallLocation')).Trim('"').TrimEnd('\')
    if ($key.PSChildName -notmatch '^\{[a-fA-F0-9-]{36}\}$' -or
        $key.Name -notlike 'HKEY_LOCAL_MACHINE\*' -or
        -not [string]::Equals($location, $installDirectory.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to uninstall unowned MSI registration at $location."
    }
    return $key
}

try {
    New-Item -ItemType Directory -Path $scratch | Out-Null
    Invoke-Msi @('/i', "`"$installerPath`"", '/qn', '/norestart', "INSTALLDIR=`"$installDirectory`"", '/L*v', "`"$(Join-Path $scratch 'install.log')`"")
    if (-not (Get-OwnedMsiRegistration) -or -not (Test-Path -LiteralPath $application -PathType Leaf)) {
        throw 'MSI did not create the expected isolated installation.'
    }
    if ([Diagnostics.FileVersionInfo]::GetVersionInfo($application).ProductName -ne 'Archeion') {
        throw 'MSI installed an unexpected executable.'
    }
    Assert-ArcheionEpubRegistration $classes $application
    Assert-EpubDefaultState $originalDefault
}
catch { $failure = $_ }
finally {
    try {
        $registration = Get-OwnedMsiRegistration
        if ($registration) {
            Invoke-Msi @('/x', $registration.PSChildName, '/qn', '/norestart', '/L*v', "`"$(Join-Path $scratch 'uninstall.log')`"")
        }
        if ((Get-OwnedMsiRegistration) -or (Test-Path -LiteralPath $application)) {
            throw 'MSI uninstall left the isolated installation behind.'
        }
        foreach ($scope in @('HKCU:\Software\Classes', $classes)) {
            if (Test-ArcheionEpubRegistration $scope) { throw "MSI uninstall left EPUB registration at $scope." }
        }
        Assert-EpubDefaultState $originalDefault
        if (-not $failure) {
            Remove-Item -LiteralPath (Join-Path $scratch 'install.log'), (Join-Path $scratch 'uninstall.log') -ErrorAction SilentlyContinue
            if (@(Get-ChildItem -LiteralPath $scratch -Force).Count -eq 0) { Remove-Item -LiteralPath $scratch }
        }
    }
    catch { throw "MSI cleanup failed: $_. Initial error: $failure. Logs: $scratch" }
}
if ($failure) { throw "MSI installer smoke failed: $failure. Logs: $scratch" }
Write-Output 'Windows MSI installer smoke passed'
