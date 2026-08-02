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

Write-Host "Rehearsing the prepared $Kind plan on a local fork of Robinhood Chain."
Write-Host "The transaction is sent to 127.0.0.1 only, from an impersonated account"
Write-Host "holding a sentinel balance no real account can have. No key is loaded and"
Write-Host "nothing reaches mainnet."
Write-Host ""
Write-Host "Rehearse resume and launch in separate runs, as they are approved separately."
Write-Host ""
Write-Host "The endpoint is read through a hidden prompt and cleared afterwards."

$primary = Read-SecretText "Robinhood HTTPS RPC URL to fork from"

$arguments = @("--kind", $Kind)
if ($Plan) { $arguments += @("--plan", $Plan) }

try {
    $env:ROBINHOOD_RPC_URL = $primary
    & node (Join-Path $PSScriptRoot "fork-rehearsal.mjs") @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "The rehearsal failed. Nothing was sent to mainnet. Do not submit this plan."
    }
} finally {
    Remove-Item Env:ROBINHOOD_RPC_URL -ErrorAction SilentlyContinue
    $primary = $null
}

Write-Host ""
Write-Host "Endpoint cleared from this session. A passing rehearsal is evidence, not approval."
