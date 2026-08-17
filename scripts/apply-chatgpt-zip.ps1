#requires -Version 7.0

# Compatibility entry point. Use apply-changes.ps1 for new commands.
& (Join-Path $PSScriptRoot "apply-changes.ps1") @args
