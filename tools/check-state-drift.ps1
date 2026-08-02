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

Write-Host "Comparing what this repository says about the chain with what the chain says."
Write-Host "Read-only. One endpoint is enough; this is not part of the safety chain."
Write-Host ""

$primary = Read-SecretText "Robinhood HTTPS RPC URL"

try {
    $env:ROBINHOOD_RPC_URL = $primary
    & node (Join-Path $PSScriptRoot "check-state-drift.mjs")
    $failed = $LASTEXITCODE -ne 0
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
}

if ($failed) {
    throw "State claims are stale. Fix the documents, or record why they are historical."
}
