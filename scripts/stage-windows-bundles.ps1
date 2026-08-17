#requires -Version 7.0

# Compatibility entry point. Use stage-windows-release.ps1 for new commands.
& (Join-Path $PSScriptRoot "stage-windows-release.ps1") @args
