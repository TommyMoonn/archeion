#requires -Version 7.0

# Compatibility entry point. Use package-changes.ps1 for new commands.
& (Join-Path $PSScriptRoot "package-changes.ps1") @args
