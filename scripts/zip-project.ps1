$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path "$PSScriptRoot/.."
$ProjectName = Split-Path $ProjectRoot -Leaf
$OutputPath = Join-Path (Split-Path $ProjectRoot -Parent) "$ProjectName.zip"
$OutputFileName = Split-Path $OutputPath -Leaf
$IgnoreFile = Join-Path $ProjectRoot ".zipignore"
$FileList = Join-Path $env:TEMP "$ProjectName-zip-filelist.txt"

Push-Location $ProjectRoot

try {
    if (Test-Path $OutputPath) {
        Remove-Item $OutputPath -Force
    }

    Get-ChildItem -Force -Name |
        Where-Object { $_ -ne $OutputFileName } |
        Set-Content -Path $FileList -Encoding utf8

    if (Test-Path $IgnoreFile) {
        tar -a -cf $OutputPath --exclude-from=.zipignore --exclude=$OutputFileName -T $FileList
    } else {
        tar -a -cf $OutputPath --exclude=$OutputFileName -T $FileList
    }

    Write-Host "Created: $OutputPath"
} finally {
    Pop-Location

    if (Test-Path $FileList) {
        Remove-Item $FileList -Force
    }
}
