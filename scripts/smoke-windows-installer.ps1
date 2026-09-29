#requires -Version 7.0

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'Cli.Common.ps1')

function Assert-OwnedPreviousLocation {
    param([string]$RegistryPath, [string]$InstallDirectory)

    if (-not (Test-Path -LiteralPath $RegistryPath)) {
        return $false
    }

    $location = [string](Get-Item -LiteralPath $RegistryPath).GetValue('')
    if (-not [System.IO.Path]::IsPathFullyQualified($location)) {
        throw "Refusing to clean Archeion previous-location state with an invalid path at $RegistryPath."
    }

    $actual = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($location))
    $expected = [System.IO.Path]::TrimEndingDirectorySeparator([System.IO.Path]::GetFullPath($InstallDirectory))
    if (-not [string]::Equals($actual, $expected, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean Archeion previous-location state at $RegistryPath`: '$actual' is not the isolated smoke location '$expected'."
    }

    return $true
}

function Remove-OwnedPreviousLocation {
    param([string]$RegistryPath, [string]$InstallDirectory)

    if (-not (Assert-OwnedPreviousLocation -RegistryPath $RegistryPath -InstallDirectory $InstallDirectory)) {
        return
    }

    $key = Get-Item -LiteralPath $RegistryPath
    $unexpectedValues = @($key.GetValueNames() | Where-Object { $_ -notin @('', 'Installer Language') })
    if ($unexpectedValues.Count -gt 0 -or $key.SubKeyCount -gt 0) {
        throw "Refusing to clean Archeion previous-location state with unexpected values or subkeys at $RegistryPath."
    }

    Remove-Item -LiteralPath $RegistryPath -Force -ErrorAction Stop
    if (Test-Path -LiteralPath $RegistryPath) {
        throw "Archeion previous-location state remains after cleanup: $RegistryPath"
    }
}

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{
    installer = @{ Default = (Join-Path $PSScriptRoot '../artifacts/windows/Archeion-Setup-x64.exe') }
}

if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\smoke-windows-installer.ps1 [options]

Silently install and uninstall the staged per-user NSIS bundle in an isolated
temporary directory. Refuses to run when an Archeion installation already exists.

Options:
  --installer <path>            Staged Archeion NSIS installer.
  -h, --help                    Show this help.
'@
    return
}

if (-not $IsWindows) {
    throw 'Windows installer smoke requires Windows.'
}

$installer = [System.IO.Path]::GetFullPath([string]$cli['installer'])
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "NSIS installer does not exist: $installer"
}
if ([System.IO.Path]::GetExtension($installer) -ne '.exe') {
    throw "NSIS installer must be an .exe file: $installer"
}
if ((Get-Item -LiteralPath $installer).Length -lt 2) {
    throw "NSIS installer is empty or invalid: $installer"
}
$stream = [System.IO.File]::OpenRead($installer)
try {
    if ($stream.ReadByte() -ne 0x4d -or $stream.ReadByte() -ne 0x5a) {
        throw "NSIS installer is not a Windows executable: $installer"
    }
}
finally {
    $stream.Dispose()
}

$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Archeion'
$otherUninstallKeys = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Archeion',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Archeion'
)
$previousLocationKey = 'HKCU:\Software\Khoa Luong\Archeion'
$defaultInstallDirectory = Join-Path $env:LOCALAPPDATA 'Archeion'

foreach ($key in @($uninstallKey, $previousLocationKey) + $otherUninstallKeys) {
    if (Test-Path -LiteralPath $key) {
        throw "Existing Archeion installer state at $key; refusing to replace a user installation."
    }
}
if (Test-Path -LiteralPath $defaultInstallDirectory) {
    throw "Existing Archeion data or installation at $defaultInstallDirectory; refusing installer smoke."
}
if (Get-Process -Name Archeion -ErrorAction SilentlyContinue) {
    throw 'Archeion is running; refusing installer smoke.'
}

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$scratch = Join-Path $temporaryRoot "archeion-installer-smoke-$([guid]::NewGuid().ToString('N'))"
$installDirectory = Join-Path $scratch 'installed'
$uninstaller = Join-Path $installDirectory 'uninstall.exe'
$application = Join-Path $installDirectory 'Archeion.exe'
$failure = $null
$cleanupFailure = $null

function Invoke-SilentExecutable {
    param([string]$FilePath, [string[]]$Arguments, [string]$Operation)

    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "$Operation failed with exit code $($process.ExitCode): $FilePath"
    }
}

try {
    New-Item -ItemType Directory -Path $scratch -ErrorAction Stop | Out-Null
    Write-Host "Installing $installer into $installDirectory"
    Invoke-SilentExecutable -FilePath $installer -Arguments @('/S', '/NS', "/D=$installDirectory") -Operation 'NSIS install'

    foreach ($path in @($application, $uninstaller)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
            throw "NSIS install did not create the expected file: $path"
        }
    }
    if (-not (Test-Path -LiteralPath $uninstallKey)) {
        throw "NSIS install did not register Archeion at $uninstallKey"
    }
    $registeredLocation = ([string](Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation).Trim('"')
    if (-not [string]::Equals($registeredLocation, $installDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "NSIS registered unexpected install location '$registeredLocation'; expected '$installDirectory'."
    }
    if (-not (Assert-OwnedPreviousLocation -RegistryPath $previousLocationKey -InstallDirectory $installDirectory)) {
        throw "NSIS install did not create previous-location state at $previousLocationKey"
    }
    $versionInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($application)
    if ($versionInfo.ProductName -ne 'Archeion') {
        throw "Installed executable has unexpected product metadata: '$($versionInfo.ProductName)'."
    }
    Write-Host "Verified installed executable, embedded product metadata, uninstaller, and registry at $installDirectory"
}
catch {
    $failure = $_
}
finally {
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
        try {
            $registeredLocation = if (Test-Path -LiteralPath $uninstallKey) {
                ([string](Get-ItemProperty -LiteralPath $uninstallKey).InstallLocation).Trim('"')
            }
            else { '' }
            if (-not [string]::Equals($registeredLocation, $installDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to uninstall: registered location '$registeredLocation' is not the isolated smoke location."
            }
            Write-Host "Uninstalling $installDirectory"
            Invoke-SilentExecutable -FilePath $uninstaller -Arguments @('/S') -Operation 'NSIS uninstall'
            # NSIS can finish deleting its copied uninstaller shortly after the parent exits.
            for ($attempt = 0; $attempt -lt 50; $attempt++) {
                if (-not (Test-Path -LiteralPath $application) -and
                    -not (Test-Path -LiteralPath $uninstallKey) -and
                    -not (Test-Path -LiteralPath $installDirectory)) {
                    break
                }
                Start-Sleep -Milliseconds 200
            }
            if ((Test-Path -LiteralPath $application) -or
                (Test-Path -LiteralPath $uninstallKey) -or
                (Test-Path -LiteralPath $installDirectory)) {
                throw 'NSIS uninstall did not remove the isolated installation before previous-location cleanup.'
            }
            Remove-OwnedPreviousLocation -RegistryPath $previousLocationKey -InstallDirectory $installDirectory
        }
        catch {
            $cleanupFailure = $_
        }
    }

    if (-not $cleanupFailure) {
        if ((Test-Path -LiteralPath $application) -or (Test-Path -LiteralPath $uninstallKey)) {
            $cleanupFailure = 'Uninstall left the Archeion executable or uninstall registration behind.'
        }
        elseif (Test-Path -LiteralPath $installDirectory) {
            $cleanupFailure = "Uninstall left the isolated install directory behind: $installDirectory"
        }
        elseif (Test-Path -LiteralPath $previousLocationKey) {
            $cleanupFailure = "Uninstall left Archeion previous-location state behind: $previousLocationKey"
        }
    }

    if (-not $cleanupFailure -and (Test-Path -LiteralPath $scratch)) {
        # Only the GUID-named directory created above is removed, after uninstall verification.
        if (-not $scratch.StartsWith($temporaryRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Smoke scratch directory is outside the temporary root: $scratch"
        }
        Remove-Item -LiteralPath $scratch -ErrorAction Stop
    }
}

if ($cleanupFailure) {
    throw "Installer smoke cleanup failed: $cleanupFailure"
}
if ($failure) {
    throw $failure
}
Write-Host 'Windows NSIS install/uninstall smoke passed.'
