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

Write-Host "This reads live nonce, fee, and balance state from both providers."
Write-Host "It writes a funding proposal only. No wallet is funded and nothing is signed."
Write-Host "Run the localhost preview from the current commit first."

$primary = Read-SecretText "Paste the Alchemy Robinhood Mainnet HTTPS RPC URL"
$fallback = Read-SecretText "Paste the QuickNode Robinhood Mainnet HTTPS RPC URL"

try {
    $env:ROBINHOOD_RPC_URL = $primary
    $env:ROBINHOOD_FALLBACK_RPC_URL = $fallback
    & node (Join-Path $PSScriptRoot "funding-refresh.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Funding refresh failed. No wallet was funded."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:ROBINHOOD_FALLBACK_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
    $fallback = $null
}

Write-Host "Funding worksheet written. URLs were not printed or stored."
Write-Host "Funding the deployer remains a separate owner decision."
