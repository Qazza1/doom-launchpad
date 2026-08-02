param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("resume", "launch")]
    [string]$Kind,

    [string]$Plan
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

Write-Host "Comparing the prepared $Kind plan against what your wallet actually signs."
Write-Host ""
Write-Host "The fork runs on an isolated chain ID, never 4663. Your wallet signs a real"
Write-Host "transaction there, but EIP-155 binds it to the preview chain, so it is not a"
Write-Host "valid Robinhood mainnet transaction. No key is loaded and nothing is sent"
Write-Host "upstream."
Write-Host ""
Write-Host "The endpoint is read through a hidden prompt and cleared afterwards."

$primary = Read-SecretText "Robinhood HTTPS RPC URL to fork from"

$arguments = @("--kind", $Kind)
if ($Plan) { $arguments += @("--plan", $Plan) }

try {
    $env:ROBINHOOD_RPC_URL = $primary
    & node (Join-Path $PSScriptRoot "wallet-compare.mjs") @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "The comparison did not start. Nothing was signed or sent."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
}

Write-Host ""
Write-Host "Endpoint cleared from this session. A passing comparison is evidence, not approval."
