param(
    [Parameter(Mandatory = $true)]
    [string]$Addresses
)

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

if (-not (Test-Path -LiteralPath $Addresses)) {
    throw "Address file not found: $Addresses"
}

Write-Host "Read-only post-deployment verification through two independent providers."
Write-Host "Nothing is signed, funded, or resumed."

$primary = Read-SecretText "Paste the Alchemy Robinhood Mainnet HTTPS RPC URL"
$fallback = Read-SecretText "Paste the QuickNode Robinhood Mainnet HTTPS RPC URL"

try {
    $env:ROBINHOOD_RPC_URL = $primary
    $env:ROBINHOOD_FALLBACK_RPC_URL = $fallback
    & node (Join-Path $PSScriptRoot "verify-deployment.mjs") --addresses $Addresses
    if ($LASTEXITCODE -ne 0) {
        throw "Deployment verification failed. Stop and investigate before any further action."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_FALLBACK_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
    $fallback = $null
}

Write-Host "Verification passed. Resuming the factory remains a separate Stage 5 decision."
