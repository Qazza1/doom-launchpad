$ErrorActionPreference = "Stop"

function Read-SecretText {
    param([string]$Prompt)
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$primary = Read-SecretText "Paste the primary Robinhood Mainnet HTTPS RPC URL"
$fallback = Read-SecretText "Paste the fallback Robinhood Mainnet HTTPS RPC URL"

try {
    $env:ROBINHOOD_RPC_URL = $primary
    $env:ROBINHOOD_FALLBACK_RPC_URL = $fallback
    $scriptPath = Join-Path $PSScriptRoot "network-preflight.mjs"
    & node $scriptPath
    if ($LASTEXITCODE -ne 0) {
        throw "RPC preflight failed. No transaction was signed or broadcast."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_FALLBACK_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
    $fallback = $null
}

Write-Host "RPC preflight passed. URLs were not written to disk or printed."
Write-Host "No transaction was signed or broadcast."
