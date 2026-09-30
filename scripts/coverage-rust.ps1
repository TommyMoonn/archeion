$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifest = Join-Path $repoRoot 'src-tauri/Cargo.toml'
$reportRoot = Join-Path $repoRoot 'coverage/rust'
$lcovPath = Join-Path $reportRoot 'lcov.info'

if (-not (Get-Command cargo-llvm-cov -ErrorAction SilentlyContinue)) {
    throw 'cargo-llvm-cov is required. Install version 0.9.0 with: cargo install cargo-llvm-cov --version 0.9.0 --locked'
}

New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
Push-Location $repoRoot
try {
    & cargo llvm-cov --locked --manifest-path $manifest --html --output-dir $reportRoot
    if ($LASTEXITCODE -ne 0) { throw "Rust coverage test run failed with exit code $LASTEXITCODE." }

    & cargo llvm-cov report --locked --manifest-path $manifest --lcov --output-path $lcovPath
    if ($LASTEXITCODE -ne 0) { throw "Rust LCOV export failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}
