#requires -Version 7.0

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "Cli.Common.ps1")

$cli = ConvertFrom-CliArguments -Arguments $args -OptionSpecs @{}
if ($cli['help']) {
    Write-CliHelp @'
Usage: .\scripts\zip-project.ps1

Options:
  -h, --help                    Show this help.
'@
    return
}

$ProjectRoot = Resolve-Path "$PSScriptRoot/.."
$ProjectName = Split-Path $ProjectRoot -Leaf
$ProjectSlug = ($ProjectName.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')

if ([string]::IsNullOrWhiteSpace($ProjectSlug)) {
    throw "Could not derive a project slug from '$ProjectName'."
}

$Timestamp = Get-Date -Format "yyMMddHHmm"
$OutputFileName = "$ProjectSlug($Timestamp).zip"
$OutputPath = Join-Path (Split-Path $ProjectRoot -Parent) $OutputFileName
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
