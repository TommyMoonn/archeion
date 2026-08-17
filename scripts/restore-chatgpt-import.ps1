#requires -Version 7.0

# Compatibility entry point. Use restore-changes.ps1 for new commands.
& (Join-Path $PSScriptRoot "restore-changes.ps1") @args
