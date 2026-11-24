# Registry assertions shared by the installed NSIS and MSI smoke tests.
function Get-EpubRegistryValue {
    param([string]$Path, [string]$Name = '')
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $key = Get-Item -LiteralPath $Path
    if ($key.GetValueNames() -notcontains $Name) { return $null }
    return [string]$key.GetValue($Name)
}

function Get-EpubDefaultState {
    $choice = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.epub\UserChoice'
    return [ordered]@{
        UserDefault = Get-EpubRegistryValue 'HKCU:\Software\Classes\.epub'
        MachineDefault = Get-EpubRegistryValue 'HKLM:\Software\Classes\.epub'
        UserChoice = Get-EpubRegistryValue $choice 'ProgId'
        UserChoiceHash = Get-EpubRegistryValue $choice 'Hash'
    }
}

function Assert-EpubDefaultState {
    param($Expected)
    $actual = Get-EpubDefaultState
    foreach ($name in $Expected.Keys) {
        if ($actual[$name] -cne $Expected[$name]) {
            throw "Installer changed EPUB default selection ($name)."
        }
    }
}

function Test-ArcheionEpubRegistration {
    param([string]$Classes)
    return ((Test-Path -LiteralPath "$Classes\Archeion.epub") -or
        (Test-Path -LiteralPath "$Classes\Applications\Archeion.exe") -or
        ($null -ne (Get-EpubRegistryValue "$Classes\.epub\OpenWithProgids" 'Archeion.epub')))
}

function Assert-ArcheionEpubRegistration {
    param([string]$Classes, [string]$Application)
    if ($null -eq (Get-EpubRegistryValue "$Classes\.epub\OpenWithProgids" 'Archeion.epub')) {
        throw 'EPUB Open with ProgID is missing.'
    }
    if ((Get-EpubRegistryValue "$Classes\Applications\Archeion.exe" 'FriendlyAppName') -cne 'Archeion' -or
        $null -eq (Get-EpubRegistryValue "$Classes\Applications\Archeion.exe\SupportedTypes" '.epub')) {
        throw 'EPUB application registration is missing or incorrect.'
    }
    $expected = '"' + $Application + '" "%1"'
    foreach ($key in @("$Classes\Archeion.epub\shell\open\command", "$Classes\Applications\Archeion.exe\shell\open\command")) {
        if ((Get-EpubRegistryValue $key) -cne $expected) {
            throw "Unexpected EPUB open command at $key."
        }
    }
}

function Find-ArcheionInstallerRegistration {
    foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Get-ChildItem -LiteralPath $root | Where-Object { $_.GetValue('DisplayName') -eq 'Archeion' }
    }
}

function Assert-CleanArcheionAssociationState {
    if (@(Find-ArcheionInstallerRegistration).Count -or (Get-Process -Name Archeion -ErrorAction SilentlyContinue)) {
        throw 'Existing Archeion installation or running process; refusing installer smoke.'
    }
    foreach ($classes in @('HKCU:\Software\Classes', 'HKLM:\Software\Classes')) {
        if (Test-ArcheionEpubRegistration $classes) {
            throw "Existing Archeion EPUB registration at $classes; refusing installer smoke."
        }
    }
}
